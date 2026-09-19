import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { parseOrder } from './hl7.js';
import { FhirClient, validatePrescription, medicationCode, auditEvent, dispenseResource } from './fhir.js';
import { insist } from './errors.js';
import { canonical } from './store.js';
export const couriers = [{ id: 'courier-01', name: 'Sam • Courier 01' }, { id: 'courier-02', name: 'Jordan • Courier 02' }];
const bodySchema = z.object({ orderId: z.string().regex(/^[A-Za-z0-9.-]{1,64}$/), message: z.string().min(1).max(32768), courierId: z.enum(['courier-01', 'courier-02']), etaMinutes: z.number().int().min(1).max(60), temperature: z.number().min(2).max(8), sealed: z.literal(true) }).strict();
export class Workflow {
  constructor(store, rxnorm, cfg) { this.store = store; this.rxnorm = rxnorm; this.cfg = cfg; this.locks = new Set(); }
  client(session) { return new FhirClient(session.fhirBase, session.accessToken); }
  owner(session) { return createHash('sha256').update(`${session.fhirBase}|${session.patient}`).digest('hex'); }
  // Allowlist construction: no spreading clinical inputs into notification payloads.
  notification(courier, eta) { return { title: 'Pharmacy delivery on the way', body: 'Open the secure app for delivery details.', courier: courier.name, eta }; }
  async validate(session, raw, orderId) {
    insist(typeof orderId === 'string' && /^[A-Za-z0-9.-]{1,64}$/.test(orderId), 'SELECTED_ORDER_REQUIRED', 'Select a prescription before verifying the message.');
    const message = parseOrder(raw);
    const client = this.client(session);
    const [order, patient] = await Promise.all([client.getOrder(message.orderNumber, session.patient), client.request(`/Patient/${encodeURIComponent(session.patient)}`)]);
    insist(order.id === orderId, 'SELECTED_ORDER_MISMATCH', 'The pasted message belongs to a different prescription. Select its order before continuing.');
    validatePrescription(order, patient, message, session.patient);
    const concept = await client.medication(order);
    const terminology = await this.rxnorm.compare(medicationCode(concept), message.rxcui);
    insist(medicationCode(concept) === message.rxcui, 'SUBSTITUTION_REVIEW', 'The formulation is equivalent, but a different product code requires pharmacist substitution review. This demo only releases the prescribed RxNorm product.');
    return { message, order, terminology };
  }
  async preview(session, raw, orderId) {
    try {
      const checked = await this.validate(session, raw, orderId);
      this.store.append(auditEvent('validation-passed', '0', randomUUID()));
      return { valid: true, medication: checked.terminology.request.name, terminology: checked.terminology, dose: `${checked.message.dose} units`, checks: ['Patient identity', 'Active prescription', 'Clinical formulation', 'Dose and route'] };
    } catch (error) { this.store.append(auditEvent('validation-blocked', '4', randomUUID())); throw error; }
  }
  async dispatch(session, input) {
    const validated = bodySchema.safeParse(input);
    insist(validated.success, 'INVALID_DISPATCH', 'Choose a courier, confirm sealed packaging, set an ETA of 1–60 minutes, and record a temperature of 2–8°C.');
    insist(this.store.verify().valid, 'AUDIT_INTEGRITY', 'Audit integrity verification failed. Dispatch is locked.', 503);
    const rawMessage = parseOrder(input.message);
    const owner = this.owner(session);
    const messageKey = createHash('sha256').update(`${session.fhirBase}|${rawMessage.sender}|${rawMessage.facility}|${rawMessage.controlId}`).digest('hex');
    const fingerprint = createHash('sha256').update(canonical({ ...input, message: rawMessage })).digest('hex');
    insist(!this.locks.has(messageKey), 'DISPATCH_BUSY', 'This message is already being processed. Retry shortly.', 409);
    this.locks.add(messageKey);
    try {
      let job = this.store.getJob(messageKey);
      if (job) {
        insist(job.owner === owner && job.fingerprint === fingerprint, 'MESSAGE_REPLAY_CONFLICT', 'This message control ID has already been used with different data.', 409);
        if (job.state === 'sent') return { ...job.result, duplicate: true };
        // Recheck the current prescription before an unconfirmed transaction is retried.
        await this.validate(session, input.message, input.orderId);
      } else {
        const checked = await this.validate(session, input.message, input.orderId);
        const eventId = randomUUID(), courier = couriers.find(c => c.id === input.courierId);
        const eta = new Date(Date.now() + input.etaMinutes * 60000).toISOString();
        const dispense = dispenseResource(checked.order, checked.message, courier, eta, eventId, input.temperature);
        const event = auditEvent('dispatch-committed', '0', `${eventId}-audit`, `MedicationRequest/${checked.order.id}`);
        const notification = this.notification(courier, eta);
        this.store.append(auditEvent('dispatch-prepared', '0', eventId));
        job = this.store.createJob(owner, messageKey, fingerprint, { dispense, event, notification, medication: checked.terminology.request.name, dose: checked.message.dose });
      }
      // Persist the exact transaction before calling the EHR. Replays use the same tags,
      // so a lost HTTP response does not create duplicate chart entries.
      const locations = await this.client(session).transaction([job.body.dispense, job.body.event]);
      const result = { id: job.id, status: 'dispatched', notification: job.body.notification, locations, medication: job.body.medication,
        dispense: job.body.dispense, auditEvent: job.body.event, created: job.created };
      this.store.append(auditEvent('chart-write-confirmed', '0', randomUUID()));
      this.store.updateJob(job.id, 'sent', result);
      // The protected /api/notifications feed is the nurse-app delivery channel.
      return result;
    } catch (error) { this.store.append(auditEvent('dispatch-blocked-or-unconfirmed', '4', randomUUID())); throw error; }
    finally { this.locks.delete(messageKey); }
  }
}

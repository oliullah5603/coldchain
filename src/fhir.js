import { NS, RX, UCUM } from './config.js';
import { insist, jsonFetch } from './errors.js';
export class FhirClient {
  constructor(base, token) { this.base = base; this.token = token; }
  async request(path = '', options = {}) {
    return jsonFetch(`${this.base}${path}`, { ...options, headers: {
      Accept: 'application/fhir+json', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      ...(options.body ? { 'Content-Type': 'application/fhir+json' } : {}), ...options.headers
    } });
  }
  async orders(patient) {
    const data = await this.request(`/MedicationRequest?${new URLSearchParams({ patient, status: 'active', intent: 'order', _count: '50' })}`);
    insist(data.resourceType === 'Bundle', 'INVALID_FHIR', 'The EHR did not return a FHIR search bundle.', 502);
    return (data.entry || []).filter(e => e.resource?.resourceType === 'MedicationRequest').map(e => e.resource);
  }
  async getOrder(orderNumber, patient) {
    const bundle = await this.request(`/MedicationRequest?${new URLSearchParams({ identifier: `${NS}/order|${orderNumber}`, patient, _count: '2' })}`);
    const orders = (bundle.entry || []).filter(e => e.resource?.resourceType === 'MedicationRequest').map(e => e.resource);
    insist(orders.length === 1 && (!bundle.total || bundle.total === 1), 'ORDER_NOT_FOUND', 'Exactly one prescription must match this order in the current patient context.');
    return orders[0];
  }
  async medication(order) {
    if (order.medicationCodeableConcept) return order.medicationCodeableConcept;
    const ref = order.medicationReference?.reference;
    if (ref?.startsWith('#')) {
      const contained = order.contained?.find(r => `#${r.id}` === ref && r.resourceType === 'Medication');
      insist(contained?.code, 'MEDICATION_MISSING', 'The contained medication is missing.'); return contained.code;
    }
    insist(/^Medication\/[A-Za-z0-9.-]+$/.test(ref || ''), 'MEDICATION_REFERENCE', 'Medication references must be relative to this EHR.');
    const medication = await this.request(`/${ref}`);
    insist(medication.resourceType === 'Medication' && medication.code, 'MEDICATION_MISSING', 'The EHR medication is unavailable.');
    return medication.code;
  }
  async transaction(resources) {
    const bundle = { resourceType: 'Bundle', type: 'transaction', entry: resources.map(resource => ({
      resource, request: { method: 'POST', url: resource.resourceType,
        ifNoneExist: `_tag=${encodeURIComponent(`${NS}/event|${resource.meta.tag[0].code}`)}` }
    })) };
    const response = await this.request('', { method: 'POST', body: JSON.stringify(bundle) });
    insist(response.resourceType === 'Bundle' && response.type === 'transaction-response' && response.entry?.length === resources.length && response.entry.every(e => /^2\d\d\b/.test(e.response?.status || '')), 'FHIR_WRITE_UNCONFIRMED', 'The chart write is not confirmed. Retry this same dispatch; no alert has been released.', 502);
    return response.entry.map(e => e.response.location);
  }
}
export function validatePrescription(order, patient, message, contextPatient) {
  insist(order.status === 'active' && order.intent === 'order' && order.doNotPerform !== true, 'INACTIVE_ORDER', 'The prescription is not an active, authorized order.');
  insist(!order.modifierExtension?.length, 'UNSUPPORTED_MODIFIER', 'The prescription has modifiers requiring pharmacist review.');
  insist(order.subject?.reference === `Patient/${contextPatient}` && patient.id === contextPatient, 'PATIENT_MISMATCH', 'The prescription does not belong to the current patient.');
  insist(patient.identifier?.some(x => x.system === `${NS}/mrn` && x.value === message.mrn), 'PATIENT_MISMATCH', 'The HL7 patient identifier does not match the prescription patient.');
  const instructions = order.dosageInstruction || [];
  insist(instructions.length === 1 && instructions[0].doseAndRate?.length === 1 && !instructions[0].asNeededBoolean && !instructions[0].asNeededCodeableConcept && !instructions[0].modifierExtension?.length, 'COMPLEX_DOSE', 'This prescription needs pharmacist review: only a single fixed, non-PRN dose is supported.');
  const dose = instructions[0].doseAndRate[0].doseQuantity;
  insist(dose && !dose.comparator && dose.system === UCUM && dose.code === message.unit && dose.value === message.dose, 'DOSE_MISMATCH', 'The requested dose or unit does not match the original prescription.');
  insist(instructions[0].route?.coding?.some(x => x.system === 'http://snomed.info/sct' && x.code === message.route), 'ROUTE_MISMATCH', 'The administration route does not match the prescription.');
  const validity = order.dispenseRequest?.validityPeriod;
  insist((!validity?.start || Date.parse(validity.start) <= Date.now()) && (!validity?.end || Date.parse(validity.end) >= Date.now()), 'EXPIRED_ORDER', 'The prescription is outside its validity period.');
}
export function medicationCode(concept) {
  const codes = [...new Set((concept?.coding || []).filter(c => c.system === RX).map(c => c.code))];
  insist(codes.length === 1, 'MISSING_RXNORM', 'The prescription must contain one unambiguous RxNorm medication code.');
  return codes[0];
}
export function auditEvent(action, outcome = '0', id, entityReference) {
  return { resourceType: 'AuditEvent', meta: { tag: [{ system: `${NS}/event`, code: id }] },
    type: { system: 'http://terminology.hl7.org/CodeSystem/audit-event-type', code: 'rest' },
    subtype: [{ system: `${NS}/audit-action`, code: action }], action: action === 'prescription-read' ? 'R' : 'E',
    recorded: new Date().toISOString(), outcome,
    agent: [{ who: { identifier: { system: `${NS}/service`, value: 'coldchain' } }, requestor: true }],
    source: { observer: { identifier: { system: `${NS}/service`, value: 'pharmacy-gateway' } } },
    ...(entityReference ? { entity: [{ what: { reference: entityReference } }] } : {}) };
}
export function dispenseResource(order, message, courier, eta, eventId, temperature) {
  const now = new Date().toISOString();
  return { resourceType: 'MedicationDispense', meta: { tag: [{ system: `${NS}/event`, code: eventId }] },
    identifier: [{ system: `${NS}/delivery`, value: eventId }], status: 'completed',
    medicationCodeableConcept: { coding: [{ system: RX, code: message.rxcui }] },
    subject: order.subject, authorizingPrescription: [{ reference: `MedicationRequest/${order.id}` }],
    contained: [{ resourceType: 'Practitioner', id: 'courier', identifier: [{ system: `${NS}/courier`, value: courier.id }], name: [{ text: courier.name }] }],
    performer: [{ function: { coding: [{ system: `${NS}/performer-function`, code: 'courier' }] }, actor: { reference: '#courier' } }],
    whenPrepared: now, whenHandedOver: now, dosageInstruction: order.dosageInstruction,
    extension: [{ url: `${NS}/StructureDefinition/delivery-eta`, valueDateTime: eta },
      { url: `${NS}/StructureDefinition/pack-temperature`, valueQuantity: { value: temperature, system: UCUM, code: 'Cel', unit: '°C' } }],
    note: [{ text: 'Packed and handed to courier. Dispense completed at pharmacy; ward receipt is not asserted.' }] };
}

import { randomUUID } from 'node:crypto';
import { NS, RX, UCUM } from './config.js';
export function makeFixtures() {
  const patientId = `demo-${randomUUID()}`;
  const patient = { resourceType: 'Patient', id: patientId, active: true,
    identifier: [{ system: `${NS}/mrn`, value: `SYN-${randomUUID().slice(0, 8)}` }],
    name: [{ family: 'Example', given: ['Alex'] }], birthDate: '1988-04-12' };
  const orders = ['Evening dose', 'Midday dose', 'Scheduled dose'].map((label, index) => ({
    resourceType: 'MedicationRequest', id: `rx-${randomUUID()}`, status: 'active', intent: 'order',
    identifier: [{ system: `${NS}/order`, value: `ORD-${randomUUID().slice(0, 8)}` }],
    subject: { reference: `Patient/${patientId}` }, authoredOn: new Date().toISOString(),
    medicationCodeableConcept: { coding: [{ system: RX, code: '311041', display: 'insulin glargine 100 UNT/ML Injectable Solution' }] },
    dosageInstruction: [{ text: `${10 + index * 2} units subcutaneously`,
      route: { coding: [{ system: 'http://snomed.info/sct', code: '34206005', display: 'Subcutaneous route' }] },
      doseAndRate: [{ doseQuantity: { value: 10 + index * 2, unit: 'units', system: UCUM, code: '[IU]' } }] }],
    note: [{ text: label }]
  }));
  return { patient, orders };
}
// Generation, not parsing. OMP_O09 uses RXO (not RXE).
export function makeMessage(order, patient, { code = '311041', dose, controlId = randomUUID() } = {}) {
  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '+0000';
  return [
    `MSH|^~\\&|PHARMACY|DNA-DEMO|COLDCHAIN|DNA-DEMO|${timestamp}||OMP^O09^OMP_O09|${controlId}|T|2.5.1`,
    `PID|1||${patient.identifier[0].value}^^^DNA-DEMO^MR||Example^Alex||19880412`,
    `ORC|NW|${order.identifier[0].value}^DNA-DEMO`,
    `RXO|${code}^insulin glargine^RXNORM|${dose ?? order.dosageInstruction[0].doseAndRate[0].doseQuantity.value}||[IU]^units^UCUM`,
    'RXR|SC^Subcutaneous^HL70162'
  ].join('\r') + '\r';
}

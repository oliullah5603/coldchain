import hl7 from '@redoxengine/redox-hl7-v2';
import { insist, AppError } from './errors.js';
const parser = new hl7.Parser();
function segments(tree, name, result = []) {
  if (!tree || typeof tree !== 'object') return result;
  for (const [key, value] of Object.entries(tree)) {
    if (key === name) result.push(...(Array.isArray(value) ? value : [value]));
    else if (typeof value === 'object') segments(value, name, result);
  }
  return result;
}
const component = (field, number = '1') => typeof field === 'string' ? (number === '1' ? field : '') : field?.[number];
export function parseOrder(raw) {
  insist(typeof raw === 'string' && raw.length > 0 && raw.length <= 32768, 'INVALID_HL7', 'Provide an HL7 message under 32 KB.');
  let parsed;
  try { parsed = parser.parse(raw.replace(/\r?\n/g, '\r')); }
  catch { throw new AppError('INVALID_HL7', 'The Redox parser could not parse this HL7 message.'); }
  const one = name => { const values = segments(parsed, name); insist(values.length === 1, 'UNSUPPORTED_HL7', `Exactly one ${name} segment is required.`); return values[0]; };
  const msh = one('MSH'), pid = one('PID'), orc = one('ORC'), rxo = one('RXO'), rxr = one('RXR');
  insist(component(msh['9']) === 'OMP' && component(msh['9'], '2') === 'O09', 'WRONG_EVENT', 'Only OMP^O09 order events are accepted.');
  insist(component(msh['12']) === '2.5.1', 'WRONG_VERSION', 'This interface profile requires HL7 v2.5.1.');
  insist(orc['1'] === 'NW', 'WRONG_CONTROL', 'This release profile accepts ORC-1 NW only.');
  insist(segments(parsed, 'RXC').length === 0 && segments(parsed, 'TQ1').length === 0, 'COMPLEX_ORDER', 'Compound and timed orders need pharmacist review.');
  insist(component(rxo['1'], '3') === 'RXNORM', 'MISSING_RXNORM', 'RXO-1 must identify the medication using RXNORM.');
  insist(component(rxo['4'], '3') === 'UCUM' && component(rxo['4']) === '[IU]', 'UNSUPPORTED_UNIT', 'This demo interface accepts UCUM [IU] doses.');
  insist(component(rxr['1'], '3') === 'HL70162' && component(rxr['1']) === 'SC', 'ROUTE_MISMATCH', 'This profile supports subcutaneous administration only.');
  insist(!rxo['3'] || rxo['3'] === rxo['2'], 'DOSE_RANGE', 'Dose ranges require pharmacist review.');
  insist(typeof rxo['2'] === 'string' && /^\+?(?:\d+(?:\.\d*)?|\.\d+)$/.test(rxo['2']), 'INVALID_DOSE', 'The HL7 dose must be a positive decimal number.');
  const identifiers = Array.isArray(pid['3']) ? pid['3'] : [pid['3']];
  const matches = identifiers.filter(x => component(x, '5') === 'MR' && component(x?.['4']) === 'DNA-DEMO');
  insist(matches.length === 1, 'PATIENT_IDENTIFIER', 'One MR identifier from the configured DNA-DEMO assigning authority is required.');
  insist(component(orc['2'], '2') === 'DNA-DEMO', 'ORDER_AUTHORITY', 'The order assigning authority is not supported.');
  const result = { controlId: msh['10'], sender: component(msh['3']), facility: component(msh['4']),
    mrn: component(matches[0]), orderNumber: component(orc['2']), rxcui: component(rxo['1']), dose: Number(rxo['2']), unit: '[IU]', route: '34206005' };
  insist([result.controlId, result.sender, result.facility, result.mrn, result.orderNumber].every(x => typeof x === 'string' && x.length > 0 && x.length <= 100), 'MISSING_FIELD', 'Required message identifiers are missing or too long.');
  insist(/^\d+$/.test(result.rxcui || '') && Number.isFinite(result.dose) && result.dose > 0, 'INVALID_DOSE', 'A coded drug and positive numeric dose are required.');
  return result;
}

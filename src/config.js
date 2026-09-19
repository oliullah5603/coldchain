import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const NS = 'https://coldchain.example/fhir';
export const RX = 'http://www.nlm.nih.gov/research/umls/rxnorm';
export const UCUM = 'http://unitsofmeasure.org';
export function config(overrides = {}) {
  const port = Number(process.env.PORT || 4310);
  const origin = (process.env.APP_ORIGIN || process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`).replace(/\/$/, '');
  const mode = process.env.EHR_MODE || 'demo';
  const result = { port, origin, host: process.env.HOST || '127.0.0.1', mode, rxMode: process.env.RXNORM_MODE || 'live',
    dataDir: path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data')),
    fhirBase: mode === 'demo' ? `${origin}/demo-ehr/fhir` : process.env.FHIR_BASE_URL,
    clientId: process.env.SMART_CLIENT_ID || 'coldchain-demo',
    clientSecret: process.env.SMART_CLIENT_SECRET,
    auditKey: process.env.AUDIT_KEY,
    authOrigins: (process.env.SMART_ALLOWED_AUTH_ORIGINS || origin).split(','), ...overrides };
  if (!['demo', 'smart', 'hapi'].includes(result.mode)) throw new Error('Invalid EHR_MODE');
  if (!['live', 'snapshot'].includes(result.rxMode)) throw new Error('Invalid RXNORM_MODE');
  if (!result.fhirBase) throw new Error('FHIR_BASE_URL required');
  result.fhirBase = result.fhirBase.replace(/\/$/, '');
  if (result.mode === 'smart' && (!result.fhirBase.startsWith('https://') || !result.origin.startsWith('https://'))) {
    throw new Error('External SMART mode requires HTTPS for EHR and app origin');
  }
  if (result.mode === 'hapi' && !['hapi.fhir.org', 'localhost', '127.0.0.1'].includes(new URL(result.fhirBase).hostname)) {
    throw new Error('Unauthenticated HAPI test mode is limited to localhost or the public HAPI sandbox');
  }
  return result;
}

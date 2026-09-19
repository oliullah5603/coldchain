import { randomUUID } from 'node:crypto';
import { insist } from './errors.js';
export function installDemoEhr(app, store, fixtures, auth, cfg) {
  if (cfg.mode !== 'demo') return;
  for (const resource of [fixtures.patient, ...fixtures.orders]) if (!store.readFHIR(resource.resourceType, resource.id)) store.saveFHIR(resource);
  app.use('/demo-ehr/fhir', (req, res, next) => {
    try {
      const grant = auth.demoTokens.get(req.headers.authorization?.replace(/^Bearer /, ''));
      insist(grant?.expires > Date.now(), 'FHIR_AUTH', 'A valid sandbox access token is required.', 401);
      next();
    } catch (error) { next(error); }
  });
  app.get('/demo-ehr/fhir/metadata', (req, res) => res.json({ resourceType: 'CapabilityStatement', status: 'active', date: '2026-09-19', kind: 'instance', fhirVersion: '4.0.1', format: ['json'], rest: [{ mode: 'server', interaction: [{ code: 'transaction' }] }] }));
  app.get('/demo-ehr/fhir/:type/:id', (req, res) => {
    const resource = store.readFHIR(req.params.type, req.params.id);
    insist(resource, 'FHIR_NOT_FOUND', 'Resource not found.', 404); res.json(resource);
  });
  app.get('/demo-ehr/fhir/:type', (req, res) => {
    let resources = store.searchFHIR(req.params.type);
    for (const [key, value] of Object.entries(req.query)) {
      if (key === 'patient') resources = resources.filter(r => r.subject?.reference === `Patient/${value}`);
      if (['status', 'intent'].includes(key)) resources = resources.filter(r => r[key] === value);
      if (key === 'identifier') resources = resources.filter(r => r.identifier?.some(i => `${i.system}|${i.value}` === value));
      if (key === '_tag') resources = resources.filter(r => r.meta?.tag?.some(t => `${t.system}|${t.code}` === value));
    }
    res.json({ resourceType: 'Bundle', type: 'searchset', total: resources.length, entry: resources.slice(0, Number(req.query._count) || 50).map(resource => ({ resource })) });
  });
  app.post('/demo-ehr/fhir', (req, res) => {
    const bundle = req.body;
    insist(bundle.resourceType === 'Bundle' && bundle.type === 'transaction' && bundle.entry?.length === 2, 'INVALID_BUNDLE', 'A dispense and audit transaction is required.', 400);
    store.db.exec('BEGIN IMMEDIATE');
    try {
      const entry = bundle.entry.map(item => {
        insist(['MedicationDispense', 'AuditEvent'].includes(item.resource?.resourceType) && item.request?.method === 'POST' && item.request.url === item.resource.resourceType, 'INVALID_ENTRY', 'Unsupported transaction entry.', 400);
        const tag = new URLSearchParams(item.request.ifNoneExist).get('_tag');
        insist(tag && item.resource.meta?.tag?.some(t => `${t.system}|${t.code}` === tag), 'MISSING_IDEMPOTENCY', 'An event tag is required.', 400);
        const existing = store.searchFHIR(item.resource.resourceType).find(r => r.meta?.tag?.some(t => `${t.system}|${t.code}` === tag));
        const resource = existing || { ...item.resource, id: randomUUID() };
        if (!existing) store.saveFHIR(resource);
        return { response: { status: existing ? '200 OK' : '201 Created', location: `${resource.resourceType}/${resource.id}/_history/1` } };
      });
      store.db.exec('COMMIT'); res.json({ resourceType: 'Bundle', type: 'transaction-response', entry });
    } catch (error) { store.db.exec('ROLLBACK'); throw error; }
  });
}

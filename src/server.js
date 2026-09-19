import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { config, ROOT } from './config.js';
import { Store } from './store.js';
import { RxNorm } from './rxnorm.js';
import { makeFixtures, makeMessage } from './fixtures.js';
import { installAuth } from './auth.js';
import { installDemoEhr } from './demo-ehr.js';
import { Workflow, couriers } from './workflow.js';
import { auditEvent } from './fhir.js';
import { AppError, insist } from './errors.js';
export function createApp(cfg = config()) {
  const app = express(), store = new Store(cfg.dataDir, cfg.auditKey);
  const fixtures = store.fixture(makeFixtures), workflow = new Workflow(store, new RxNorm(cfg.rxMode), cfg);
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], frameAncestors: ["'self'"], upgradeInsecureRequests: cfg.origin.startsWith('https:') ? [] : null } }, strictTransportSecurity: cfg.origin.startsWith('https:') ? undefined : false }));
  app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); res.set('Referrer-Policy', 'no-referrer'); next(); });
  app.use(express.json({ limit: '40kb', type: ['application/json', 'application/fhir+json'] }));
  app.use(express.urlencoded({ extended: false, limit: '8kb' }));
  app.get('/healthz', (req, res) => res.json({ status: 'ok' }));
  const auth = installAuth(app, cfg, store, fixtures);
  installDemoEhr(app, store, fixtures, auth, cfg);
  app.get('/api/session', (req, res) => res.json({ authenticated: Boolean(req.session && !req.session.pending),
    mode: cfg.mode, rxMode: cfg.rxMode, csrf: req.session?.csrf,
    ...(req.session && !req.session.pending ? { patient: req.session.patient, couriers } : {}) }));
  app.use('/api', auth.requireSession);
  app.get('/api/orders', async (req, res) => {
    const client = workflow.client(req.session);
    const [patient, orders] = await Promise.all([client.request(`/Patient/${req.session.patient}`), client.orders(req.session.patient)]);
    store.append(auditEvent('prescription-read', '0', randomUUID()));
    res.json({ patient, orders, ...(cfg.mode !== 'smart' ? { samples: orders.map(order => ({ orderId: order.id, message: makeMessage(order, patient), mismatch: makeMessage(order, patient, { code: '847232' }), wrongDose: makeMessage(order, patient, { dose: 99 }) })) } : {}) });
  });
  app.post('/api/validate', async (req, res) => res.json(await workflow.preview(req.session, req.body?.message, req.body?.orderId)));
  app.post('/api/dispatch', async (req, res) => res.json(await workflow.dispatch(req.session, req.body)));
  app.get('/api/deliveries', (req, res) => res.json(store.jobs(workflow.owner(req.session)).map(j => ({ id: j.id, state: j.state, created: j.created, result: j.result }))));
  app.get('/api/notifications', (req, res) => res.json(store.jobs(workflow.owner(req.session)).filter(j => j.state === 'sent').map(j => j.result.notification)));
  app.get('/api/audit', (req, res) => {
    // Operational audit view excludes clinical references; raw remote FHIR AuditEvents
    // remain controlled by the EHR's access rules.
    res.json({ integrity: store.verify(), entries: store.auditRows().map(row => ({ seq: row.seq, hash: row.hash, previous: row.previous,
      recorded: row.event.recorded, action: row.event.outcomeDesc || row.event.subtype?.[0]?.code, outcome: row.event.outcome })) });
  });
  app.get('/api/resources/:id', (req, res) => {
    const job = store.getJobId(req.params.id);
    insist(job && job.owner === workflow.owner(req.session), 'NOT_FOUND', 'Delivery not found.', 404);
    res.json({ dispense: job.body.dispense, auditEvent: job.body.event, notification: job.state === 'sent' ? job.body.notification : null });
  });
  app.use(express.static(path.join(ROOT, 'public')));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const known = error instanceof AppError;
    const status = known ? error.status : error.type === 'entity.too.large' ? 413 : error.type === 'entity.parse.failed' ? 400 : 500;
    // Do not log raw HL7, OAuth credentials, upstream bodies, or patient data.
    if (status === 500) console.error('Request failed:', error.code || error.name);
    res.status(status).json({ code: known ? error.code : 'REQUEST_FAILED', message: known ? error.message : 'The request could not be completed safely.' });
  });
  return { app, cfg, store, workflow, fixtures, auth, close() { auth.close(); store.close(); } };
}
export function startServer(cfg = config()) {
  const runtime = createApp(cfg);
  const server = runtime.app.listen(runtime.cfg.port, runtime.cfg.host, error => {
    if (error) { console.error(`Server could not start: ${error.code}`); runtime.close(); process.exitCode = 1; return; }
    console.log(`Coldchain: ${runtime.cfg.origin} | EHR: ${runtime.cfg.mode} | RxNorm: ${runtime.cfg.rxMode}`);
  });
  const stop = () => server.close(() => { runtime.close(); process.exit(0); });
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  startServer();
}

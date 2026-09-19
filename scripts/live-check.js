import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
import { config } from '../src/config.js';
import { makeMessage } from '../src/fixtures.js';
const base = 'https://hapi.fhir.org/baseR4';
const dataDir = mkdtempSync(path.join(tmpdir(), 'coldchain-live-'));
const cfg = config({ mode: 'hapi', fhirBase: base, dataDir, rxMode: 'live' });
const runtime = createApp(cfg);
const server = await new Promise(resolve => { const s = runtime.app.listen(0, '127.0.0.1', () => resolve(s)); });
cfg.origin = `http://127.0.0.1:${server.address().port}`; cfg.authOrigins = [cfg.origin];
const report = { checkedAt: new Date().toISOString(), fhirBase: base, rxnorm: 'https://rxnav.nlm.nih.gov/REST', checks: [] };
try {
  const metadata = await fetch(`${base}/metadata`, { signal: AbortSignal.timeout(30000) }).then(r => r.json());
  assert.equal(metadata.fhirVersion, '4.0.1'); report.checks.push('HAPI advertises FHIR R4 4.0.1');
  const resources = [runtime.fixtures.patient, ...runtime.fixtures.orders];
  const seed = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/fhir+json' }, body: JSON.stringify({ resourceType: 'Bundle', type: 'transaction', entry: resources.map(resource => ({ resource, request: { method: 'PUT', url: `${resource.resourceType}/${resource.id}` } })) }), signal: AbortSignal.timeout(30000) });
  assert.equal(seed.ok, true); report.checks.push('Seeded synthetic Patient and MedicationRequest resources');
  let cookie = '', url = `${cfg.origin}/auth/launch`;
  for (let i = 0; i < 5; i++) {
    const response = await fetch(url, { redirect: 'manual', headers: { Cookie: cookie } });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    if (response.status !== 302) break;
    url = new URL(response.headers.get('location'), cfg.origin).href;
  }
  const session = await fetch(`${cfg.origin}/api/session`, { headers: { Cookie: cookie } }).then(r => r.json());
  assert.equal(session.authenticated, true); report.checks.push('Local PKCE authorization completed (public HAPI has no SMART authorization)');
  const headers = { Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf };
  const orders = await fetch(`${cfg.origin}/api/orders`, { headers }).then(r => r.json());
  assert.equal(orders.orders.length, 3); report.checks.push('Queried live HAPI prescriptions by patient launch context');
  const message = makeMessage(runtime.fixtures.orders[0], runtime.fixtures.patient);
  const response = await fetch(`${cfg.origin}/api/dispatch`, { method: 'POST', headers, body: JSON.stringify({ orderId: runtime.fixtures.orders[0].id, message, courierId: 'courier-01', etaMinutes: 15, temperature: 4, sealed: true }) });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  report.checks.push('Live RxNorm formulation check passed; HAPI committed MedicationDispense and AuditEvent');
  report.locations = result.locations;
  for (const location of result.locations) {
    const record = await fetch(`${base}/${location}`, { signal: AbortSignal.timeout(30000) }).then(r => r.json());
    assert.ok(['MedicationDispense', 'AuditEvent'].includes(record.resourceType));
  }
  report.checks.push('Read both committed resources back from HAPI');
  const replay = await fetch(`${cfg.origin}/api/dispatch`, { method: 'POST', headers, body: JSON.stringify({ orderId: runtime.fixtures.orders[0].id, message, courierId: 'courier-01', etaMinutes: 15, temperature: 4, sealed: true }) }).then(r => r.json());
  assert.equal(replay.duplicate, true); report.checks.push('Replay returned original result without another dispatch');
  const notifications = await fetch(`${cfg.origin}/api/notifications`, { headers }).then(r => r.json());
  assert.deepEqual(Object.keys(notifications[0]).sort(), ['body', 'courier', 'eta', 'title']);
  report.checks.push('Nurse-app alert contains only allowlisted delivery fields');
  report.audit = runtime.store.verify(); assert.equal(report.audit.valid, true);
  report.success = true;
} catch (error) { report.success = false; report.error = error.message; process.exitCode = 1; }
finally {
  writeFileSync('docs/live-verification.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await new Promise(resolve => server.close(resolve)); runtime.close();
}

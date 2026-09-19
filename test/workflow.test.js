import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.js';
import { config } from '../src/config.js';
import { challenge } from '../src/auth.js';
import { makeMessage } from '../src/fixtures.js';
import { parseOrder } from '../src/hl7.js';
import { RxNorm } from '../src/rxnorm.js';
import { validatePrescription } from '../src/fhir.js';
let runtime, server, origin, cookie, session, temp;
async function request(route, body, options = {}) {
  const response = await fetch(`${origin}${route}`, { ...options, headers: { Cookie: cookie || '', ...(body ? { 'Content-Type': 'application/json', 'X-CSRF-Token': session?.csrf || '' } : {}), ...options.headers }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: await response.json() };
}
before(async () => {
  temp = mkdtempSync(path.join(tmpdir(), 'coldchain-test-'));
  const cfg = config({ dataDir: temp, rxMode: 'snapshot', mode: 'demo', auditKey: 'test-only-secret-do-not-use-in-production' });
  runtime = createApp(cfg);
  server = await new Promise(resolve => { const s = runtime.app.listen(0, '127.0.0.1', () => resolve(s)); });
  origin = `http://127.0.0.1:${server.address().port}`;
  cfg.origin = origin; cfg.fhirBase = `${origin}/demo-ehr/fhir`; cfg.authOrigins = [origin];
  let url = `${origin}/auth/launch`;
  for (let i = 0; i < 5; i++) {
    const response = await fetch(url, { redirect: 'manual', headers: { Cookie: cookie || '' } });
    const set = response.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    if (response.status !== 302) break;
    url = new URL(response.headers.get('location'), origin).href;
  }
  const result = await request('/api/session'); session = result.data;
  assert.equal(session.authenticated, true, 'PKCE launch completed');
});
after(async () => { await new Promise(resolve => server.close(resolve)); runtime.close(); rmSync(temp, { recursive: true, force: true }); });
const sample = (options = {}) => makeMessage(runtime.fixtures.orders[0], runtime.fixtures.patient, options);
const input = (options = {}) => ({ orderId: runtime.fixtures.orders[0].id, message: sample(), courierId: 'courier-01', etaMinutes: 15, temperature: 4, sealed: true, ...options });

test('Selected prescription must match the pasted HL7 order', async () => {
  const orderId = runtime.fixtures.orders[1].id;
  const before = runtime.store.searchFHIR('MedicationDispense').length;
  const preview = await request('/api/validate', { message: sample(), orderId });
  assert.equal(preview.status, 422);
  assert.equal(preview.data.code, 'SELECTED_ORDER_MISMATCH');
  const release = await request('/api/dispatch', input({ orderId }));
  assert.equal(release.data.code, 'SELECTED_ORDER_MISMATCH');
  assert.equal(runtime.store.searchFHIR('MedicationDispense').length, before);
});

test('Dose text must be an HL7 decimal, never hexadecimal or JavaScript exponent syntax', () => {
  for (const value of ['0xA', '1e1']) assert.throws(() => parseOrder(sample().replace('|10||', `|${value}||`)));
});

test('Unsupported dosing schedules, rates and modifiers require pharmacist review', () => {
  const patient = runtime.fixtures.patient, parsed = parseOrder(sample());
  for (const extra of [{ timing: { repeat: { frequency: 2, period: 1, periodUnit: 'd' } } },
    { doseAndRate: [{ doseQuantity: runtime.fixtures.orders[0].dosageInstruction[0].doseAndRate[0].doseQuantity, rateQuantity: { value: 1 } }] },
    { maxDosePerAdministration: { value: 5, system: 'http://unitsofmeasure.org', code: '[IU]' } }]) {
    const order = structuredClone(runtime.fixtures.orders[0]);
    Object.assign(order.dosageInstruction[0], extra);
    assert.throws(() => validatePrescription(order, patient, parsed, patient.id));
  }
});

test('RxNorm equivalence cannot silently authorize product substitution', async () => {
  const compare = runtime.workflow.rxnorm.compare;
  runtime.workflow.rxnorm.compare = async (expected, requested) => ({ prescription: { code: expected, clinicalCode: 'same' }, request: { code: requested, clinicalCode: 'same' } });
  try {
    const result = await request('/api/dispatch', input({ message: sample({ code: '999999' }) }));
    assert.equal(result.status, 422);
    assert.equal(result.data.code, 'SUBSTITUTION_REVIEW');
  } finally { runtime.workflow.rxnorm.compare = compare; }
});

test('Expired sessions and requests with an incorrect Origin are rejected', async () => {
  const current = runtime.auth.sessions.get(cookie.slice('coldchain_session='.length));
  const expiry = current.expires;
  try {
    current.expires = Date.now() - 1;
    assert.equal((await request('/api/orders')).status, 401);
  } finally { current.expires = expiry; }
  assert.equal((await request('/api/validate', { message: sample() }, { headers: { Origin: 'https://untrusted.example' } })).status, 403);
});
test('Unauthenticated access and missing CSRF are rejected', async () => {
  assert.equal((await request('/api/orders', undefined, { headers: { Cookie: '' } })).status, 401);
  assert.equal((await request('/api/validate', { message: sample() }, { headers: { 'X-CSRF-Token': '' } })).status, 403);
});
test('SMART rejects untrusted issuer and invalid callback state', async () => {
  assert.equal((await request('/auth/launch?iss=https://evil.example')).status, 400);
  assert.equal((await request('/auth/callback?state=wrong&code=wrong')).status, 400);
});
test('OAuth authorization code cannot be redeemed without its PKCE verifier', async () => {
  const params = new URLSearchParams({ client_id: runtime.cfg.clientId, redirect_uri: `${origin}/auth/callback`, aud: runtime.cfg.fhirBase,
    response_type: 'code', code_challenge_method: 'S256', code_challenge: challenge('correct-secret-verifier'), state: 'test-state' });
  const authorize = await fetch(`${origin}/demo-ehr/authorize?${params}`, { redirect: 'manual' });
  assert.equal(authorize.status, 302);
  const code = new URL(authorize.headers.get('location')).searchParams.get('code');
  const response = await fetch(`${origin}/demo-ehr/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, grant_type: 'authorization_code', client_id: runtime.cfg.clientId, redirect_uri: `${origin}/auth/callback`, code_verifier: 'wrong-verifier' }) });
  assert.equal(response.status, 400);
});
test('Read actual HTTP FHIR prescriptions using launch context', async () => {
  const result = await request('/api/orders');
  assert.equal(result.status, 200); assert.equal(result.data.orders.length, 3);
  assert.equal(result.data.patient.id, session.patient);
  assert.ok(result.data.orders.every(o => o.subject.reference === `Patient/${session.patient}`));
});
test('Redox parses OMP O09 without manual segment splitting', () => {
  const result = parseOrder(sample()); assert.equal(result.rxcui, '311041'); assert.equal(result.dose, 10); assert.equal(result.route, '34206005');
  assert.equal(parseOrder(sample().replaceAll('\r', '\n')).dose, 10);
});
test('Malformed event, incorrect unit, wrong route and multiple orders fail closed', () => {
  for (const msg of ['garbage', sample().replace('OMP^O09', 'RAS^O17'), sample().replace('[IU]^units^UCUM', 'mg^milligram^UCUM'), sample().replace('SC^Subcutaneous', 'IV^Intravenous'), sample() + 'ORC|NW|SECOND^DNA-DEMO\rRXO|311041^insulin^RXNORM|10||[IU]^units^UCUM\rRXR|SC^Subcutaneous^HL70162\r']) assert.throws(() => parseOrder(msg));
});
test('RxNorm verifies formulation with recorded official clinical-drug concepts', async () => {
  const result = await new RxNorm('snapshot').compare('311041', '311041'); assert.equal(result.prescription.clinicalCode, '311041');
  await assert.rejects(new RxNorm('snapshot').compare('311041', '847232'), { code: 'FORMULATION_MISMATCH' });
});
test('Different dose, patient identity and formulation are blocked without chart writes', async () => {
  for (const message of [sample({ dose: 99 }), sample({ code: '847232' }), sample().replace(runtime.fixtures.patient.identifier[0].value, 'WRONG-MRN')]) {
    const result = await request('/api/dispatch', input({ message })); assert.equal(result.status, 422);
  }
  assert.equal(runtime.store.searchFHIR('MedicationDispense').length, 0);
});
test('Inactive, do-not-perform and ambiguous dosage prescriptions fail closed', () => {
  const original = runtime.fixtures.orders[0]; const patient = runtime.fixtures.patient; const parsed = parseOrder(sample());
  for (const changes of [{ status: 'cancelled' }, { doNotPerform: true }, { dosageInstruction: [] }, { modifierExtension: [{ url: 'https://example.org/modifier', valueBoolean: true }] }]) assert.throws(() => validatePrescription({ ...original, ...changes }, patient, parsed, patient.id));
});
test('Temperature excursion and unsealed packaging block release', async () => {
  assert.equal((await request('/api/dispatch', input({ temperature: 9 }))).status, 422);
  assert.equal((await request('/api/dispatch', input({ sealed: false }))).status, 422);
});
test('Valid dispatch writes MedicationDispense + AuditEvent and only then exposes a PHI-free alert', async () => {
  const payload = input(); const result = await request('/api/dispatch', payload);
  assert.equal(result.status, 200); assert.equal(result.data.status, 'dispatched'); assert.equal(result.data.locations.length, 2);
  const dispense = runtime.store.searchFHIR('MedicationDispense')[0];
  assert.equal(dispense.resourceType, 'MedicationDispense'); assert.equal(dispense.subject.reference, `Patient/${session.patient}`);
  assert.ok(dispense.whenPrepared <= dispense.whenHandedOver); assert.ok(dispense.extension.some(x => x.url.endsWith('/delivery-eta')));
  assert.equal(runtime.store.searchFHIR('AuditEvent').length, 1);
  const alerts = (await request('/api/notifications')).data;
  assert.deepEqual(Object.keys(alerts[0]).sort(), ['body', 'courier', 'eta', 'title']);
  const alert = JSON.stringify(alerts);
  for (const forbidden of ['Alex', 'Example', session.patient, runtime.fixtures.patient.identifier[0].value, '1988-04-12', 'insulin', '311041']) assert.ok(!alert.includes(forbidden));
  const replay = await request('/api/dispatch', payload);
  assert.equal(replay.data.duplicate, true); assert.equal(runtime.store.searchFHIR('MedicationDispense').length, 1);
  assert.equal((await request('/api/notifications')).data.length, 1);
  assert.equal((await request('/api/dispatch', { ...payload, etaMinutes: 20 })).status, 409);
});
test('Unknown FHIR transaction result keeps notification private and retry reconciles without duplicate resources', async () => {
  const realClient = runtime.workflow.client.bind(runtime.workflow);
  let lostOnce = false;
  runtime.workflow.client = s => {
    const client = realClient(s), transaction = client.transaction.bind(client);
    client.transaction = async resources => {
      const response = await transaction(resources);
      if (!lostOnce) { lostOnce = true; throw new Error('Simulated lost HTTP response'); }
      return response;
    }; return client;
  };
  const payload = input(); const before = runtime.store.searchFHIR('MedicationDispense').length;
  const result = await request('/api/dispatch', payload); assert.equal(result.status, 500);
  assert.equal(runtime.store.searchFHIR('MedicationDispense').length, before + 1);
  assert.equal((await request('/api/notifications')).data.length, before);
  const retry = await request('/api/dispatch', payload); assert.equal(retry.status, 200);
  assert.equal(runtime.store.searchFHIR('MedicationDispense').length, before + 1);
  assert.equal((await request('/api/notifications')).data.length, before + 1);
  runtime.workflow.client = realClient;
});
test('RxNorm outage does not silently fall back or dispatch', async () => {
  const compare = runtime.workflow.rxnorm.compare;
  runtime.workflow.rxnorm.compare = async () => { throw new Error('offline'); };
  const before = runtime.store.searchFHIR('MedicationDispense').length;
  assert.equal((await request('/api/dispatch', input())).status, 500);
  assert.equal(runtime.store.searchFHIR('MedicationDispense').length, before);
  runtime.workflow.rxnorm.compare = compare;
});
test('A different patient session cannot read another patient delivery or notification', async () => {
  const sid = cookie.slice('coldchain_session='.length), current = runtime.auth.sessions.get(sid);
  const patient = current.patient;
  const job = runtime.store.jobs(runtime.workflow.owner(current))[0];
  current.patient = 'another-synthetic-patient';
  try {
    assert.deepEqual((await request('/api/notifications')).data, []);
    assert.deepEqual((await request('/api/deliveries')).data, []);
    assert.equal((await request(`/api/resources/${job.id}`)).status, 404);
  } finally { current.patient = patient; }
});
test('Audit records reject ordinary mutation; a privileged alteration is detected and blocks release', async () => {
  assert.equal(runtime.store.verify().valid, true);
  assert.throws(() => runtime.store.db.exec("UPDATE audit SET event='{}' WHERE seq=1"), /append-only/);
  assert.throws(() => runtime.store.db.exec('DELETE FROM audit WHERE seq=1'), /append-only/);
  runtime.store.db.exec("DROP TRIGGER audit_no_update; UPDATE audit SET event='{}' WHERE seq=1");
  assert.equal(runtime.store.verify().valid, false);
  assert.equal((await request('/api/dispatch', input())).status, 503);
});

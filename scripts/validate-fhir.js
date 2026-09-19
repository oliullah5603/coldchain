import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { makeFixtures, makeMessage } from '../src/fixtures.js';
import { parseOrder } from '../src/hl7.js';
import { auditEvent, dispenseResource } from '../src/fhir.js';
const fixtures = makeFixtures(), order = fixtures.orders[0];
const resources = [fixtures.patient, order,
  dispenseResource(order, parseOrder(makeMessage(order, fixtures.patient)), { id: 'courier-01', name: 'Synthetic courier' }, new Date(Date.now() + 900000).toISOString(), randomUUID(), 4),
  auditEvent('dispatch-committed', '0', randomUUID())];
const report = { checkedAt: new Date().toISOString(), server: 'https://hapi.fhir.org/baseR4', results: [] };
// Give the validator real synthetic reference targets; otherwise it correctly
// reports unresolved Patient/MedicationRequest references rather than schema errors.
const seed = await fetch(report.server, { method: 'POST', headers: { 'Content-Type': 'application/fhir+json' },
  body: JSON.stringify({ resourceType: 'Bundle', type: 'transaction', entry: [fixtures.patient, order].map(resource => ({ resource, request: { method: 'PUT', url: `${resource.resourceType}/${resource.id}` } })) }),
  signal: AbortSignal.timeout(30000) });
if (!seed.ok) throw new Error(`Synthetic reference seed failed: HTTP ${seed.status}`);
const seeded = await seed.json();
if (seeded.type !== 'transaction-response' || !seeded.entry?.every(entry => /^2\d\d/.test(entry.response?.status))) throw new Error('Synthetic reference seed was not confirmed');
const checks = await Promise.allSettled(resources.map(async resource => {
  const response = await fetch(`${report.server}/${resource.resourceType}/$validate`, {
    method: 'POST', headers: { 'Content-Type': 'application/fhir+json', Accept: 'application/fhir+json' },
    body: JSON.stringify(resource), signal: AbortSignal.timeout(45000)
  });
  const outcome = await response.json();
  return { resourceType: resource.resourceType, status: response.status, outcomeType: outcome.resourceType,
    issues: (outcome.issue || []).map(({ severity, code, diagnostics, details, expression }) => ({ severity, code, diagnostics: diagnostics || details?.text, expression })) };
}));
report.results = checks.map((check, i) => check.status === 'fulfilled' ? check.value : { resourceType: resources[i].resourceType, error: check.reason.message });
report.success = report.results.every(result => !result.error && result.status === 200 && result.outcomeType === 'OperationOutcome' && !result.issues.some(issue => ['error', 'fatal'].includes(issue.severity)));
writeFileSync('docs/fhir-validation.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (!report.success) process.exitCode = 1;

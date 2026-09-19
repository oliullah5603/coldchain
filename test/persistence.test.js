import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { auditEvent } from '../src/fhir.js';
test('Prepared dispatch and verified audit history survive a process-store restart', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'coldchain-persist-'));
  let store;
  try {
    store = new Store(dir); store.append(auditEvent('dispatch-prepared', '0', 'test-event'));
    const job = store.createJob('owner', 'message', 'fingerprint', { synthetic: true }); const head = store.verify().head;
    store.close(); store = new Store(dir);
    assert.equal(store.getJobId(job.id).state, 'prepared'); assert.equal(store.verify().valid, true); assert.equal(store.verify().head, head);
  } finally { store?.close(); rmSync(dir, { recursive: true, force: true }); }
});

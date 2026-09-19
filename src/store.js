import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { insist } from './errors.js';
export const canonical = value => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
};
export class Store {
  constructor(dir, suppliedKey) {
    mkdirSync(dir, { recursive: true });
    const keyPath = path.join(dir, 'audit.key');
    if (!suppliedKey && !existsSync(keyPath)) writeFileSync(keyPath, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
    this.key = suppliedKey || readFileSync(keyPath, 'utf8');
    insist(this.key.length >= 32, 'AUDIT_KEY', 'AUDIT_KEY must contain at least 32 characters.', 500);
    this.db = new DatabaseSync(path.join(dir, 'coldchain.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS audit(seq INTEGER PRIMARY KEY AUTOINCREMENT, event TEXT NOT NULL, previous TEXT NOT NULL, hash TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT, 'Audit rows are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT, 'Audit rows are append-only'); END;
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, owner TEXT NOT NULL, message_key TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL, state TEXT NOT NULL, body TEXT NOT NULL, result TEXT, created TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS fixtures(id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS fhir(type TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(type,id));
    `);
  }
  sign(value) { return createHmac('sha256', this.key).update(canonical(value)).digest('hex'); }
  append(event) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const previous = this.db.prepare('SELECT hash FROM audit ORDER BY seq DESC LIMIT 1').get()?.hash || '0'.repeat(64);
      const body = canonical(event);
      const hash = this.sign({ previous, event });
      this.db.prepare('INSERT INTO audit(event,previous,hash) VALUES(?,?,?)').run(body, previous, hash);
      this.db.exec('COMMIT');
      return { event, previous, hash };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  verify() {
    let previous = '0'.repeat(64), count = 0;
    for (const row of this.db.prepare('SELECT * FROM audit ORDER BY seq').all()) {
      let event;
      try { event = JSON.parse(row.event); } catch { return { valid: false, count, failedSequence: row.seq }; }
      if (row.seq !== count + 1) return { valid: false, count, failedSequence: row.seq };
      const expected = this.sign({ previous, event });
      if (row.previous !== previous || row.hash.length !== expected.length || !timingSafeEqual(Buffer.from(row.hash), Buffer.from(expected))) return { valid: false, count, failedSequence: row.seq };
      previous = row.hash; count++;
    }
    return { valid: true, count, head: previous };
  }
  auditRows(limit = 40) { return this.db.prepare('SELECT * FROM audit ORDER BY seq DESC LIMIT ?').all(limit).map(r => ({ ...r, event: JSON.parse(r.event) })); }
  fixture(factory) {
    let row = this.db.prepare('SELECT body FROM fixtures WHERE id=1').get();
    if (!row) { const body = JSON.stringify(factory()); this.db.prepare('INSERT INTO fixtures VALUES(1,?)').run(body); row = { body }; }
    return JSON.parse(row.body);
  }
  getJob(key) { return this.decodeJob(this.db.prepare('SELECT * FROM jobs WHERE message_key=?').get(key)); }
  getJobId(id) { return this.decodeJob(this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id)); }
  decodeJob(row) { return row ? { ...row, body: JSON.parse(row.body), result: row.result ? JSON.parse(row.result) : null } : null; }
  createJob(owner, messageKey, fingerprint, body) {
    const id = randomUUID();
    this.db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?)').run(id, owner, messageKey, fingerprint, 'prepared', JSON.stringify(body), null, new Date().toISOString());
    return this.getJobId(id);
  }
  updateJob(id, state, result) { this.db.prepare('UPDATE jobs SET state=?,result=? WHERE id=?').run(state, JSON.stringify(result), id); }
  jobs(owner) { return this.db.prepare('SELECT * FROM jobs WHERE owner=? ORDER BY created DESC LIMIT 50').all(owner).map(r => this.decodeJob(r)); }
  saveFHIR(resource) { this.db.prepare('INSERT OR REPLACE INTO fhir VALUES(?,?,?)').run(resource.resourceType, resource.id, JSON.stringify(resource)); }
  readFHIR(type, id) { const row = this.db.prepare('SELECT body FROM fhir WHERE type=? AND id=?').get(type, id); return row ? JSON.parse(row.body) : null; }
  searchFHIR(type) { return this.db.prepare('SELECT body FROM fhir WHERE type=?').all(type).map(r => JSON.parse(r.body)); }
  close() { this.db.close(); }
}

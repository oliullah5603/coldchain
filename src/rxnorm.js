import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';
import { insist, jsonFetch } from './errors.js';
export class RxNorm {
  constructor(mode = 'live') { this.mode = mode; this.cache = new Map(); }
  async get(endpoint) {
    if (this.mode === 'snapshot') {
      const snapshot = JSON.parse(readFileSync(path.join(ROOT, 'fixtures/rxnorm-snapshot.json'), 'utf8'));
      insist(snapshot.entries[endpoint], 'SNAPSHOT_MISS', 'This drug is not in the recorded RxNorm demo. Use live mode.', 503);
      return snapshot.entries[endpoint];
    }
    if (!this.cache.has(endpoint)) {
      const data = await jsonFetch(`https://rxnav.nlm.nih.gov/REST${endpoint}`);
      this.cache.set(endpoint, { data, expires: Date.now() + 300000 });
    }
    const item = this.cache.get(endpoint);
    if (item.expires < Date.now()) { this.cache.delete(endpoint); return this.get(endpoint); }
    return item.data;
  }
  async clinicalDrug(code) {
    insist(/^\d+$/.test(code), 'INVALID_RXCUI', 'An RxNorm concept identifier is required.');
    const { properties } = await this.get(`/rxcui/${code}/properties.json`);
    insist(properties?.rxcui === code && ['SCD', 'SBD'].includes(properties.tty), 'UNSUPPORTED_CONCEPT', 'Medication must be a fully specified clinical or branded drug, not an ingredient alone.');
    if (properties.tty === 'SCD') return { code, name: properties.name, clinicalCode: code };
    const related = await this.get(`/rxcui/${code}/related.json?tty=SCD`);
    const concepts = (related.relatedGroup?.conceptGroup || []).flatMap(g => g.tty === 'SCD' ? g.conceptProperties || [] : []);
    insist(concepts.length === 1, 'AMBIGUOUS_FORMULATION', 'Brand-to-clinical-drug mapping is ambiguous. Pharmacist review required.');
    return { code, name: properties.name, clinicalCode: concepts[0].rxcui };
  }
  async compare(expected, requested) {
    const [prescription, request] = await Promise.all([this.clinicalDrug(expected), this.clinicalDrug(requested)]);
    insist(prescription.clinicalCode === request.clinicalCode, 'FORMULATION_MISMATCH', 'The requested ingredient, strength or dose form does not match the prescription.');
    return { prescription, request, source: this.mode === 'live' ? 'NLM RxNorm live API' : 'Recorded NLM RxNorm snapshot' };
  }
}

import { mkdir, writeFile } from 'node:fs/promises';
const entries = {};
for (const code of ['311041', '847232']) {
  for (const suffix of ['properties.json', 'related.json?tty=SCD']) {
    const path = `/rxcui/${code}/${suffix}`;
    const response = await fetch(`https://rxnav.nlm.nih.gov/REST${path}`);
    if (!response.ok) throw new Error(`RxNorm HTTP ${response.status}`);
    entries[path] = await response.json();
  }
}
await mkdir('fixtures', { recursive: true });
await writeFile('fixtures/rxnorm-snapshot.json', JSON.stringify({ capturedAt: new Date().toISOString(), source: 'https://rxnav.nlm.nih.gov/REST', entries }, null, 2));
console.log('Saved official RxNorm responses for reproducible offline testing.');

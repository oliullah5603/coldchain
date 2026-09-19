import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';

test('Hosted callback origin comes from Render; explicit custom origin takes precedence', () => {
  const names = ['APP_ORIGIN', 'RENDER_EXTERNAL_URL', 'PORT', 'HOST', 'EHR_MODE'];
  const original = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    delete process.env.APP_ORIGIN;
    process.env.RENDER_EXTERNAL_URL = 'https://coldchain-test.onrender.com/';
    process.env.PORT = '10000';
    process.env.HOST = '0.0.0.0';
    process.env.EHR_MODE = 'demo';
    const hosted = config();
    assert.equal(hosted.origin, 'https://coldchain-test.onrender.com');
    assert.equal(hosted.fhirBase, `${hosted.origin}/demo-ehr/fhir`);
    assert.deepEqual(hosted.authOrigins, [hosted.origin]);
    assert.equal(hosted.port, 10000);
    assert.equal(hosted.host, '0.0.0.0');
    process.env.APP_ORIGIN = 'https://demo.example.com';
    assert.equal(config().origin, 'https://demo.example.com');
  } finally {
    for (const name of names) {
      if (original[name] === undefined) delete process.env[name];
      else process.env[name] = original[name];
    }
  }
});

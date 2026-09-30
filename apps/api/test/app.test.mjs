import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../dist/app.js';

test('GET /healthz reports API readiness', async (t) => {
  const app = createApp();
  t.after(() => app.close());

  const response = await app.inject({ method: 'GET', url: '/healthz' });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: 'ok', service: 'jev-town-api' });
});

test('unknown routes return 404', async (t) => {
  const app = createApp();
  t.after(() => app.close());

  const response = await app.inject({ method: 'GET', url: '/missing' });

  assert.equal(response.statusCode, 404);
});

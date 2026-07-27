// Nexus fulfillment category + custom-API connectors: catalog entries,
// custom-* vault mechanics, list surfacing, guardrails.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { buildServer } from '../dist/server.js';
import { closeQueues } from '../dist/lib/queue.js';
import { db, disconnectDb } from '../dist/lib/db.js';

const SECRET = process.env.JWT_SECRET ?? '';
function jwt() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const n = Math.floor(Date.now() / 1000);
  const d = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'pod-test', role: 'admin', iat: n, exp: n + 3600 })}`;
  return `${d}.${createHmac('sha256', SECRET).update(d).digest('base64url')}`;
}
const auth = () => ({ authorization: `Bearer ${jwt()}`, 'content-type': 'application/json' });

let app;

before(async () => {
  app = await buildServer();
});

after(async () => {
  await db.connection.deleteMany({ where: { provider: { in: ['printful', 'custom-pod-partner'] } } });
  await db.connectionAuditLog.deleteMany({ where: { provider: { in: ['printful', 'custom-pod-partner'] } } });
  await app.close();
  await closeQueues();
  await disconnectDb();
});

test('fulfillment providers listed in the catalog with the right category', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/connections', headers: auth() });
  assert.equal(res.statusCode, 200);
  const rows = res.json();
  const pods = rows.filter((r) => r.category === 'fulfillment').map((r) => r.id);
  for (const id of ['printful', 'printify', 'gelato', 'gooten', 'spod', 'podplus', 'podpartner', 'tapstitch', 'contrado']) {
    assert.ok(pods.includes(id), `${id} in fulfillment`);
  }
  assert.equal(rows.find((r) => r.id === 'printful').testable, true, 'printful has a live tester');
});

test('printful connects through the standard vault flow', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/connections/printful', headers: auth(), payload: { credential: 'pf-test-key' } });
  assert.equal(res.statusCode, 201);
  const list = await app.inject({ method: 'GET', url: '/api/connections', headers: auth() });
  assert.equal(list.json().find((r) => r.id === 'printful').connected, true);
});

test('custom-* connector: connect, surfaces in list under Custom, disconnects', async () => {
  const bad = await app.inject({ method: 'POST', url: '/api/connections/custom-POD!!', headers: auth(), payload: { credential: 'x' } });
  assert.equal(bad.statusCode, 404, 'malformed custom id rejected (regex gate)');

  const res = await app.inject({ method: 'POST', url: '/api/connections/custom-pod-partner', headers: auth(), payload: { credential: 'secret-key|https://api.podpartner.example/v1/ping' } });
  assert.equal(res.statusCode, 201, 'custom connector accepted');

  const list = await app.inject({ method: 'GET', url: '/api/connections', headers: auth() });
  const row = list.json().find((r) => r.id === 'custom-pod-partner');
  assert.ok(row, 'custom connector surfaces in the list');
  assert.equal(row.category, 'custom');
  assert.equal(row.name, 'Pod Partner (custom)');
  assert.equal(row.connected, true);
  assert.equal(row.testable, true);
  assert.doesNotMatch(JSON.stringify(row), /secret-key/, 'credential never leaves the vault');

  const del = await app.inject({ method: 'DELETE', url: '/api/connections/custom-pod-partner', headers: auth() });
  assert.equal(del.statusCode, 200);
  const after2 = await app.inject({ method: 'GET', url: '/api/connections', headers: auth() });
  assert.equal(after2.json().find((r) => r.id === 'custom-pod-partner'), undefined, 'gone after disconnect');
});

test('unknown non-custom provider still rejected', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/connections/not-a-provider', headers: auth(), payload: { credential: 'x' } });
  assert.equal(res.statusCode, 404);
});

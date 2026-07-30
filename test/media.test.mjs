// Regression coverage for the media slice (MediaAsset — previously schema-only, no service/routes).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { buildServer } from '../dist/server.js';
import { closeQueues } from '../dist/lib/queue.js';
import { disconnectDb } from '../dist/lib/db.js';

const SECRET = process.env.JWT_SECRET ?? '';
function jwt() {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const n = Math.floor(Date.now() / 1000);
  const d = `${b({ alg: 'HS256', typ: 'JWT' })}.${b({ sub: 'it', role: 'admin', iat: n, exp: n + 3600 })}`;
  return `${d}.${createHmac('sha256', SECRET).update(d).digest('base64url')}`;
}
const auth = () => ({ authorization: `Bearer ${jwt()}` });

let app;
before(async () => {
  app = await buildServer();
  await app.inject({ method: 'PATCH', url: '/api/capabilities/content', headers: auth(), payload: { enabled: true } });
});
after(async () => {
  await app.close();
  await closeQueues();
  await disconnectDb();
});

test('media: create, list, get, delete round-trip', async () => {
  const create = await app.inject({
    method: 'POST',
    url: '/api/media',
    headers: auth(),
    payload: { url: 'https://example.com/hero.jpg', alt: 'Hero image', kind: 'image', width: 1200, height: 630 },
  });
  assert.equal(create.statusCode, 201);
  const asset = create.json();
  assert.equal(asset.kind, 'image');
  assert.equal(asset.alt, 'Hero image');

  // The media INDEX now requires auth — it used to answer anyone, exposing
  // every upload URL, filename and size.
  const list = await app.inject({ method: 'GET', url: '/api/media', headers: auth() });
  assert.equal(list.statusCode, 200);
  assert.ok(list.json().items.some((i) => i.id === asset.id));

  const got = await app.inject({ method: 'GET', url: `/api/media/${asset.id}`, headers: auth() });
  assert.equal(got.statusCode, 200);
  assert.equal(got.json().url, 'https://example.com/hero.jpg');

  const del = await app.inject({ method: 'DELETE', url: `/api/media/${asset.id}`, headers: auth() });
  assert.equal(del.statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: `/api/media/${asset.id}`, headers: auth() })).statusCode, 404);
});

test('media: create requires auth; rejects invalid url', async () => {
  const noAuth = await app.inject({ method: 'POST', url: '/api/media', payload: { url: 'https://example.com/x.jpg' } });
  assert.equal(noAuth.statusCode, 401);

  const badUrl = await app.inject({ method: 'POST', url: '/api/media', headers: auth(), payload: { url: 'not-a-url' } });
  assert.equal(badUrl.statusCode, 422); // Zod validation failure — this codebase's convention (see errorHandler.ts)
});

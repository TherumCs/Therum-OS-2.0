// Regression coverage for the Pure/Unlocked edition gate + foundations/capabilities.
// Needs DB up + env loaded: docker compose up -d && npm run build && npm test
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
async function toPure() {
  await app.inject({ method: 'PATCH', url: '/api/edition', headers: auth(), payload: { edition: 'pure' } });
  await app.inject({ method: 'PATCH', url: '/api/foundations/bricks', headers: auth(), payload: { enabled: false } });
  await app.inject({ method: 'PATCH', url: '/api/capabilities/commerce', headers: auth(), payload: { enabled: true, provider: 'counter' } });
  await app.inject({ method: 'PATCH', url: '/api/capabilities/content', headers: auth(), payload: { enabled: true } });
  // Clears any leftover manual-testing state (e.g. an Unlocked/Nexus demo) so
  // the suite always starts from a true fresh-Pure baseline, not incidental state.
  await app.inject({ method: 'PATCH', url: '/api/capabilities/connections', headers: auth(), payload: { enabled: false } });
}
before(async () => {
  app = await buildServer();
  await toPure();
});
after(async () => {
  await toPure();
  await app.close();
  await closeQueues();
  await disconnectDb();
});

test('pure: edition is pure; commerce resolves to native Counter', async () => {
  assert.equal((await app.inject({ method: 'GET', url: '/api/edition' })).json().edition, 'pure');
  const caps = (await app.inject({ method: 'GET', url: '/api/capabilities' })).json();
  const commerce = caps.find((c) => c.id === 'commerce');
  assert.equal(commerce.active, 'counter');
  assert.equal(commerce.providers.find((p) => p.distribution === 'native').name, 'Counter');
  assert.equal(commerce.providers.find((p) => p.distribution === 'ecosystem').locked, true, 'ecosystem provider locked in Pure');
});

test('pure: full suite is native-named (Counter/Nexus/Cluster/Milieus/Folio)', async () => {
  const caps = (await app.inject({ method: 'GET', url: '/api/capabilities' })).json();
  const native = Object.fromEntries(caps.map((c) => [c.id, c.providers.find((p) => p.distribution === 'native')?.name]));
  assert.equal(native['commerce'], 'Counter');
  assert.equal(native['connections'], 'Nexus');
  assert.equal(native['merged-products'], 'Cluster');
  assert.equal(native['memberships'], 'Milieus');
  assert.equal(native['content'], 'Folio');
});

test('pure: bricks foundation is locked and cannot be enabled (409)', async () => {
  assert.equal((await app.inject({ method: 'GET', url: '/api/foundations' })).json().find((x) => x.id === 'bricks').locked, true);
  const r = await app.inject({ method: 'PATCH', url: '/api/foundations/bricks', headers: auth(), payload: { enabled: true } });
  assert.equal(r.statusCode, 409);
});

test('pure: selecting an ecosystem provider is refused (422)', async () => {
  const r = await app.inject({ method: 'PATCH', url: '/api/capabilities/commerce', headers: auth(), payload: { provider: 'counter-wp' } });
  assert.equal(r.statusCode, 422);
});

test('capability enforcement: disabling commerce actually 403s the API, not just Studio display', async () => {
  const before = await app.inject({ method: 'GET', url: '/api/products' });
  assert.equal(before.statusCode, 200, 'commerce enabled by default — products reachable');

  await app.inject({ method: 'PATCH', url: '/api/capabilities/commerce', headers: auth(), payload: { enabled: false } });
  const disabled = await app.inject({ method: 'GET', url: '/api/products' });
  assert.equal(disabled.statusCode, 403);
  assert.equal(disabled.json().error.code, 'capability_disabled');
  const ordersDisabled = await app.inject({ method: 'GET', url: '/api/orders', headers: auth() });
  assert.equal(ordersDisabled.statusCode, 403, 'orders shares the commerce gate');

  await app.inject({ method: 'PATCH', url: '/api/capabilities/commerce', headers: auth(), payload: { enabled: true } });
  const restored = await app.inject({ method: 'GET', url: '/api/products' });
  assert.equal(restored.statusCode, 200, 'restored for the rest of the suite');
});

test('capability enforcement: disabling content 403s content AND media (media rides the content gate)', async () => {
  await app.inject({ method: 'PATCH', url: '/api/capabilities/content', headers: auth(), payload: { enabled: false } });
  const contentOff = await app.inject({ method: 'GET', url: '/api/content', headers: auth() });
  assert.equal(contentOff.statusCode, 403);
  // Authenticated now: the media INDEX used to answer anyone, which meant the
  // whole library — every upload URL, filename and size — was public. The
  // capability gate still runs first, so the 403 below is the point of this
  // test and is unaffected by the auth requirement.
  const mediaOff = await app.inject({ method: 'GET', url: '/api/media', headers: auth() });
  assert.equal(mediaOff.statusCode, 403);

  await app.inject({ method: 'PATCH', url: '/api/capabilities/content', headers: auth(), payload: { enabled: true } });
  assert.equal((await app.inject({ method: 'GET', url: '/api/media', headers: auth() })).statusCode, 200, 'restored');
});

test('fresh-install defaults: commerce/content default ON (native providers are stable); connections defaults OFF (native is planned)', async () => {
  const caps = (await app.inject({ method: 'GET', url: '/api/capabilities' })).json();
  const byId = Object.fromEntries(caps.map((c) => [c.id, c]));
  assert.equal(byId.commerce.enabled, true, 'Counter is built — commerce reads ON out of the box');
  assert.equal(byId.content.enabled, true, 'Folio is built — content reads ON out of the box');
  assert.equal(byId.connections.enabled, false, 'Nexus native is still planned — off until something serves it');
});

test('unlocked: pairing opens — bricks enables, ecosystem provider selectable', async () => {
  await app.inject({ method: 'PATCH', url: '/api/edition', headers: auth(), payload: { edition: 'unlocked' } });
  assert.equal((await app.inject({ method: 'PATCH', url: '/api/foundations/bricks', headers: auth(), payload: { enabled: true } })).statusCode, 200);
  const cp = await app.inject({ method: 'PATCH', url: '/api/capabilities/commerce', headers: auth(), payload: { provider: 'counter-wp' } });
  assert.equal(cp.statusCode, 200);
  assert.equal(cp.json().active, 'counter-wp');
});

test('the media INDEX and customer WRITES require authentication', async () => {
  // Both of these answered anonymous callers. The capability hook in front of
  // each route gates the FEATURE, never the caller, so an open route in these
  // files reads as guarded when it is not.
  for (const url of ['/api/media', '/api/media/anything']) {
    const res = await app.inject({ method: 'GET', url });
    assert.equal(res.statusCode, 401, `${url} must not answer anonymously`);
  }
  const created = await app.inject({
    method: 'POST', url: '/api/customers',
    payload: { email: `anon-${Date.now()}@test.local` },
  });
  assert.equal(created.statusCode, 401, 'POST /customers must not create rows anonymously');

  // The files themselves stay public — that is how storefront images load.
  const withAuth = await app.inject({ method: 'GET', url: '/api/media', headers: auth() });
  assert.equal(withAuth.statusCode, 200);
});

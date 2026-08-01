// Out-of-band VPS control. Nothing here talks to Hostinger for real — there is
// no token on this machine and their API is in beta — so what is tested is the
// contract: the registry shape, that a missing credential is a clear refusal
// rather than a crash, that an unknown action 404s, and that every attempt is
// audited whether it worked or not.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { buildServer } from '../dist/server.js';
import { closeQueues } from '../dist/lib/queue.js';
import { db, disconnectDb } from '../dist/lib/db.js';
import { HOSTING_PROVIDERS, hostingProviderService } from '../dist/services/hostingProvider.service.js';
import { nexusCatalog } from '../dist/lib/nexusCatalog.js';

const SECRET = process.env.JWT_SECRET ?? '';
function jwt() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const n = Math.floor(Date.now() / 1000);
  const d = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'hosting-test', role: 'admin', iat: n, exp: n + 3600 })}`;
  return `${d}.${createHmac('sha256', SECRET).update(d).digest('base64url')}`;
}
const auth = () => ({ authorization: `Bearer ${jwt()}` });

let app;

before(async () => {
  app = await buildServer();
});

after(async () => {
  await db.hostActionLog.deleteMany({ where: { actionId: { startsWith: 'hostinger:' } } }).catch(() => {});
  await app.close();
  await closeQueues();
  await disconnectDb();
});

test('every hosting provider is registered in the Nexus catalog too', () => {
  for (const p of HOSTING_PROVIDERS) {
    const entry = nexusCatalog.find((c) => c.id === p.id);
    assert.ok(entry, `${p.id} must exist in the connection catalog or it can never be connected`);
    assert.equal(entry.category, 'hosting');
    assert.ok(p.tokenSource.length > 0, `${p.id} says where to get the token`);
  }
});

test('an unknown provider is refused by name', () => {
  assert.throws(() => hostingProviderService.provider('digitalocean'), /Unknown hosting provider/);
});

test('with nothing connected, the surface explains rather than crashes', async () => {
  const providers = await hostingProviderService.providers();
  assert.ok(providers.length > 0);
  // This dev box has no Hostinger credential; if that ever changes the
  // assertion below still holds for whichever providers are not connected.
  for (const p of providers.filter((x) => !x.connected)) {
    await assert.rejects(() => hostingProviderService.list(p.id), /is not connected/);
  }

  const res = await app.inject({ method: 'GET', url: '/api/host/hosting', headers: auth() });
  assert.equal(res.statusCode, 200, 'the panel still loads with nothing connected');
  const body = res.json();
  assert.ok(Array.isArray(body.providers) && body.providers.length > 0, 'it names who COULD be connected');
  assert.deepEqual(body.machines, []);
});

test('a failed action is a 400 that carries the reason, and is audited', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/host/hosting/hostinger/123/restart', headers: auth() });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().output, /not connected/);

  const row = await db.hostActionLog.findFirst({ where: { actionId: 'hostinger:restart' }, orderBy: { at: 'desc' } });
  assert.ok(row, 'a failed restart attempt is on the record');
  assert.equal(row.ok, false);
  assert.equal(row.actorId, 'hosting-test', 'the log names who tried');
});

test('only the four real actions exist', async () => {
  for (const bad of ['destroy', 'rebuild', 'exec', 'delete']) {
    const res = await app.inject({ method: 'POST', url: `/api/host/hosting/hostinger/1/${bad}`, headers: auth() });
    assert.equal(res.statusCode, 404, `${bad} is not an action`);
  }
  for (const good of ['start', 'stop', 'restart', 'snapshot']) {
    const res = await app.inject({ method: 'POST', url: `/api/host/hosting/hostinger/1/${good}`, headers: auth() });
    assert.notEqual(res.statusCode, 404, `${good} is routed`);
  }
});

test('the hosting surface requires an operator session', async () => {
  assert.equal((await app.inject({ method: 'GET', url: '/api/host/hosting' })).statusCode, 401);
  assert.equal(
    (await app.inject({ method: 'POST', url: '/api/host/hosting/hostinger/1/restart' })).statusCode,
    401,
  );
});

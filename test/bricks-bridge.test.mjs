// Bricks Bridge: payload shapes, import→native canvas draft, public render,
// export round-trip, app gate.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { buildServer } from '../dist/server.js';
import { closeQueues } from '../dist/lib/queue.js';
import { db, disconnectDb } from '../dist/lib/db.js';
import { studioAppService } from '../dist/services/studioApp.service.js';

const SECRET = process.env.JWT_SECRET ?? '';
function jwt() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const n = Math.floor(Date.now() / 1000);
  const d = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'bricks-test', role: 'admin', iat: n, exp: n + 3600 })}`;
  return `${d}.${createHmac('sha256', SECRET).update(d).digest('base64url')}`;
}
const auth = () => ({ authorization: `Bearer ${jwt()}`, 'content-type': 'application/json' });

// A realistic Bricks flat array (the _bricks_page_content_2 shape).
const ELEMENTS = [
  { id: 'sec1', name: 'section', parent: 0, children: ['head1', 'txt1', 'btn1'], settings: {} },
  { id: 'head1', name: 'heading', parent: 'sec1', children: [], settings: { text: 'Sidemoney Drop 01', tag: 'h1' } },
  { id: 'txt1', name: 'text-basic', parent: 'sec1', children: [], settings: { text: 'Limited run. Printed in-house.' } },
  { id: 'btn1', name: 'button', parent: 'sec1', children: [], settings: { text: 'Shop the drop', link: { type: 'external', url: '/shop' } } },
];

let app, wasEnabled, importedId;

before(async () => {
  app = await buildServer();
  wasEnabled = await studioAppService.isEnabled('bricks-bridge');
});

after(async () => {
  if (importedId) await db.content.delete({ where: { id: importedId } }).catch(() => {});
  await studioAppService.setEnabled('bricks-bridge', wasEnabled);
  await app.close();
  await closeQueues();
  await disconnectDb();
});

test('gate: disabled app blocks import with a clear message', async () => {
  await studioAppService.setEnabled('bricks-bridge', false);
  const res = await app.inject({ method: 'POST', url: '/api/bricks/import', headers: auth(), payload: { title: 'X', payload: ELEMENTS } });
  assert.equal(res.statusCode, 409);
  assert.match(res.json().error.message, /Enable Bricks Bridge/);
});

test('import: all three real payload shapes accepted; garbage rejected', async () => {
  await studioAppService.setEnabled('bricks-bridge', true);

  // Shape 1: raw flat array (postmeta). Creates the draft we keep testing.
  const raw = await app.inject({ method: 'POST', url: '/api/bricks/import', headers: auth(), payload: { title: 'brickstest Landing', type: 'page', payload: ELEMENTS } });
  assert.equal(raw.statusCode, 201);
  importedId = raw.json().id;
  assert.equal(raw.json().status, 'draft', 'imports land as drafts');
  assert.equal(raw.json().elementCount, 4);

  // Shape 2 + 3: template export and clipboard — parse-only checks (delete after).
  for (const payload of [{ content: ELEMENTS, templateType: 'content' }, { source: 'bricksCopiedElements', content: ELEMENTS }]) {
    const r = await app.inject({ method: 'POST', url: '/api/bricks/import', headers: auth(), payload: { title: 'brickstest tmp', payload } });
    assert.equal(r.statusCode, 201, 'shape accepted');
    await db.content.delete({ where: { id: r.json().id } });
  }

  const bad = await app.inject({ method: 'POST', url: '/api/bricks/import', headers: auth(), payload: { title: 'X', payload: { nope: true } } });
  assert.equal(bad.statusCode, 409, 'unrecognizable payload rejected');
});

test('imported page is NATIVE canvas: renders publicly once published', async () => {
  const row = await db.content.findUnique({ where: { id: importedId } });
  assert.equal(row.bodyFormat, 'canvas', 'stored as native canvas, not a foreign blob');

  await db.content.update({ where: { id: importedId }, data: { status: 'published' } });
  const res = await app.inject({ method: 'GET', url: `/${row.slug}` });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Sidemoney Drop 01/, 'heading renders');
  assert.match(res.body, /Shop the drop/, 'button renders');
  assert.match(res.body, /Limited run/, 'text renders');
});

test('export round-trip: canvas → Bricks JSON that Bricks would accept', async () => {
  const res = await app.inject({ method: 'GET', url: `/api/bricks/export/${importedId}`, headers: auth() });
  assert.equal(res.statusCode, 200);
  const out = res.json();
  assert.ok(Array.isArray(out.content), 'template-export shape');
  const names = out.content.map((e) => e.name).sort();
  assert.deepEqual(names, ['button', 'heading', 'section', 'text-basic'], 'element names survive the round trip');
  const heading = out.content.find((e) => e.name === 'heading');
  assert.equal(heading.settings.text, 'Sidemoney Drop 01');
  assert.equal(heading.settings.tag, 'h1');
});

// Bricks Bridge media localization: import w/ mediaBaseUrl downloads images
// into the media library and rewrites canvas srcs; localize-media backfills
// content imported without one; failures report per-src, never sink the rest.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { buildServer } from '../dist/server.js';
import { closeQueues } from '../dist/lib/queue.js';
import { db, disconnectDb } from '../dist/lib/db.js';
import { studioAppService } from '../dist/services/studioApp.service.js';
import { mediaService } from '../dist/services/media.service.js';

const SECRET = process.env.JWT_SECRET ?? '';
function jwt() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const n = Math.floor(Date.now() / 1000);
  const d = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'bricks-media-test', role: 'admin', iat: n, exp: n + 3600 })}`;
  return `${d}.${createHmac('sha256', SECRET).update(d).digest('base64url')}`;
}
const auth = () => ({ authorization: `Bearer ${jwt()}`, 'content-type': 'application/json' });

// 1×1 transparent PNG — small, valid, survives the sharp pipeline.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

// Layout with the same image twice (dedupe check) + one dead link.
const ELEMENTS = [
  { id: 'sec1', name: 'section', parent: 0, children: ['img1', 'img2', 'img3'], settings: {} },
  { id: 'img1', name: 'image', parent: 'sec1', children: [], settings: { image: { url: '/wp-content/uploads/a.png' } } },
  { id: 'img2', name: 'image', parent: 'sec1', children: [], settings: { image: { url: '/wp-content/uploads/a.png' } } },
  { id: 'img3', name: 'image', parent: 'sec1', children: [], settings: { image: { url: '/wp-content/uploads/missing.png' } } },
];

let app, wasEnabled, sourceSite, sourcePort;
const contentIds = [];
const assetIds = [];

before(async () => {
  app = await buildServer();
  wasEnabled = await studioAppService.isEnabled('bricks-bridge');
  await studioAppService.setEnabled('bricks-bridge', true);
  // Stand-in for the source WP site's uploads.
  sourceSite = createServer((req, res) => {
    if (req.url === '/wp-content/uploads/a.png') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(PNG);
    } else {
      res.writeHead(404);
      res.end('nope');
    }
  });
  await new Promise((r) => sourceSite.listen(0, '127.0.0.1', r));
  sourcePort = sourceSite.address().port;
});

after(async () => {
  for (const id of contentIds) await db.content.delete({ where: { id } }).catch(() => {});
  for (const id of assetIds) await mediaService.remove(id).catch(() => {});
  await studioAppService.setEnabled('bricks-bridge', wasEnabled);
  await new Promise((r) => sourceSite.close(r));
  await app.close();
  await closeQueues();
  await disconnectDb();
});

test('import with mediaBaseUrl: images land in OUR library, srcs rewritten, dead link reported not fatal', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/bricks/import',
    headers: auth(),
    payload: { title: 'bricksmedia import', payload: ELEMENTS, mediaBaseUrl: `http://127.0.0.1:${sourcePort}` },
  });
  assert.equal(res.statusCode, 201);
  const out = res.json();
  contentIds.push(out.id);
  assert.equal(out.media.localized, 1, 'two identical srcs dedupe to one asset');
  assert.equal(out.media.skipped.length, 1, 'dead link skipped, not fatal');
  assert.match(out.media.skipped[0].reason, /HTTP 404/);

  const row = await db.content.findUnique({ where: { id: out.id } });
  const srcs = [];
  (function walk(n) {
    if (n.type === 'image') srcs.push(n.props.src);
    for (const c of n.children ?? []) walk(c);
  })(row.body);
  const local = srcs.filter((s) => s.startsWith('/api/uploads/'));
  assert.equal(local.length, 2, 'both nodes sharing the image now point at the local upload');
  assert.equal(new Set(local).size, 1, 'same asset URL for both');
  assert.equal(srcs.filter((s) => s.startsWith('/wp-content/')).length, 1, 'dead link left as-is');

  // The asset is a REAL library row — visible in the admin Media list.
  const list = await app.inject({ method: 'GET', url: '/api/media?limit=50', headers: auth() });
  const found = list.json().items.find((a) => a.url === local[0]);
  assert.ok(found, 'localized image appears in the media library');
  assetIds.push(found.id);

  // And the file actually serves.
  const img = await app.inject({ method: 'GET', url: local[0] });
  assert.equal(img.statusCode, 200);
});

test('localize-media backfills an import that had no mediaBaseUrl', async () => {
  const imp = await app.inject({ method: 'POST', url: '/api/bricks/import', headers: auth(), payload: { title: 'bricksmedia backfill', payload: ELEMENTS } });
  assert.equal(imp.statusCode, 201);
  const id = imp.json().id;
  contentIds.push(id);

  const res = await app.inject({
    method: 'POST',
    url: `/api/bricks/localize-media/${id}`,
    headers: auth(),
    payload: { baseUrl: `http://127.0.0.1:${sourcePort}` },
  });
  assert.equal(res.statusCode, 200);
  const out = res.json();
  assert.equal(out.localized.length, 1);
  for (const l of out.localized) assetIds.push(l.assetId);

  const row = await db.content.findUnique({ where: { id } });
  assert.match(JSON.stringify(row.body), /\/api\/uploads\//, 'body persisted with rewritten srcs');
});

test('localize-media rejects non-canvas content', async () => {
  const md = await db.content.create({ data: { title: 'bricksmedia md', slug: `bricksmedia-md-${Date.now()}`, body: 'plain', bodyFormat: 'markdown' } });
  contentIds.push(md.id);
  const res = await app.inject({ method: 'POST', url: `/api/bricks/localize-media/${md.id}`, headers: auth(), payload: { baseUrl: `http://127.0.0.1:${sourcePort}` } });
  assert.equal(res.statusCode, 409);
});

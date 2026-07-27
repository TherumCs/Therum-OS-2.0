// Folio (native Content) regression coverage. Needs DB up + env loaded.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { buildServer } from '../dist/server.js';
import { closeQueues } from '../dist/lib/queue.js';
import { db, disconnectDb } from '../dist/lib/db.js';

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
});
after(async () => {
  // These tests seed real Content rows directly (slugs it-folio-<ts>,
  // it-folio-dup-<ts>, it-render-<ts>); clean them up so repeated runs don't
  // pile up in this shared dev DB.
  await db.content.deleteMany({ where: { OR: [{ slug: { startsWith: 'it-folio-' } }, { slug: { startsWith: 'it-render-' } }, { slug: { startsWith: 'it-cs-meta-' } }] } });
  await app.close();
  await closeQueues();
  await disconnectDb();
});

test('folio: draft is private; publish makes it public with SEO', async () => {
  const slug = 'it-folio-' + Date.now();
  const create = await app.inject({ method: 'POST', url: '/api/content', headers: auth(), payload: { type: 'post', title: 'IT Folio Post', slug, seo: { title: 'IT SEO' } } });
  assert.equal(create.statusCode, 201);
  assert.equal(create.json().status, 'draft');
  const id = create.json().id;

  assert.equal((await app.inject({ method: 'GET', url: `/api/content/slug/${slug}` })).statusCode, 404, 'draft is not public');

  const pub = await app.inject({ method: 'POST', url: `/api/content/${id}/publish`, headers: auth() });
  assert.equal(pub.json().status, 'published');
  assert.ok(pub.json().publishedAt, 'publishedAt set on publish');

  const got = await app.inject({ method: 'GET', url: `/api/content/slug/${slug}` });
  assert.equal(got.statusCode, 200);
  assert.equal(got.json().seo.title, 'IT SEO');
});

test('folio: canvas body renders to HTML on the public render route', async () => {
  const slug = 'it-render-' + Date.now();
  const body = {
    id: 'root',
    type: 'section',
    props: { background: '#fff', padding: 40 },
    children: [{ id: 'h', type: 'heading', props: { text: 'Hello Folio', level: 'h1' }, children: [] }],
  };
  const create = await app.inject({ method: 'POST', url: '/api/content', headers: auth(), payload: { title: 'Render Test', slug, body, bodyFormat: 'canvas' } });
  await app.inject({ method: 'POST', url: `/api/content/${create.json().id}/publish`, headers: auth() });
  const r = await app.inject({ method: 'GET', url: `/api/content/slug/${slug}/render` });
  assert.equal(r.statusCode, 200);
  const html = r.json().html;
  assert.match(html, /<section/, 'renders the section');
  assert.match(html, /<h1[^>]*>Hello Folio<\/h1>/, 'renders the heading from the canvas tree');
});

test('folio: slug conflict returns 409', async () => {
  const slug = 'it-folio-dup-' + Date.now();
  await app.inject({ method: 'POST', url: '/api/content', headers: auth(), payload: { title: 'A', slug } });
  const dup = await app.inject({ method: 'POST', url: '/api/content', headers: auth(), payload: { title: 'B', slug } });
  assert.equal(dup.statusCode, 409);
});

test('folio: Content capability resolves to Folio when enabled (Pure)', async () => {
  await app.inject({ method: 'PATCH', url: '/api/edition', headers: auth(), payload: { edition: 'pure' } });
  await app.inject({ method: 'PATCH', url: '/api/capabilities/content', headers: auth(), payload: { enabled: true } });
  const content = (await app.inject({ method: 'GET', url: '/api/capabilities' })).json().find((c) => c.id === 'content');
  assert.equal(content.active, 'folio');
  assert.equal(content.providers.find((p) => p.id === 'folio').status, 'stable');
});

test('AUDIT: meta-only PATCH must not clobber type/status/seo (partial()-keeps-defaults bug, found live 2026-07-23)', async () => {
  const slug = 'it-cs-meta-' + Date.now();
  const create = await app.inject({
    method: 'POST', url: '/api/content', headers: auth(),
    payload: { title: 'Meta Patch Guard', slug, type: 'case_study', seo: { title: 'Custom SEO' } },
  });
  assert.equal(create.statusCode, 201);
  const id = create.json().id;
  await app.inject({ method: 'POST', url: `/api/content/${id}/publish`, headers: auth() });

  const patch = await app.inject({
    method: 'PATCH', url: `/api/content/${id}`, headers: auth(),
    payload: { meta: { caseStudy: { client: 'Guard Client' } } },
  });
  assert.equal(patch.statusCode, 200);
  const after = patch.json();
  assert.equal(after.type, 'case_study', 'type survives a meta-only PATCH');
  assert.equal(after.status, 'published', 'status survives a meta-only PATCH');
  assert.equal(after.seo?.title, 'Custom SEO', 'seo survives a meta-only PATCH');
  assert.equal(after.meta?.caseStudy?.client, 'Guard Client');
});

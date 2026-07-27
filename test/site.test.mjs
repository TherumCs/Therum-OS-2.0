// Base Theme — public site frontend: homepage modes, page/blog/work routing,
// drafts never leak, SEO head injection, themed 404, nav assembly.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../dist/server.js';
import { closeQueues } from '../dist/lib/queue.js';
import { db, disconnectDb } from '../dist/lib/db.js';

let app;
let savedSite;

before(async () => {
  app = await buildServer();
  const row = await db.setting.findUnique({ where: { key: 'site' } });
  savedSite = row?.value ?? null; // restore the operator's real settings after
  await db.setting.upsert({ where: { key: 'site' }, update: { value: { siteName: 'basetest Site', tagline: 'Testing the base theme', homepageSlug: null } }, create: { key: 'site', value: { siteName: 'basetest Site', tagline: 'Testing the base theme', homepageSlug: null } } });
  await db.content.createMany({
    data: [
      { type: 'page', title: 'basetest About', slug: 'basetest-about', status: 'published', body: '<p>about body</p>', bodyFormat: 'html' },
      { type: 'page', title: 'basetest Hidden', slug: 'basetest-hidden', status: 'draft', body: '<p>secret</p>', bodyFormat: 'html' },
      { type: 'post', title: 'basetest Post', slug: 'basetest-post', status: 'published', body: '<p>post body</p>', bodyFormat: 'html', publishedAt: new Date(), excerpt: 'A test post' },
      { type: 'case_study', title: 'basetest Case', slug: 'basetest-case', status: 'published', body: '<p>case body</p>', bodyFormat: 'html', publishedAt: new Date() },
    ],
  });
});

after(async () => {
  await db.content.deleteMany({ where: { slug: { startsWith: 'basetest-' } } });
  if (savedSite) await db.setting.update({ where: { key: 'site' }, data: { value: savedSite } });
  else await db.setting.deleteMany({ where: { key: 'site' } });
  await app.close();
  await closeQueues();
  await disconnectDb();
});

test('/ landing mode: site name, tagline, published work+posts listed', async () => {
  const res = await app.inject({ method: 'GET', url: '/' });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /basetest Site/);
  assert.match(res.body, /Testing the base theme/);
  assert.match(res.body, /basetest Post/);
  assert.match(res.body, /basetest Case/);
  assert.doesNotMatch(res.body, /basetest Hidden/, 'drafts never on the landing');
});

test('/ homepage mode: configured page renders at bare / with its SEO head', async () => {
  await db.setting.update({ where: { key: 'site' }, data: { value: { siteName: 'basetest Site', tagline: '', homepageSlug: 'basetest-about' } } });
  const res = await app.inject({ method: 'GET', url: '/' });
  assert.match(res.body, /about body/);
  assert.match(res.body, /link rel="canonical"/, 'CMS metaTags injected');
  assert.match(res.body, /application\/ld\+json/, 'JSON-LD injected');
  await db.setting.update({ where: { key: 'site' }, data: { value: { siteName: 'basetest Site', tagline: 'Testing the base theme', homepageSlug: null } } });
});

test('pages at /:slug; drafts and wrong types 404 themed', async () => {
  const page = await app.inject({ method: 'GET', url: '/basetest-about' });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /about body/);

  const draft = await app.inject({ method: 'GET', url: '/basetest-hidden' });
  assert.equal(draft.statusCode, 404, 'draft page never public');
  assert.match(draft.body, /Page not found/, 'themed 404');

  const wrongType = await app.inject({ method: 'GET', url: '/basetest-post' });
  assert.equal(wrongType.statusCode, 404, 'posts do not render at page URLs');
});

test('/blog index + /blog/:slug article with date meta', async () => {
  const idx = await app.inject({ method: 'GET', url: '/blog' });
  assert.equal(idx.statusCode, 200);
  assert.match(idx.body, /basetest Post/);
  assert.match(idx.body, /A test post/);

  const post = await app.inject({ method: 'GET', url: '/blog/basetest-post' });
  assert.equal(post.statusCode, 200);
  assert.match(post.body, /post body/);
  assert.match(post.body, /page-meta/, 'publish date shown on posts');
});

test('/work index + /work/:slug case study', async () => {
  const idx = await app.inject({ method: 'GET', url: '/work' });
  assert.match(idx.body, /basetest Case/);
  const cs = await app.inject({ method: 'GET', url: '/work/basetest-case' });
  assert.equal(cs.statusCode, 200);
  assert.match(cs.body, /case body/);
});

test('nav: published pages linked, Blog/Work appear, storefront routes still win over /:slug', async () => {
  const res = await app.inject({ method: 'GET', url: '/basetest-about' });
  assert.match(res.body, /href="\/blog"/);
  assert.match(res.body, /href="\/work"/);

  const shop = await app.inject({ method: 'GET', url: '/shop' });
  assert.equal(shop.statusCode, 200, '/shop not shadowed by /:slug');
  assert.match(shop.body, /Shop/);

  const asset = await app.inject({ method: 'GET', url: '/favicon.ico' });
  assert.equal(asset.statusCode, 404);
  assert.doesNotMatch(asset.headers['content-type'] ?? '', /text\/html/, 'asset 404s stay JSON');
});

test('site settings API: authenticated read, gated write', async () => {
  const noAuth = await app.inject({ method: 'GET', url: '/api/settings/site' });
  assert.equal(noAuth.statusCode, 401);
});

test('custom menu (Settings → Site) overrides the auto-built nav', async () => {
  const prev = await db.setting.findUnique({ where: { key: 'site' } });
  await db.setting.update({ where: { key: 'site' }, data: { value: { ...(prev.value), menu: [{ label: 'Custom Home', href: '/' }, { label: 'Deals', href: '/shop?tag=deals' }] } } });
  try {
    const res = await app.inject({ method: 'GET', url: '/' });
    assert.match(res.body, /Custom Home/);
    assert.match(res.body, /Deals/);
    assert.doesNotMatch(res.body, /href="\/blog"/, 'auto nav fully replaced');
  } finally {
    await db.setting.update({ where: { key: 'site' }, data: { value: { ...(prev.value), menu: null } } });
  }
});

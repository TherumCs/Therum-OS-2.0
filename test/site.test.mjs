// Base Theme — public site frontend: homepage modes, page/blog/work routing,
// drafts never leak, SEO head injection, themed 404, nav assembly.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../dist/server.js';
import { settingsService } from '../dist/services/settings.service.js';
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

  // Browsers ask for a favicon on every page load, so it is served rather than
  // 404'd. Any OTHER asset-ish path still gets a plain 404 — never a themed
  // HTML page, which is what /:slug would otherwise hand back.
  const icon = await app.inject({ method: 'GET', url: '/favicon.ico' });
  assert.equal(icon.statusCode, 200, 'favicon is served');
  assert.match(icon.headers['content-type'] ?? '', /image\//, 'favicon is an image');

  const asset = await app.inject({ method: 'GET', url: '/nothing-here.png' });
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

describe('maintenance / coming soon', () => {
  // Restored through the SERVICE, not over HTTP — HTTP is what this feature
  // blocks, and a cleanup that has to get past the gate it just enabled fails
  // exactly when the gate works. Leaving it on would hide the site.
  let app;
  before(async () => { app = await buildServer(); });
  after(async () => {
    await settingsService.setMaintenance({ mode: 'off' });
    await app.close();
  });

  const get = (url, headers = {}) => app.inject({ method: 'GET', url, headers });

  test('off means the site is simply public', async () => {
    await settingsService.setMaintenance({ mode: 'off' });
    assert.equal((await get('/')).statusCode, 200);
  });

  test('maintenance answers 503 with Retry-After, and says noindex', async () => {
    await settingsService.setMaintenance({ mode: 'maintenance', heading: 'Back soon', retryAfterMinutes: 30 });
    const r = await get('/');
    // 503 + Retry-After is what keeps existing pages in the index; a 200 here
    // would let crawlers replace real pages with the holding text.
    assert.equal(r.statusCode, 503);
    assert.equal(r.headers['retry-after'], '1800');
    assert.match(r.body, /Back soon/);
    assert.match(r.body, /noindex/);
  });

  test('coming soon answers 200 and is indexable — it IS the site', async () => {
    await settingsService.setMaintenance({ mode: 'coming-soon', heading: 'Coming soon' });
    const r = await get('/');
    assert.equal(r.statusCode, 200);
    assert.ok(!r.body.includes('noindex'), 'a launch teaser must not tell crawlers to skip it');
  });

  test('the admin, API and store bridges stay reachable while hidden', async () => {
    await settingsService.setMaintenance({ mode: 'maintenance' });
    // Not 503: you must be able to turn it back off, and a partner sync must
    // not break because of a marketing decision.
    assert.notEqual((await get('/tos-admin/login')).statusCode, 503);
    assert.notEqual((await get('/api/connections')).statusCode, 503);
    assert.equal((await get('/wp-json/')).statusCode, 200);
  });

  test('a signed-in admin still sees the real site', async () => {
    await settingsService.setMaintenance({ mode: 'maintenance' });
    const r = await get('/', { cookie: 'th_session=whatever' });
    assert.equal(r.statusCode, 200, 'you cannot verify a fix you cannot look at');
  });

  test('turning it off takes effect immediately, not after a cache TTL', async () => {
    await settingsService.setMaintenance({ mode: 'maintenance' });
    assert.equal((await get('/')).statusCode, 503);
    await settingsService.setMaintenance({ mode: 'off' });
    assert.equal((await get('/')).statusCode, 200);
  });
});

describe('page titles can be hidden', () => {
  let app;
  before(async () => { app = await buildServer(); });
  after(async () => {
    await settingsService.setSite({ showPageTitles: true });
    await app.close();
  });
  const h1 = (body) => (body.match(/<h1 class="page-title">([^<]*)/) || [])[1] ?? null;

  test('site setting hides section headings across the store', async () => {
    await settingsService.setSite({ showPageTitles: true });
    for (const url of ['/shop', '/cart', '/checkout']) {
      assert.ok(h1((await app.inject({ method: 'GET', url })).body), `${url} should have a heading when on`);
    }
    await settingsService.setSite({ showPageTitles: false });
    for (const url of ['/shop', '/cart', '/checkout']) {
      assert.equal(h1((await app.inject({ method: 'GET', url })).body), null, `${url} should have none when off`);
    }
  });

  test('error headings are NOT hidden — the heading IS the message', async () => {
    // Hiding these would leave a blank page instead of a tidier one.
    await settingsService.setSite({ showPageTitles: false });
    const r = await app.inject({ method: 'GET', url: '/product/definitely-not-a-real-slug' });
    assert.match(r.body, /Product not found/);
  });
});

describe('imported runtime strings stay valid', () => {
  // A backtick inside these template literals CLOSES the string and takes the
  // whole server down with an esbuild parse error. It happened twice, both
  // times from a comment quoting a CSS property. Cheap to check, expensive to
  // debug: the symptom is the site refusing to boot.
  test('no stray backticks inside the injected runtimes', async () => {
    const { readFileSync } = await import('node:fs');
    // EVERY file in src/site, not a hand-kept list — the list is what let it
    // happen a fourth time, in productGrid.ts and storefrontHtml.ts, both of
    // which were carrying injected runtimes and neither of which was named.
    const { readdirSync } = await import('node:fs');
    const files = readdirSync('src/site').filter((f) => f.endsWith('.ts')).map((f) => `src/site/${f}`);
    assert.ok(files.length >= 8, 'expected to find the site runtimes');
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/(?:export )?const [A-Z_]+ = `([\s\S]*?)\n`;/g)) {
        assert.equal(m[1].includes('`'), false, `${f} has a backtick inside a runtime template literal`);
      }
    }
  });
});

describe('push-mode cart is UNDER the page', () => {
  // Reported as broken twice, both times as "it is still an overlay". In push
  // mode the page has to be the top layer with the cart uncovered behind it;
  // the ported theme parks its sidebar at z-index 1400, which is the overlay
  // order and reads as exactly the bug. These assertions are on the RULES, not
  // on a rendered transform — the shift itself is written inline at runtime.
  test('the drawer is stacked below the shell, and the scrim is off', async () => {
    const { HEADER_CART_CSS } = await import('../dist/site/headerCart.js');
    assert.match(HEADER_CART_CSS, /#th-shell\{position:relative;z-index:2/,
      'the page shell must outrank the drawer');
    assert.match(HEADER_CART_CSS, /body\.th-cart-open \.c-shop-sidebar\{z-index:1\}/,
      'push mode must pull the theme sidebar below the shell');
    assert.match(HEADER_CART_CSS, /body\.th-cart-open \.c-shop-sidebar__shadow\{display:none\}/,
      'the overlay scrim has no place in push mode');
  });

  test('the ground colour is a hex the merchant chose, and the ink follows it', async () => {
    const { headerCartRuntime, HEADER_CART_DEFAULTS } = await import('../dist/site/headerCart.js');
    const js = headerCartRuntime({ ...HEADER_CART_DEFAULTS, cartSidebarGround: '#faf1e0' });
    assert.match(js, /var GROUND = "#faf1e0"/);
    // A light ground with white type is an unreadable cart, so the ink is
    // derived rather than fixed.
    assert.match(js, /--th-cart-ink/);
    assert.match(js, /0\.2126/, 'ink should be chosen by relative luminance');
  });

  test('the ground rejects anything that is not a hex colour', async () => {
    const { CounterSettingsInput } = await import('../dist/schemas/settings.schema.js');
    // It is written straight into a custom property: a loose value here is a
    // style-injection hole on every page of the storefront.
    assert.throws(() => CounterSettingsInput.parse({ cartSidebarGround: 'red;}body{display:none' }));
    assert.throws(() => CounterSettingsInput.parse({ cartSidebarGround: 'url(https://x/y)' }));
    assert.ok(CounterSettingsInput.parse({ cartSidebarGround: '#0A0A0A' }));
  });
});

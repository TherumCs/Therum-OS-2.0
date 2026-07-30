// Catalog presentation: taxonomy CRUD + assignment, shop search/filters,
// gallery/description/taxonomy on the product page.
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
  const d = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'cat-test', role: 'admin', iat: n, exp: n + 3600 })}`;
  return `${d}.${createHmac('sha256', SECRET).update(d).digest('base64url')}`;
}
const auth = () => ({ authorization: `Bearer ${jwt()}` });

let app, vendor, tee, mug, catApparel, catDrink, tagSummer;

before(async () => {
  app = await buildServer();
  vendor = await db.vendor.create({ data: { name: 'cattest Vendor' } });
  tee = await db.product.create({
    data: {
      name: 'cattest Tee', slug: 'cattest-tee', status: 'active', vendorId: vendor.id,
      description: 'A very soft cotton tee for testing.',
      image: 'https://example.com/tee-front.jpg',
      images: [{ url: 'https://example.com/tee-back.jpg', alt: 'Back' }],
      variants: { create: [{ sku: 'CAT-S', price: 2000, color: 'black', size: 'S', inventory: 5 }, { sku: 'CAT-L', price: 2200, color: 'white', size: 'L', inventory: 5 }] },
    },
  });
  mug = await db.product.create({
    data: { name: 'cattest Mug', slug: 'cattest-mug', status: 'active', vendorId: vendor.id, variants: { create: [{ sku: 'CAT-M', price: 1500, inventory: 5 }] } },
  });
});

after(async () => {
  await db.product.deleteMany({ where: { slug: { startsWith: 'cattest-' } } });
  await db.productCategory.deleteMany({ where: { slug: { startsWith: 'cattest-' } } });
  await db.productTag.deleteMany({ where: { slug: { startsWith: 'cattest-' } } });
  await db.vendor.deleteMany({ where: { name: 'cattest Vendor' } });
  await app.close();
  await closeQueues();
  await disconnectDb();
});

test('taxonomy CRUD: categories (hierarchy + cycle guard), tags, gating', async () => {
  const noAuth = await app.inject({ method: 'POST', url: '/api/catalog/categories', payload: { name: 'X' } });
  assert.equal(noAuth.statusCode, 401);

  const c1 = await app.inject({ method: 'POST', url: '/api/catalog/categories', headers: auth(), payload: { name: 'cattest Apparel', slug: 'cattest-apparel' } });
  assert.equal(c1.statusCode, 201);
  catApparel = c1.json();
  const c2 = await app.inject({ method: 'POST', url: '/api/catalog/categories', headers: auth(), payload: { name: 'cattest Drinkware', slug: 'cattest-drinkware', parentId: catApparel.id } });
  catDrink = c2.json();
  assert.equal(catDrink.parentId, catApparel.id, 'hierarchy stored');

  // Cycle guard: apparel cannot become a child of its own child.
  const cycle = await app.inject({ method: 'PATCH', url: `/api/catalog/categories/${catApparel.id}`, headers: auth(), payload: { parentId: catDrink.id } });
  assert.equal(cycle.statusCode, 422, 'category cycle rejected');

  const t = await app.inject({ method: 'POST', url: '/api/catalog/tags', headers: auth(), payload: { name: 'cattest Summer', slug: 'cattest-summer' } });
  assert.equal(t.statusCode, 201);
  tagSummer = t.json();

  const dup = await app.inject({ method: 'POST', url: '/api/catalog/tags', headers: auth(), payload: { name: 'Again', slug: 'cattest-summer' } });
  assert.equal(dup.statusCode, 409);
});

test('assignment: product picks up categories + tags; list includes them', async () => {
  const res = await app.inject({ method: 'PUT', url: `/api/products/${tee.id}/taxonomy`, headers: auth(), payload: { categoryIds: [catApparel.id], tagIds: [tagSummer.id] } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().categories[0].slug, 'cattest-apparel');
  assert.equal(res.json().tags[0].slug, 'cattest-summer');
  await app.inject({ method: 'PUT', url: `/api/products/${mug.id}/taxonomy`, headers: auth(), payload: { categoryIds: [catDrink.id] } });
});

test('shop: search matches name AND description; category/tag/color/size filters narrow', async () => {
  const byDesc = await app.inject({ method: 'GET', url: '/shop?q=soft+cotton' });
  assert.match(byDesc.body, /cattest Tee/, 'description text searchable');
  assert.doesNotMatch(byDesc.body, /cattest Mug/);

  const byCat = await app.inject({ method: 'GET', url: '/shop?category=cattest-apparel' });
  assert.match(byCat.body, /cattest Tee/);
  assert.doesNotMatch(byCat.body, /cattest Mug/, 'category filter excludes others');

  const byTag = await app.inject({ method: 'GET', url: '/shop?tag=cattest-summer' });
  assert.match(byTag.body, /cattest Tee/);
  assert.doesNotMatch(byTag.body, /cattest Mug/);

  const byColor = await app.inject({ method: 'GET', url: '/shop?color=white&category=cattest-apparel' });
  assert.match(byColor.body, /cattest Tee/, 'variant color filter');
  const noHit = await app.inject({ method: 'GET', url: '/shop?color=white&category=cattest-drinkware' });
  assert.doesNotMatch(noHit.body, /cattest Tee/);
  assert.match(noHit.body, /No products match/, 'empty state with clear-filters');

  const rails = await app.inject({ method: 'GET', url: '/shop' });
  assert.match(rails.body, /filter-chip/, 'filter rails render');
  assert.match(rails.body, /name="q"/, 'search box present');
});

test('product page: gallery, description, taxonomy pills link back to filters', async () => {
  const res = await app.inject({ method: 'GET', url: '/product/cattest-tee' });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /gallery-main/, 'gallery renders');
  assert.match(res.body, /tee-back\.jpg/, 'extra images in the strip');
  assert.match(res.body, /very soft cotton tee/, 'description shown');
  assert.match(res.body, /shop\?category=cattest-apparel/, 'category pill links to filtered shop');
  assert.match(res.body, /#cattest Summer/, 'tag pill');
});

test('shop cards show category names and product images', async () => {
  const res = await app.inject({ method: 'GET', url: '/shop?category=cattest-apparel' });
  assert.match(res.body, /tee-front\.jpg/, 'card image');
  assert.match(res.body, /cattest Apparel/, 'card category line');
});

test('MEDIA: video entries accepted; each card style emits ONLY its own behaviour; product page plays video', async () => {
  // Give the tee a video + second still through the real API surface.
  const upd = await app.inject({ method: 'PATCH', url: `/api/products/${tee.id}`, headers: auth(), payload: {
    images: [
      { url: 'https://example.com/tee-back.jpg', alt: 'Back' },
      { url: 'https://example.com/tee-spin.mp4', type: 'video', poster: 'https://example.com/tee-front.jpg' },
    ],
  } });
  assert.equal(upd.statusCode, 200, 'video gallery entry accepted by schema');

  // ONE behaviour per card, chosen in Settings > Counter — a hover video and
  // hover arrows competing over the same image is what used to be emitted, and
  // in practice neither worked. Each style is asserted on its own.
  const { settingsService } = await import('../dist/services/settings.service.js');
  const savedCounter = await settingsService.getCounter();

  await settingsService.setCounter({ cardMedia: 'motion' });
  const motion = await app.inject({ method: 'GET', url: '/shop?category=cattest-apparel' });
  // Matched as an ELEMENT, not a bare class name — the injected stylesheet
  // mentions .card-video too, so a loose match passes on any page.
  assert.match(motion.body, /<video[^>]*card-video/, 'motion card carries the hover video element');
  assert.match(motion.body, /preload="none"/, 'video never downloads until hover');
  assert.doesNotMatch(motion.body, /<button[^>]*card-nav prev/, 'motion card does NOT also draw gallery arrows');
  assert.match(motion.headers['content-security-policy'], /media-src 'self' https:/, 'CSP allows hosted media');

  await settingsService.setCounter({ cardMedia: 'gallery' });
  const gallery = await app.inject({ method: 'GET', url: '/shop?category=cattest-apparel' });
  assert.match(gallery.body, /<button[^>]*card-nav prev/, 'arrows present with multiple stills');
  assert.match(gallery.body, /card-dots/, 'dot indicators present');
  assert.doesNotMatch(gallery.body, /<video[^>]*card-video/, 'gallery card does NOT also load a video');

  await settingsService.setCounter(savedCounter);

  const pageRes = await app.inject({ method: 'GET', url: '/product/cattest-tee' });
  assert.match(pageRes.body, /play-badge/, 'video thumb badged in the strip');
  assert.match(pageRes.body, /data-type="video"/, 'thumb knows it is a video');

  // Extension inference: .mp4 without explicit type is still a video.
  await app.inject({ method: 'PATCH', url: `/api/products/${tee.id}`, headers: auth(), payload: {
    images: [{ url: 'https://example.com/tee-back.jpg' }, { url: 'https://example.com/clip.webm' }],
  } });
  const inferred = await app.inject({ method: 'GET', url: '/product/cattest-tee' });
  assert.match(inferred.body, /data-type="video"/, '.webm inferred as video without explicit type');
});

test('variant CRUD: add, edit price/stock, delete; ordered variant refuses delete', async () => {
  const added = await app.inject({ method: 'POST', url: `/api/products/${tee.id}/variants`, headers: auth(), payload: { sku: 'CAT-XL', price: 2400, size: 'XL', color: 'black', inventory: 3 } });
  assert.equal(added.statusCode, 201);
  const vid = added.json().id;

  const upd = await app.inject({ method: 'PATCH', url: `/api/products/${tee.id}/variants/${vid}`, headers: auth(), payload: { price: 2600, inventory: 7 } });
  assert.equal(upd.json().price, 2600);
  assert.equal(upd.json().inventory, 7);

  const del = await app.inject({ method: 'DELETE', url: `/api/products/${tee.id}/variants/${vid}`, headers: auth() });
  assert.equal(del.statusCode, 200);
  assert.equal(await db.productVariant.findUnique({ where: { id: vid } }), null);

  // Wrong-product path 404s (variant must belong to the product in the URL).
  const cross = await app.inject({ method: 'PATCH', url: `/api/products/${mug.id}/variants/${tee.id}`, headers: auth(), payload: { price: 1 } });
  assert.equal(cross.statusCode, 404);
});

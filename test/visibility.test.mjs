// Who can see, open and BUY a product.
//
// The assertion that matters is not that a restricted product is missing from
// /shop — it is that the cart refuses it. Hiding a product from listings while
// the API still accepts its variant id is obscurity, not privacy: ids leak
// through old carts, shared links and the API itself, and anyone who has ever
// seen one would keep access forever.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../dist/server.js';
import { closeQueues } from '../dist/lib/queue.js';
import { db, disconnectDb } from '../dist/lib/db.js';
import { ensureSiteVisible } from './support/publicSite.mjs';

let app, vendor, milieu, member, outsider, pub, unlisted, restricted;

const variantOf = (p) => p.variants[0].id;

before(async () => {
  await ensureSiteVisible();
  app = await buildServer();
  vendor = await db.vendor.create({ data: { name: 'vistest Vendor' } });
  milieu = await db.milieu.create({ data: { name: 'vistest Inner', slug: `vistest-inner-${Date.now()}` } });

  member = await db.customer.create({ data: { email: `vistest-member-${Date.now()}@test.local`, name: 'Member' } });
  outsider = await db.customer.create({ data: { email: `vistest-out-${Date.now()}@test.local`, name: 'Outsider' } });
  await db.milieuMembership.create({ data: { milieuId: milieu.id, customerId: member.id } });

  const mk = (name, visibility) => db.product.create({
    data: {
      name, slug: `vistest-${name.toLowerCase()}-${Date.now()}`, status: 'active', visibility, vendorId: vendor.id,
      variants: { create: [{ sku: `VIS-${name}-${Date.now()}`, price: 2500, stockStatus: 'in_stock' }] },
    },
    include: { variants: true },
  });

  pub = await mk('Public', 'public');
  unlisted = await mk('Unlisted', 'private');
  restricted = await mk('Restricted', 'restricted');
  await db.productAudience.create({ data: { productId: restricted.id, milieuId: milieu.id } });
});

after(async () => {
  await db.productAudience.deleteMany({ where: { milieuId: milieu.id } }).catch(() => {});
  await db.productAccess.deleteMany({ where: { productId: restricted.id } }).catch(() => {});
  await db.productVariant.deleteMany({ where: { product: { vendorId: vendor.id } } }).catch(() => {});
  await db.product.deleteMany({ where: { vendorId: vendor.id } }).catch(() => {});
  await db.milieuMembership.deleteMany({ where: { milieuId: milieu.id } }).catch(() => {});
  await db.milieu.delete({ where: { id: milieu.id } }).catch(() => {});
  await db.customer.deleteMany({ where: { email: { startsWith: 'vistest-' } } }).catch(() => {});
  await db.vendor.delete({ where: { id: vendor.id } }).catch(() => {});
  await app.close();
  await closeQueues();
  await disconnectDb();
});

describe('listings', () => {
  test('a signed-out shopper sees only the public product', async () => {
    const res = await app.inject({ method: 'GET', url: '/shop' });
    assert.equal(res.statusCode, 200);
    // Checked by SLUG, which is unique to each fixture — matching on a word
    // like "member" would collide with the site's own chrome.
    assert.ok(res.body.includes(pub.slug), 'the public product is missing from /shop');
    assert.ok(!res.body.includes(unlisted.slug), 'an unlisted product was listed');
    assert.ok(!res.body.includes(restricted.slug), 'a restricted product was listed');
  });
});

describe('the direct URL', () => {
  test('UNLISTED opens for anyone — the link is the whole mechanism', async () => {
    const res = await app.inject({ method: 'GET', url: `/product/${unlisted.slug}` });
    assert.equal(res.statusCode, 200, 'an unlisted product must still open by link');
  });

  test('RESTRICTED 404s for a signed-out visitor, with no hint it exists', async () => {
    const res = await app.inject({ method: 'GET', url: `/product/${restricted.slug}` });
    assert.equal(res.statusCode, 404);
    // The same page as a product that never existed. Naming the product, or
    // the group, would confirm it to someone who should not know it is there.
    // Asserted on the product's own name/slug rather than a generic word, and
    // without regexing the whole document.
    assert.ok(!res.body.includes(restricted.slug), 'the 404 leaks the product slug');
    assert.ok(!res.body.includes(restricted.name), 'the 404 names the product');
    assert.ok(!res.body.includes(milieu.name), 'the 404 names the gating group');
  });
});

describe('THE ONE THAT MATTERS: the cart', () => {
  test('a restricted variant is REFUSED even when the id is known', async () => {
    // The id is supplied directly, exactly as a leaked or remembered id would
    // be. Listings are irrelevant here — this is the real gate.
    const res = await app.inject({
      method: 'POST', url: '/api/cart/items',
      payload: { variantId: variantOf(restricted), quantity: 1 },
    });
    assert.equal(res.statusCode, 404, 'a restricted product was addable to a cart by id');
  });

  test('an unlisted variant IS addable — unlisted is not sealed', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/cart/items',
      payload: { variantId: variantOf(unlisted), quantity: 1 },
    });
    assert.equal(res.statusCode, 201, 'an unlisted product must be buyable by link');
  });

  test('a public variant is addable', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/cart/items',
      payload: { variantId: variantOf(pub), quantity: 1 },
    });
    assert.equal(res.statusCode, 201);
  });
});

describe('who qualifies', () => {
  test('a MEMBER of the audience can see and buy the restricted product', async () => {
    const { canSee, canBuy, viewerFor } = await import('../dist/counter/visibility.js');
    const row = await db.product.findUnique({
      where: { id: restricted.id },
      include: { audiences: { select: { milieuId: true } }, access: { select: { customerId: true } } },
    });
    const viewer = await viewerFor(member.id);
    assert.ok(viewer.milieuIds.includes(milieu.id), 'membership did not resolve');
    assert.equal(canSee(row, viewer), true, 'a member cannot see it');
    assert.equal(canBuy(row, viewer), true, 'a member cannot buy it');
  });

  test('a non-member cannot, and a PENDING member counts as a non-member', async () => {
    const { canSee, viewerFor } = await import('../dist/counter/visibility.js');
    const row = await db.product.findUnique({
      where: { id: restricted.id },
      include: { audiences: { select: { milieuId: true } }, access: { select: { customerId: true } } },
    });
    assert.equal(canSee(row, await viewerFor(outsider.id)), false, 'an outsider can see it');

    // Awaiting approval grants nothing — the same rule the member discount
    // uses, so the two cannot drift apart.
    await db.milieuMembership.updateMany({ where: { milieuId: milieu.id, customerId: member.id }, data: { pendingAt: new Date() } });
    assert.equal(canSee(row, await viewerFor(member.id)), false, 'a pending member was let in');
    await db.milieuMembership.updateMany({ where: { milieuId: milieu.id, customerId: member.id }, data: { pendingAt: null } });
  });

  test('milieus and named accounts COMBINE — either one is enough', async () => {
    const { canSee, viewerFor } = await import('../dist/counter/visibility.js');
    await db.productAccess.create({ data: { productId: restricted.id, customerId: outsider.id } });
    const row = await db.product.findUnique({
      where: { id: restricted.id },
      include: { audiences: { select: { milieuId: true } }, access: { select: { customerId: true } } },
    });
    // The outsider is in no milieu, but has been granted the product directly.
    assert.equal(canSee(row, await viewerFor(outsider.id)), true, 'a direct account grant was ignored');
    // And the milieu member still qualifies without a direct grant.
    assert.equal(canSee(row, await viewerFor(member.id)), true, 'adding an account grant broke the milieu path');
  });

  test('a viewer with NO grants cannot match a restricted product through the query', async () => {
    // The dangerous shape: an empty OR inside the restricted branch would match
    // every restricted product rather than none.
    const { visibleWhere, ANONYMOUS } = await import('../dist/counter/visibility.js');
    const rows = await db.product.findMany({ where: { AND: [visibleWhere(ANONYMOUS)], id: restricted.id } });
    assert.equal(rows.length, 0, 'the anonymous query matched a restricted product');
  });
});

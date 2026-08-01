// Counter C4 — storefront surfaces: render, catalog visibility rules,
// receipt token auth, capability gate.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../dist/server.js';
import { closeQueues } from '../dist/lib/queue.js';
import { db, disconnectDb } from '../dist/lib/db.js';
import { recomputeReservations } from './support/reservations.mjs';
import { ensureSiteVisible } from './support/publicSite.mjs';

let app;
let vendor, product, order;

before(async () => {
  // A dev box left in coming-soon mode serves the launch page to every
  // public request, and these assertions then fail on content.
  await ensureSiteVisible();
  app = await buildServer();
  const { redis } = await import('../dist/lib/redis.js');
  await redis.del('ratelimit:cart-new:127.0.0.1');
  // Fixtures are created IDEMPOTENTLY. These slugs are unique, and any run
  // that dies before its cleanup leaves them behind — with plain create() the
  // next run then fails on a collision it did not cause, which is a suite that
  // breaks for whoever runs it next rather than for whoever broke it.
  await db.order.deleteMany({ where: { items: { some: { variant: { is: { product: { slug: { startsWith: 'sftest-' } } } } } } } }).catch(() => {});
  await db.product.deleteMany({ where: { slug: { startsWith: 'sftest-' } } }).catch(() => {});
  await db.vendor.deleteMany({ where: { name: 'sftest Vendor' } }).catch(() => {});

  vendor = await db.vendor.create({ data: { name: 'sftest Vendor' } });
  product = await db.product.create({
    data: {
      name: 'sftest Hoodie', slug: 'sftest-hoodie', status: 'active', vendorId: vendor.id,
      variants: { create: [{ sku: 'SFT-1', price: 4500, inventory: 9 }] },
    },
    include: { variants: true },
  });
  await db.product.create({ data: { name: 'sftest Draft', slug: 'sftest-draft', status: 'draft', vendorId: vendor.id } });
});

after(async () => {
  // Delete by what the rows ACTUALLY reference, not by a variable that may
  // never have been assigned. The old version skipped the order whenever
  // `order.orderId` was unset — the order then held a foreign key to the test
  // variant, the product delete failed, the fixtures survived, and the NEXT
  // run died on a unique-slug collision it did not cause. A cleanup that only
  // works on the happy path is how a suite starts failing for everyone.
  const orders = await db.order.findMany({
    where: { items: { some: { variant: { is: { product: { slug: { startsWith: 'sftest-' } } } } } } },
    select: { id: true },
  });
  for (const o of orders) {
    await db.refund.deleteMany({ where: { orderId: o.id } }).catch(() => {});
    await db.orderItem.deleteMany({ where: { orderId: o.id } }).catch(() => {});
    await db.order.delete({ where: { id: o.id } }).catch(() => {});
  }
  await db.product.deleteMany({ where: { slug: { startsWith: 'sftest-' } } });
  await db.vendor.deleteMany({ where: { name: 'sftest Vendor' } });
  // Orders reserve stock; deleting the row does not release it. Run LAST, once
  // this file's own orders are gone, so the next run starts from a clean count.
  await recomputeReservations();
  await app.close();
  await closeQueues();
  await disconnectDb();
});

test('/shop renders active products only; / serves the Base Theme site', async () => {
  const root = await app.inject({ method: 'GET', url: '/' });
  assert.equal(root.statusCode, 200, 'bare / is the site frontend now, not a shop redirect');
  assert.match(root.headers['content-type'], /text\/html/);

  const res = await app.inject({ method: 'GET', url: '/shop' });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /sftest Hoodie/);
  assert.doesNotMatch(res.body, /sftest Draft/, 'draft products never leak to the storefront');
  assert.match(res.headers['content-security-policy'], /connect-src 'self'/);
});

test('/product/:slug renders detail; draft and unknown slugs 404', async () => {
  const res = await app.inject({ method: 'GET', url: '/product/sftest-hoodie' });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /sftest Hoodie/);
  assert.match(res.body, /Add to cart/);

  const draft = await app.inject({ method: 'GET', url: '/product/sftest-draft' });
  assert.equal(draft.statusCode, 404, 'draft product page hidden');
  const ghost = await app.inject({ method: 'GET', url: '/product/no-such' });
  assert.equal(ghost.statusCode, 404);
});

test('/cart and /checkout are ONE flow, served at both URLs', async () => {
  // They used to be two separate documents with their own roots. They are now
  // the same shell in two modes, so both URLs must serve the identical
  // container — the runtime decides which step opens.
  const cart = await app.inject({ method: 'GET', url: '/cart' });
  assert.equal(cart.statusCode, 200);
  assert.match(cart.body, /id="co-flow"/);
  assert.match(cart.body, /id="co-step-cart"/);
  assert.match(cart.body, /id="co-step-pay"/);

  const co = await app.inject({ method: 'GET', url: '/checkout' });
  assert.equal(co.statusCode, 200);
  assert.match(co.body, /id="co-flow"/);

  // The summary is server-rendered, not injected later: the total must be on
  // screen the moment the page paints, not after a round trip.
  assert.match(cart.body, /id="co-total"/);
  // And the mobile action bar ships with it.
  assert.match(cart.body, /id="co-cta"/);
});

test('/order-received/ authenticates by access token; wrong/missing token 404s', async () => {
  // Real order through the real cart machinery.
  const add = await app.inject({ method: 'POST', url: '/api/cart/items', payload: { variantId: product.variants[0].id, quantity: 1 } });
  const token = add.json().token;
  const co = await app.inject({ method: 'POST', url: '/api/cart/checkout', payload: { cartToken: token, email: 'sf-shopper@example.com' } });
  order = co.json();

  const ok = await app.inject({ method: 'GET', url: `/order-received/?order=${order.orderNumber}&token=${order.accessToken}` });
  assert.equal(ok.statusCode, 200);
  assert.match(ok.body, new RegExp(order.orderNumber));
  assert.match(ok.body, /sf-shopper@example\.com/);

  const bad = await app.inject({ method: 'GET', url: `/order-received/?order=${order.orderNumber}&token=${'0'.repeat(32)}` });
  assert.equal(bad.statusCode, 404, 'wrong token → generic not-found');
  const none = await app.inject({ method: 'GET', url: `/order-received/?order=${order.orderNumber}` });
  assert.equal(none.statusCode, 404, 'missing token → not-found');
});

test('capability gate: commerce off → closed page, catalog hidden', async () => {
  const { capabilityService } = await import('../dist/services/capability.service.js');
  await capabilityService.setEnabled('commerce', false);
  try {
    const res = await app.inject({ method: 'GET', url: '/shop' });
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /isn't open yet/);
    assert.doesNotMatch(res.body, /sftest Hoodie/);
  } finally {
    await capabilityService.setEnabled('commerce', true);
  }
});

test('QUICK CHECKOUT ORDER: details before payment, and the strip is not in the card until then', async () => {
  const res = await app.inject({ method: 'GET', url: '/shop' });
  assert.equal(res.statusCode, 200);

  // The shopper's order is: options, then where it ships, then how it is paid.
  // The first build rendered the payment strip above the address, which asked
  // "how are you paying" before "where are we sending it" — and led with a row
  // of disabled pills when no provider was connected.
  const details = res.body.indexOf('data-pay-step="details"');
  const payment = res.body.indexOf('data-pay-step="payment"');
  assert.ok(details > -1 && payment > -1, 'the pay face is split into two steps');
  assert.ok(details < payment, 'details comes before payment in the markup');

  // The address fields belong to step one, the pay button to step two.
  const stepOne = res.body.slice(details, payment);
  for (const field of ['data-pay-email', 'data-pay-line1', 'data-pay-city', 'data-pay-postal']) {
    assert.ok(stepOne.includes(field), `${field} is on the details step`);
  }
  assert.ok(stepOne.includes('data-pay-next'), 'details ends with Continue, not Pay');
  assert.ok(!stepOne.includes('data-pay-go'), 'the Pay button is NOT on the details step');

  // The payment step is hidden until the shopper gets there, and the method
  // strip is fetched at that point rather than rendered into the card up front.
  assert.match(res.body.slice(payment, payment + 200), /hidden/, 'payment starts hidden');
  // The strip is fetched when the shopper reaches the payment step, so its
  // host ships EMPTY. Asserted on the element rather than on the string
  // "data-mgroup", which also appears in the inline script that builds it.
  assert.match(res.body, /data-pay-methodwrap><\/div>/, 'the method host ships empty and fills on demand');
});

test('SHOP COLUMNS: the setting reaches the grid AND the cards, server-side', async () => {
  const { settingsService } = await import('../dist/services/settings.service.js');
  const saved = await settingsService.getCounter();
  try {
    for (const n of [2, 3, 4]) {
      await settingsService.setCounter({ toolbarColumns: n });
      const res = await app.inject({ method: 'GET', url: '/shop' });
      assert.equal(res.statusCode, 200);

      // data-cols is what the stylesheet actually keys off, and it is rendered
      // server-side so the grid is right before any JS runs.
      assert.match(res.body, new RegExp(`data-cols="${n}"`), `grid carries data-cols=${n}`);

      // And the ITEM class, which is what the ported theme sizes cards with
      // (width: calc(100% / N)). This was hardcoded to 4, so changing the
      // setting moved the list's class and left every card at quarter width.
      assert.match(res.body, new RegExp(`c-product-grid__item--${n}-per-row`), `cards carry --${n}-per-row`);
      if (n !== 4) {
        assert.doesNotMatch(res.body, /c-product-grid__item--4-per-row/, 'no stale 4-per-row on the cards');
      }
    }
  } finally {
    await settingsService.setCounter(saved);
  }
});

test('SHOP COLUMNS: one system owns the count, and it steps down on small screens', async () => {
  const res = await app.inject({ method: 'GET', url: '/shop' });

  // The fallback stylesheet used to carry a SECOND column system (a hardcoded
  // repeat(4,1fr) plus its own breakpoints) that competed with the toolbar's
  // data-cols rules. Whichever loaded last won, which is not a setting.
  assert.doesNotMatch(res.body, /\.c-product-grid__list\{display:grid;grid-template-columns:repeat\(4,1fr\)/,
    'no hardcoded 4-column fallback');

  for (const bp of ['1023px', '820px', '560px']) {
    assert.ok(res.body.includes(`max-width:${bp}`), `steps down at ${bp}`);
  }
});

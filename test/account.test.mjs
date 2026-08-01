// The storefront account surface: order history, pushed offers, and the
// scoping that keeps one shopper out of another's account.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../dist/server.js';
import { closeQueues } from '../dist/lib/queue.js';
import { db, disconnectDb } from '../dist/lib/db.js';
import { recomputeReservations } from './support/reservations.mjs';

let app;
let vendor, product, coupon;
let alice, bob; // { token, customer }

const PW = 'account-test-password-1';

async function signUp(email) {
  const res = await app.inject({
    method: 'POST', url: '/api/shop/account/register',
    payload: { email, password: PW, name: email.split('@')[0] },
  });
  assert.equal(res.statusCode, 201, res.body);
  return res.json();
}

const auth = (who) => ({ authorization: `Bearer ${who.token}` });

before(async () => {
  app = await buildServer();

  // Idempotent fixtures — a run that dies before cleanup must not break the
  // next one on a collision it did not cause.
  await db.customerOffer.deleteMany({ where: { customer: { email: { startsWith: 'accttest-' } } } }).catch(() => {});
  await db.order.deleteMany({ where: { customer: { email: { startsWith: 'accttest-' } } } }).catch(() => {});
  await db.customer.deleteMany({ where: { email: { startsWith: 'accttest-' } } }).catch(() => {});
  await db.order.deleteMany({ where: { items: { some: { variant: { is: { product: { slug: { startsWith: 'accttest-' } } } } } } } }).catch(() => {});
  await db.product.deleteMany({ where: { slug: { startsWith: 'accttest-' } } }).catch(() => {});
  await db.vendor.deleteMany({ where: { name: 'accttest Vendor' } }).catch(() => {});
  await db.coupon.deleteMany({ where: { code: 'ACCTTEST20' } }).catch(() => {});

  const { redis } = await import('../dist/lib/redis.js');
  await redis.del('ratelimit:cart-new:127.0.0.1');
  // The coupon throttle is 20 attempts / 10 min per IP (audit F7). This file
  // applies more codes than that, and every request here is 127.0.0.1 — so a
  // stale bucket makes the suite fail with 429s that have nothing to do with
  // the behaviour under test.
  await redis.del('ratelimit:cart-coupon:127.0.0.1');
  // Account signup is 5 per 15 minutes per IP. This file signs up two accounts
  // in its fixtures, so a window left hot by an earlier run 429'd the SETUP —
  // which cancels every test in the file rather than failing one of them.
  await redis.del('ratelimit:customer-register:127.0.0.1');

  vendor = await db.vendor.create({ data: { name: 'accttest Vendor' } });
  product = await db.product.create({
    data: {
      name: 'accttest Cap', slug: 'accttest-cap', status: 'active', vendorId: vendor.id,
      image: 'https://example.test/cap.jpg',
      variants: { create: [{ sku: 'ACCT-1', price: 3000, inventory: 20 }] },
    },
    include: { variants: true },
  });
  coupon = await db.coupon.create({
    data: { code: 'ACCTTEST20', type: 'percent', amount: 20, status: 'active' },
  });

  alice = await signUp('accttest-alice@example.test');
  bob = await signUp('accttest-bob@example.test');
});

after(async () => {
  await db.customerOffer.deleteMany({ where: { customer: { email: { startsWith: 'accttest-' } } } }).catch(() => {});
  await db.order.deleteMany({ where: { items: { some: { variant: { is: { product: { slug: { startsWith: 'accttest-' } } } } } } } }).catch(() => {});
  await db.customer.deleteMany({ where: { email: { startsWith: 'accttest-' } } }).catch(() => {});
  await db.product.deleteMany({ where: { slug: { startsWith: 'accttest-' } } }).catch(() => {});
  await db.vendor.deleteMany({ where: { name: 'accttest Vendor' } }).catch(() => {});
  await db.coupon.deleteMany({ where: { code: 'ACCTTEST20' } }).catch(() => {});
  // Orders reserve stock; deleting the row does not release it. Run LAST, once
  // this file's own orders are gone, so the next run starts from a clean count.
  await recomputeReservations();
  await app.close();
  await closeQueues();
  await disconnectDb();
});

describe('order history', () => {
  test('a signed-in checkout binds the order to the account; a guest one does not', async () => {
    const add = await app.inject({
      method: 'POST', url: '/api/cart/items',
      payload: { variantId: product.variants[0].id, quantity: 1 },
    });
    const cartToken = add.json().token;

    const out = await app.inject({
      method: 'POST', url: '/api/cart/checkout',
      headers: auth(alice),
      payload: { cartToken, email: 'accttest-alice@example.test' },
    });
    assert.equal(out.statusCode, 201, out.body);
    const number = out.json().orderNumber;

    const mine = await app.inject({ method: 'GET', url: '/api/shop/account/orders', headers: auth(alice) });
    assert.equal(mine.statusCode, 200);
    assert.equal(mine.json().orders.some((o) => o.number === number), true);

    // Bob's history must not contain Alice's order — the scoping is the point.
    const theirs = await app.inject({ method: 'GET', url: '/api/shop/account/orders', headers: auth(bob) });
    assert.equal(theirs.json().orders.some((o) => o.number === number), false);
  });

  test('guest checkout leaves the order unbound', async () => {
    const add = await app.inject({
      method: 'POST', url: '/api/cart/items',
      payload: { variantId: product.variants[0].id, quantity: 1 },
    });
    const out = await app.inject({
      method: 'POST', url: '/api/cart/checkout',
      payload: { cartToken: add.json().token, email: 'accttest-alice@example.test' },
    });
    const order = await db.order.findUnique({ where: { number: out.json().orderNumber }, select: { customerId: true } });
    // An unverified email must NOT resolve to the account that happens to own
    // it (audit H-1) — only a real session may bind an order.
    assert.equal(order.customerId, null);
  });

  test('order history requires a session', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/shop/account/orders' });
    assert.equal(res.statusCode, 401);
  });
});

describe('pushed offers', () => {
  test('an offer reaches the named customer and nobody else', async () => {
    await db.customerOffer.create({
      data: { customerId: alice.customer.id, couponId: coupon.id, title: 'Twenty for you' },
    });

    const hers = await app.inject({ method: 'GET', url: '/api/shop/account/offers', headers: auth(alice) });
    assert.equal(hers.json().offers.length, 1);
    assert.equal(hers.json().offers[0].title, 'Twenty for you');

    const his = await app.inject({ method: 'GET', url: '/api/shop/account/offers', headers: auth(bob) });
    assert.equal(his.json().offers.length, 0);
  });

  test('the code is withheld until the offer is claimed', async () => {
    const before = await app.inject({ method: 'GET', url: '/api/shop/account/offers', headers: auth(alice) });
    const offer = before.json().offers[0];
    // A "personal" discount whose code ships unclaimed is a public discount.
    assert.equal(offer.code, null);

    const claim = await app.inject({
      method: 'POST', url: `/api/shop/account/offers/${offer.id}/claim`, headers: auth(alice),
    });
    assert.equal(claim.statusCode, 200);
    assert.equal(claim.json().code, 'ACCTTEST20');

    const after_ = await app.inject({ method: 'GET', url: '/api/shop/account/offers', headers: auth(alice) });
    assert.equal(after_.json().offers[0].code, 'ACCTTEST20');
  });

  test('another customer cannot claim someone else\'s offer', async () => {
    const hers = await app.inject({ method: 'GET', url: '/api/shop/account/offers', headers: auth(alice) });
    const offerId = hers.json().offers[0].id;
    const res = await app.inject({
      method: 'POST', url: `/api/shop/account/offers/${offerId}/claim`, headers: auth(bob),
    });
    assert.equal(res.statusCode, 404);
  });

  test('an offer of an inactive coupon disappears rather than failing at checkout', async () => {
    await db.coupon.update({ where: { id: coupon.id }, data: { status: 'inactive' } });
    const res = await app.inject({ method: 'GET', url: '/api/shop/account/offers', headers: auth(alice) });
    assert.equal(res.json().offers.length, 0);
    await db.coupon.update({ where: { id: coupon.id }, data: { status: 'active' } });
  });

  test('pushing to a customer who already claimed leaves their offer alone', async () => {
    const { customerAccountService } = await import('../dist/services/customerAccount.service.js');
    const out = await customerAccountService.pushOffer({
      couponId: coupon.id,
      customerIds: [alice.customer.id, bob.customer.id],
      title: 'Rewritten pitch',
    });
    assert.equal(out.skipped, 1); // Alice already claimed
    assert.equal(out.created, 1); // Bob is new

    const hers = await app.inject({ method: 'GET', url: '/api/shop/account/offers', headers: auth(alice) });
    assert.equal(hers.json().offers[0].title, 'Twenty for you');
  });
});

describe('member pricing', () => {
  let milieu;

  before(async () => {
    await db.milieu.deleteMany({ where: { slug: 'accttest-ff' } }).catch(() => {});
    milieu = await db.milieu.create({
      data: { name: 'accttest Friends', slug: 'accttest-ff', color: '#000', discountPct: 25 },
    });
    await db.milieuMembership.create({ data: { customerId: alice.customer.id, milieuId: milieu.id } });
  });

  after(async () => {
    await db.milieuMembership.deleteMany({ where: { milieuId: milieu.id } }).catch(() => {});
    await db.milieu.deleteMany({ where: { id: milieu.id } }).catch(() => {});
  });

  const cookie = (who) => ({ cookie: `th_customer=${encodeURIComponent(who.token)}` });

  test('a member sees the net price on the shop; a guest sees list', async () => {
    const member = await app.inject({ method: 'GET', url: '/shop?q=accttest', headers: cookie(alice) });
    const guest = await app.inject({ method: 'GET', url: '/shop?q=accttest' });
    // 3000 minus 25% = 2250.
    assert.match(member.body, /\$22\.50/, 'member is shown their own price');
    assert.match(guest.body, /\$30\.00/, 'guest is shown list price');
    // The whole point of 'net': no struck-through list price for a member.
    // Matched as an ELEMENT — the class name is in the inlined stylesheet on
    // every page, so a bare /card-was/ passes everywhere and proves nothing.
    assert.doesNotMatch(member.body, /<del[^>]*card-was/, 'membership is not rendered as a sale');
  });

  test('the cart charges what the member was shown', async () => {
    const add = await app.inject({
      method: 'POST', url: '/api/cart/items',
      headers: cookie(alice),
      payload: { variantId: product.variants[0].id, quantity: 1 },
    });
    const token = add.json().token;
    const cart = await app.inject({
      method: 'GET', url: '/api/cart',
      headers: { 'x-cart-token': token, ...cookie(alice) },
    });
    const t = cart.json().totals;
    assert.equal(t.subtotal, 3000);
    assert.equal(t.discount.amount, 750);
    assert.equal(t.total, 2250, 'the price on the card is the price in the cart');
  });

  // The rule, stated plainly: ONLY a member of a milieu sees net pricing.
  // Everybody else — guest or signed-in — sees an ordinary sale, with the
  // was-price struck through. These three cases are the whole rule.
  test('on a SALE item: guest and non-member see the strike-through, a member does not', async () => {
    // compareAtPrice is the "was". priceFrom is what it costs today.
    await db.product.update({
      where: { id: product.id },
      data: { meta: { compareAtPrice: 4000 } },
    });
    try {
      const guest = await app.inject({ method: 'GET', url: '/shop?q=accttest' });
      assert.match(guest.body, /<del[^>]*card-was/, 'a guest sees a normal sale');
      assert.match(guest.body, /\$40\.00/, 'and the was-price it is discounted from');
      assert.match(guest.body, /\$30\.00/);

      // Bob has an account but is in no milieu — he is not an exception.
      const nonMember = await app.inject({ method: 'GET', url: '/shop?q=accttest', headers: cookie(bob) });
      assert.match(nonMember.body, /<del[^>]*card-was/, 'having an account is not membership');
      assert.match(nonMember.body, /\$30\.00/);

      // Alice is in the milieu. Her price is her price — 25% off the CURRENT
      // price, and no struck-out number of any kind.
      const member = await app.inject({ method: 'GET', url: '/shop?q=accttest', headers: cookie(alice) });
      assert.match(member.body, /\$22\.50/, 'member discount applies on top of the sale price');
      assert.doesNotMatch(member.body, /<del[^>]*card-was/, 'a member never sees a strike-through');
      assert.doesNotMatch(member.body, /\$40\.00/, 'the was-price is not a claim being made to them');
    } finally {
      await db.product.update({ where: { id: product.id }, data: { meta: {} } });
    }
  });

  // Bam's rule: the member price is a FLOOR, not a competing discount. The
  // totals pipeline's own rule is best-single-wins, which would have let a
  // LARGER coupon replace the member price — the opposite of a floor.
  test('a member cannot stack a coupon, even one worth more', async () => {
    const add = await app.inject({
      method: 'POST', url: '/api/cart/items',
      headers: cookie(alice),
      payload: { variantId: product.variants[0].id, quantity: 1 },
    });
    const cartToken = add.json().token;

    // ACCTTEST20 is 20% — smaller than her 25% membership. A 90% one is not.
    const big = await db.coupon.create({ data: { code: 'ACCTTESTBIG', type: 'percent', amount: 90, status: 'active' } });
    try {
      const res = await app.inject({
        method: 'POST', url: '/api/cart/coupon',
        headers: cookie(alice),
        payload: { cartToken, code: 'ACCTTESTBIG' },
      });
      assert.equal(res.statusCode, 422, res.body);
      assert.match(res.json().error.message, /member price/i, 'and it says why, rather than failing silently');

      const cart = await app.inject({
        method: 'GET', url: '/api/cart',
        headers: { 'x-cart-token': cartToken, ...cookie(alice) },
      });
      const t = cart.json().totals;
      assert.equal(t.coupon, null);
      assert.equal(t.total, 2250, 'still the member price — the 90% coupon never applied');
    } finally {
      await db.coupon.deleteMany({ where: { id: big.id } }).catch(() => {});
    }
  });

  test('a NON-member can still use the same coupon', async () => {
    const add = await app.inject({
      method: 'POST', url: '/api/cart/items',
      headers: cookie(bob),
      payload: { variantId: product.variants[0].id, quantity: 1 },
    });
    const res = await app.inject({
      method: 'POST', url: '/api/cart/coupon',
      headers: cookie(bob),
      payload: { cartToken: add.json().token, code: 'ACCTTEST20' },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().totals.coupon.code, 'ACCTTEST20');
  });

  test('a typed email never unlocks membership — only a session does', async () => {
    const add = await app.inject({
      method: 'POST', url: '/api/cart/items',
      payload: { variantId: product.variants[0].id, quantity: 1 },
    });
    const token = add.json().token;
    // Audit H-1: supplying a member's address must not inherit their benefits.
    await app.inject({
      method: 'POST', url: '/api/cart/identity',
      payload: { cartToken: token, email: 'accttest-alice@example.test' },
    });
    const cart = await app.inject({ method: 'GET', url: '/api/cart', headers: { 'x-cart-token': token } });
    const t = cart.json().totals;
    assert.equal(t.discount, null, 'no discount from a guessed email');
    assert.equal(t.total, 3000);
  });
});

// Bam: "that percentage is based on the price I get the product for... a
// straight fifty percent can't always work." A percent off RETAIL says nothing
// about whether the sale still makes money, so discounts are clamped against
// the variant's own cost.
describe('margin floor', () => {
  let cheapMargin, floorCoupon, savedCommerce, settingsService;

  before(async () => {
    // Imported here, not at describe scope — a describe callback is not async.
    ({ settingsService } = await import('../dist/services/settings.service.js'));
    const { redis } = await import('../dist/lib/redis.js');
    await redis.del('ratelimit:cart-coupon:127.0.0.1');
    savedCommerce = await settingsService.getCommerce();
    await db.product.deleteMany({ where: { slug: 'accttest-thin' } }).catch(() => {});
    // Retail $60 on a $40 cost — a 1.5x markup, where 50% off sells under cost.
    cheapMargin = await db.product.create({
      data: {
        name: 'accttest Thin Margin', slug: 'accttest-thin', status: 'active', vendorId: vendor.id,
        variants: { create: [{ sku: 'ACCT-THIN', price: 6000, cost: 4000, inventory: 10 }] },
      },
      include: { variants: true },
    });
    floorCoupon = await db.coupon.create({
      data: { code: 'ACCTTESTHALF', type: 'percent', amount: 50, status: 'active' },
    });
  });

  after(async () => {
    // Restored through the SERVICE and in an after() that always runs — a
    // failed assertion must not leave the operator's store clamped.
    await settingsService.setCommerce({ minMarginPct: savedCommerce.minMarginPct ?? 0 });
    await db.coupon.deleteMany({ where: { id: floorCoupon.id } }).catch(() => {});
    await db.product.deleteMany({ where: { id: cheapMargin.id } }).catch(() => {});
  });

  async function applyHalfOff() {
    const add = await app.inject({
      method: 'POST', url: '/api/cart/items',
      payload: { variantId: cheapMargin.variants[0].id, quantity: 1 },
    });
    const res = await app.inject({
      method: 'POST', url: '/api/cart/coupon',
      payload: { cartToken: add.json().token, code: 'ACCTTESTHALF' },
    });
    return res.json().totals;
  }

  test('with no floor set, 50% off sells below cost', async () => {
    await settingsService.setCommerce({ minMarginPct: 0 });
    const t = await applyHalfOff();
    assert.equal(t.total, 3000, 'the honest baseline: $30 on a $40 cost');
    assert.equal(t.discountClamped, null);
  });

  test('a 25% floor clamps the same coupon to what the margin allows', async () => {
    await settingsService.setCommerce({ minMarginPct: 25 });
    const t = await applyHalfOff();
    // 4000 cost + 25% = 5000 floor, so at most 1000 can come off.
    assert.equal(t.total, 5000);
    assert.equal(t.coupon.amount, 1000);
    assert.deepEqual(t.discountClamped, { requested: 3000, applied: 1000 },
      'the merchant is told their 50% only paid out as 1000');
  });

  test('a product with no recorded cost is never clamped — guessing is worse', async () => {
    await settingsService.setCommerce({ minMarginPct: 25 });
    // `product` (the accttest Cap) has no cost on its variant.
    const add = await app.inject({
      method: 'POST', url: '/api/cart/items',
      payload: { variantId: product.variants[0].id, quantity: 1 },
    });
    const res = await app.inject({
      method: 'POST', url: '/api/cart/coupon',
      payload: { cartToken: add.json().token, code: 'ACCTTESTHALF' },
    });
    const t = res.json().totals;
    assert.equal(t.total, 1500, 'full 50% off 3000 — there is no cost to protect');
    assert.equal(t.discountClamped, null);
  });
});

describe('recommendations', () => {
  test('history-based once there is history, and labelled honestly when not', async () => {
    const hers = await app.inject({ method: 'GET', url: '/api/shop/account/recommendations', headers: auth(alice) });
    assert.equal(hers.statusCode, 200);
    assert.ok(['history', 'new'].includes(hers.json().basis));

    // Bob has bought nothing, so his can only be the new-arrivals fallback —
    // and must SAY so rather than implying a personalisation that never ran.
    const his = await app.inject({ method: 'GET', url: '/api/shop/account/recommendations', headers: auth(bob) });
    assert.equal(his.json().basis, 'new');
  });
});

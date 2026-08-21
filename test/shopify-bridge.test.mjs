// The Shopify bridge.
//
// Built out because Contrado (and a lot of marketing/dropshipping tools) only
// ever learned Shopify. It had FIVE read endpoints and no tests at all — the
// test audit flagged it as an untested partner-facing auth surface.
//
// The failures worth pinning are the quiet ones: a read-only key that can
// write, a price parsed 100x wrong, and a webhook address pointed at this
// store's own network.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../dist/server.js';
import { db, disconnectDb } from '../dist/lib/db.js';
import { closeQueues } from '../dist/lib/queue.js';
import { storeCredentials } from '../dist/counter/storeCredentials.js';

const API = '/admin/api/2024-10';

let app;
let rw;
let ro;
const madeProductIds = [];

before(async () => {
  app = await buildServer();
  await app.ready();
  rw = await storeCredentials.issue('SHOPIFYTEST readwrite', 'read_write');
  ro = await storeCredentials.issue('SHOPIFYTEST readonly', 'read');
});

after(async () => {
  for (const id of madeProductIds) await db.product.delete({ where: { id } }).catch(() => {});
  await db.storeWebhook.deleteMany({ where: { name: { startsWith: 'Shopify ' } } });
  await db.storeCredential.deleteMany({ where: { label: { startsWith: 'SHOPIFYTEST' } } });
  await app.close();
  await closeQueues();
  await disconnectDb();
});

const tok = (c) => ({ 'x-shopify-access-token': c.consumerSecret });

describe('authentication', () => {
  test('no token is refused', async () => {
    const r = await app.inject({ method: 'GET', url: `${API}/products.json` });
    assert.equal(r.statusCode, 401);
  });

  test('a wrong token is refused', async () => {
    const r = await app.inject({
      method: 'GET', url: `${API}/products.json`,
      headers: { 'x-shopify-access-token': 'shpat_not-a-real-token' },
    });
    assert.equal(r.statusCode, 401);
  });

  test('a valid token reads the catalogue in Shopify’s NAMED envelope', async () => {
    const r = await app.inject({ method: 'GET', url: `${API}/products.json`, headers: tok(rw) });
    assert.equal(r.statusCode, 200);
    const body = r.json();
    // A bare array here makes a client report an empty catalogue rather than an
    // error — the worst failure mode, because it looks like it worked.
    assert.ok(Array.isArray(body.products), 'response must be {products: [...]}, not a bare array');
  });
});

describe('a read-only key cannot change anything', () => {
  test('it cannot create a product', async () => {
    const r = await app.inject({
      method: 'POST', url: `${API}/products.json`, headers: tok(ro),
      payload: { product: { title: 'SHOULD NOT EXIST' } },
    });
    assert.equal(r.statusCode, 403);
    const leaked = await db.product.findFirst({ where: { name: 'SHOULD NOT EXIST' } });
    assert.equal(leaked, null, 'a read-only key created a product');
  });

  test('it cannot register a webhook', async () => {
    const r = await app.inject({
      method: 'POST', url: `${API}/webhooks.json`, headers: tok(ro),
      payload: { webhook: { topic: 'orders/create', address: 'https://partner.example/hook' } },
    });
    assert.equal(r.statusCode, 403);
  });
});

describe('a partner publishing product into the store', () => {
  test('a pushed product lands, with its description and price intact', async () => {
    const r = await app.inject({
      method: 'POST', url: `${API}/products.json`, headers: tok(rw),
      payload: {
        product: {
          title: 'SHOPIFYTEST Cap',
          body_html: 'Six-panel, structured.',
          variants: [{ sku: 'SHOP-CAP-1', price: '24.00', option1: 'One size', option2: 'Black', inventory_quantity: 5 }],
        },
      },
    });
    assert.equal(r.statusCode, 201);
    const p = r.json().product;
    madeProductIds.push(p.id);

    assert.equal(p.title, 'SHOPIFYTEST Cap');
    assert.equal(p.body_html, 'Six-panel, structured.');
    // The 100x bug: Shopify sends decimal strings, the store holds minor units.
    assert.equal(p.variants[0].price, '24', 'price round-tripped wrong — check minor-unit conversion');
    const stored = await db.product.findUnique({ where: { id: p.id }, include: { variants: true } });
    assert.equal(stored.variants[0].price, 2400, '24.00 must be stored as 2400 minor units');
    assert.equal(stored.description, 'Six-panel, structured.');
  });

  test('a product with no title is refused', async () => {
    const r = await app.inject({
      method: 'POST', url: `${API}/products.json`, headers: tok(rw), payload: { product: { body_html: 'x' } },
    });
    assert.equal(r.statusCode, 422);
  });

  test('an update changes only what was sent', async () => {
    const id = madeProductIds[0];
    const r = await app.inject({
      method: 'PUT', url: `${API}/products/${id}.json`, headers: tok(rw),
      payload: { product: { body_html: 'Updated copy.' } },
    });
    assert.equal(r.statusCode, 200);
    const stored = await db.product.findUnique({ where: { id } });
    assert.equal(stored.description, 'Updated copy.');
    assert.equal(stored.name, 'SHOPIFYTEST Cap', 'the title must not be blanked by an update that omitted it');
  });

  test('updating a product that does not exist is a 404, not a crash', async () => {
    const r = await app.inject({
      method: 'PUT', url: `${API}/products/nope.json`, headers: tok(rw), payload: { product: { title: 'x' } },
    });
    assert.equal(r.statusCode, 404);
  });
});

describe('webhooks', () => {
  test('a partner can subscribe, and it lands in the SAME table the Woo bridge uses', async () => {
    const r = await app.inject({
      method: 'POST', url: `${API}/webhooks.json`, headers: tok(rw),
      payload: { webhook: { topic: 'orders/create', address: 'https://partner.example/orders' } },
    });
    assert.equal(r.statusCode, 201);
    const w = r.json().webhook;
    assert.equal(w.topic, 'orders/create');

    // One delivery pipeline for both bridges — stored under the internal topic.
    const row = await db.storeWebhook.findUnique({ where: { id: w.id } });
    assert.equal(row.topic, 'order.created', 'Shopify topics must map to the internal topic the delivery pipeline uses');
    assert.ok(row.secretEncrypted, 'a webhook without a signing secret cannot be verified by the partner');
  });

  test('an unsupported topic is refused', async () => {
    const r = await app.inject({
      method: 'POST', url: `${API}/webhooks.json`, headers: tok(rw),
      payload: { webhook: { topic: 'customers/redact', address: 'https://partner.example/x' } },
    });
    assert.equal(r.statusCode, 422);
  });

  test('an address inside this store’s own network is refused', async () => {
    // Otherwise a partner can make the store POST order contents to something
    // on its own private network.
    for (const address of ['http://partner.example/x', 'https://127.0.0.1/x', 'https://10.0.0.5/x', 'https://192.168.1.9/x']) {
      const r = await app.inject({
        method: 'POST', url: `${API}/webhooks.json`, headers: tok(rw),
        payload: { webhook: { topic: 'orders/create', address } },
      });
      assert.equal(r.statusCode, 422, `${address} must be refused`);
    }
  });
});

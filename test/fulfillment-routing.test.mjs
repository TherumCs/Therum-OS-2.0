// Routing an order OUT to whoever prints it.
//
// The failures that matter here are silent ones: a line sent to the wrong
// factory, a line sent nowhere, or an order pushed with an address that cannot
// be printed. None of those throw — they just mean a customer never gets their
// order — so they are asserted directly.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { linesByProvider, shippable } from '../dist/counter/fulfillmentRouting.js';

const addr = {
  name: 'Test Person', line1: '733 north 35th street',
  city: 'philadelphia', region: 'PA', postalCode: '19104', country: 'US',
};

const line = (vendor, sourceId, qty = 1) => ({
  quantity: qty,
  priceAtTime: 2400,
  variant: { sourceId, sku: `SKU-${sourceId}`, product: { fulfillmentProvider: vendor } },
});

describe('which factory gets which line', () => {
  test('a mixed basket splits per provider, not per order', () => {
    // The case that makes per-order routing wrong: one basket, two factories.
    const groups = linesByProvider({
      id: 'o1', number: 'THR-1', currency: 'USD', shipAddress: addr,
      items: [line('printful', '111'), line('printify', '222'), line('printful', '333')],
    });
    assert.equal(groups.size, 2);
    assert.equal(groups.get('printful').length, 2);
    assert.equal(groups.get('printify').length, 1);
  });

  test('a self-fulfilled line is routed to NOBODY, not to a default', () => {
    // Starter Tee / Starter Pant have no provider. Sending them to whichever
    // factory happened to be first would print something nobody ordered.
    const groups = linesByProvider({
      id: 'o2', number: 'THR-2', currency: 'USD', shipAddress: addr,
      items: [{ quantity: 1, priceAtTime: 1000, variant: { sourceId: null, sku: 'TEE-S', product: { fulfillmentProvider: null } } }],
    });
    assert.equal(groups.size, 0, 'a line with no provider must not be routed anywhere');
  });

  test('a line with a provider but NO provider id is not routed', () => {
    // Half-attributed rows exist from before sourceVendorId was recorded.
    // Pushing one would send a null variant id to a real factory.
    const groups = linesByProvider({
      id: 'o3', number: 'THR-3', currency: 'USD', shipAddress: addr,
      items: [{ quantity: 1, priceAtTime: 1000, variant: { sourceId: null, product: { fulfillmentProvider: 'printful' } } }],
    });
    assert.equal(groups.size, 0);
  });

  test('an order with no items routes nowhere and does not throw', () => {
    assert.equal(linesByProvider({ id: 'o4', number: 'THR-4', currency: 'USD', items: [] }).size, 0);
  });
});

describe('refusing to push an unprintable address', () => {
  test('a complete address passes', () => {
    assert.equal(shippable({ id: 'o', number: 'n', currency: 'USD', shipAddress: addr, items: [] }), null);
  });

  test('each missing required field is NAMED', () => {
    // A rejection at Printful is a support ticket; a refusal here is a log line
    // that says which field was absent.
    const noStreet = shippable({ id: 'o', number: 'n', currency: 'USD', shipAddress: { ...addr, line1: '' }, items: [] });
    assert.match(noStreet, /address1/);
    const noCity = shippable({ id: 'o', number: 'n', currency: 'USD', shipAddress: { ...addr, city: '' }, items: [] });
    assert.match(noCity, /city/);
    const noCountry = shippable({ id: 'o', number: 'n', currency: 'USD', shipAddress: { ...addr, country: '' }, items: [] });
    assert.match(noCountry, /country_code/);
  });

  test('an entirely missing address is refused, not sent as blanks', () => {
    const none = shippable({ id: 'o', number: 'n', currency: 'USD', items: [] });
    assert.ok(none, 'an order with no shipping address must never be pushed');
    assert.match(none, /address1/);
  });

  test('region and postcode are NOT required — plenty of countries have neither', () => {
    const ok = shippable({
      id: 'o', number: 'n', currency: 'USD', items: [],
      shipAddress: { line1: '1 Road', city: 'Town', country: 'IE' },
    });
    assert.equal(ok, null, 'requiring a postcode would reject valid Irish addresses');
  });
});

describe('contrado', () => {
  test('contrado lines group to contrado and nowhere else', () => {
    // Contrado is reached by its OWN api (api.contrado.app), not the Shopify
    // bridge — their dropship app installs through Shopify's OAuth servers,
    // which no compatibility surface can satisfy.
    const groups = linesByProvider({
      id: 'o5', number: 'THR-5', currency: 'USD', shipAddress: addr,
      items: [line('contrado', '9001'), line('printful', '111'), line('contrado', '9002')],
    });
    assert.equal(groups.get('contrado').length, 2);
    assert.equal(groups.get('printful').length, 1);
    assert.equal(groups.size, 2, 'a contrado line must not leak into another provider');
  });

  test('a contrado order still refuses an unprintable address', () => {
    const blocked = shippable({
      id: 'o6', number: 'THR-6', currency: 'USD',
      shipAddress: { ...addr, city: '' },
      items: [line('contrado', '9003')],
    });
    assert.match(blocked, /city/);
  });
});

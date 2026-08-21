// The trash, and duplicating a product.
//
// What these pin is the difference between "gone from the list" and "gone":
// deleting used to destroy the row outright, taking variants, images, category
// assignments and order-line references with it, with no undo.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { productService } from '../dist/services/product.service.js';
import { ListProductsQuery } from '../dist/schemas/product.schema.js';

// The ROUTE parses the query through Zod, which supplies take/orderBy defaults.
// Calling list({}) raw skips that and fails inside Prisma — so go through the
// same schema the real caller does.
const listQuery = (over = {}) => ListProductsQuery.parse(over);
import { db, disconnectDb } from '../dist/lib/db.js';
import { closeQueues } from '../dist/lib/queue.js';

let made;

before(async () => {
  made = await productService.create({
    name: 'Trash Test Product',
    status: 'active',
    variants: [
      { price: 2500, sku: 'TRASH-A', color: 'Black', size: 'M', inventory: 3 },
      { price: 2500, sku: 'TRASH-B', color: 'Black', size: 'L', inventory: 0 },
    ],
  });
});

after(async () => {
  await db.product.deleteMany({ where: { name: { startsWith: 'Trash Test Product' } } });
  await closeQueues();
  await disconnectDb();
});

describe('moving a product to the trash', () => {
  test('remove() TRASHES rather than deletes — the row and its variants survive', async () => {
    const out = await productService.remove(made.id);
    assert.equal(out.trashed, true);
    const row = await db.product.findUnique({ where: { id: made.id }, include: { variants: true } });
    assert.ok(row, 'the product row must still exist');
    assert.ok(row.deletedAt instanceof Date, 'deletedAt must be stamped');
    assert.equal(row.variants.length, 2, 'variants must survive the trash');
  });

  test('a trashed product disappears from the normal list', async () => {
    const { items } = await productService.list(listQuery());
    assert.ok(!items.some((p) => p.id === made.id), 'trashed products must not appear in the live catalogue');
  });

  test('...and appears in the trash view', async () => {
    const { items } = await productService.list(listQuery({ trashed: true }));
    assert.ok(items.some((p) => p.id === made.id), 'the trash view must show it');
  });

  test('restoring returns it to the status it had, not a default', async () => {
    // The reason deletedAt is a timestamp and not a `trashed` status value: a
    // status would have overwritten 'active' and restore would have to guess.
    await productService.restore(made.id);
    const row = await db.product.findUnique({ where: { id: made.id } });
    assert.equal(row.deletedAt, null);
    assert.equal(row.status, 'active', 'restore must not change the status');
    const { items } = await productService.list(listQuery());
    assert.ok(items.some((p) => p.id === made.id), 'a restored product is back in the catalogue');
  });
});

describe('permanent deletion', () => {
  test('purging something NOT in the trash is refused', async () => {
    // One misclick must not be able to destroy a live product with sales
    // history — trashing is a required first step.
    await assert.rejects(
      () => productService.purge(made.id),
      (e) => /trash/i.test(e.message),
      'purging a live product must be refused',
    );
    assert.ok(await db.product.findUnique({ where: { id: made.id } }), 'it must still exist');
  });

  test('purging a trashed product does delete it', async () => {
    await productService.remove(made.id);
    await productService.purge(made.id);
    assert.equal(await db.product.findUnique({ where: { id: made.id } }), null);
  });
});

describe('duplicating', () => {
  let original;
  let copy;

  before(async () => {
    original = await productService.create({
      name: 'Trash Test Product Source',
      status: 'active',
      variants: [{ price: 4200, sku: 'DUP-ORIGINAL', color: 'Green', size: 'S', inventory: 7 }],
    });
    copy = await productService.duplicate(original.id);
  });

  test('the copy is a DRAFT, so it cannot reach shoppers unfinished', async () => {
    assert.equal(copy.status, 'draft');
    assert.notEqual(copy.id, original.id);
  });

  test('the slug differs — it is unique, so a verbatim copy would collide', () => {
    assert.notEqual(copy.slug, original.slug);
    assert.match(copy.slug, /-copy-/);
  });

  test('variants are copied WITH their prices', () => {
    assert.equal(copy.variants.length, 1);
    assert.equal(copy.variants[0].price, 4200, 'a copy priced at zero is not a copy');
  });

  test('SKU is NOT copied — two variants sharing one breaks fulfilment matching', () => {
    assert.ok(!copy.variants[0].sku, `expected a blank SKU, got ${copy.variants[0].sku}`);
  });

  test('sourceId is NOT copied — two products claiming one remote id corrupts the next sync', () => {
    assert.equal(copy.sourceId ?? null, null);
  });
});

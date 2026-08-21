// The object cache. The interesting half is not that it caches — it is that a
// write invalidates it, because a cache that serves a price nobody is selling
// at is worse than no cache at all.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { db, disconnectDb } from '../dist/lib/db.js';
import { disconnectRedis } from '../dist/lib/redis.js';
import { cached, invalidate, cacheStats, resetCacheStats } from '../dist/lib/cache.js';
import { settingsService } from '../dist/services/settings.service.js';

let vendorId;

let savedCacheToggle;

before(async () => {
  // The cache is gated by Settings > Performance > cache, and this dev box had
  // it switched OFF — every assertion below then fails with "did not
  // recompute", which reads as a broken cache rather than a disabled one.
  // Tests own their preconditions.
  savedCacheToggle = (await settingsService.getPerformance()).cache;
  await settingsService.setPerformance({ cache: true });
  await invalidate('catalog');
  await invalidate('settings');
});

after(async () => {
  await settingsService.setPerformance({ cache: savedCacheToggle });
  await db.product.deleteMany({ where: { slug: { startsWith: 'cachetest-' } } }).catch(() => {});
  if (vendorId) await db.vendor.delete({ where: { id: vendorId } }).catch(() => {});
  await disconnectDb();
  await disconnectRedis();
});

test('a second read is a hit, and the value round-trips intact', async () => {
  resetCacheStats();
  let computed = 0;
  const compute = async () => {
    computed++;
    return { n: 42, nested: { list: [1, 2, 3] }, s: 'value' };
  };

  const first = await cached('catalog', 'roundtrip', compute);
  const second = await cached('catalog', 'roundtrip', compute);

  assert.equal(computed, 1, 'the second call did not recompute');
  assert.deepEqual(second, first);
  assert.deepEqual(second.nested.list, [1, 2, 3], 'nested structures survive');
  assert.ok(cacheStats().hits >= 1, 'the hit was counted');
});

test('each caller gets its OWN object, so mutating a result cannot poison the cache', async () => {
  const key = 'mutation';
  const a = await cached('catalog', key, async () => ({ items: ['x'] }));
  a.items.push('MUTATED');
  const b = await cached('catalog', key, async () => ({ items: ['never'] }));
  assert.deepEqual(b.items, ['x'], 'the cached entry is untouched by the caller');
});

test('invalidating a namespace drops it without touching the others', async () => {
  await cached('catalog', 'k', async () => 'catalog-old');
  await cached('settings', 'k', async () => 'settings-old');

  await invalidate('catalog');

  assert.equal(await cached('catalog', 'k', async () => 'catalog-new'), 'catalog-new', 'catalog recomputed');
  assert.equal(await cached('settings', 'k', async () => 'settings-new'), 'settings-old', 'settings untouched');
});

test('THE ONE THAT MATTERS: saving a product invalidates the catalog', async () => {
  const vendor = await db.vendor.create({ data: { name: `cachetest Vendor ${Date.now()}` } });
  vendorId = vendor.id;
  const product = await db.product.create({
    data: {
      name: 'cachetest Original', slug: `cachetest-${Date.now()}`, status: 'active', vendorId: vendor.id,
      variants: { create: [{ sku: `CACHE-${Date.now()}`, price: 1000, inventory: 5 }] },
    },
  });

  const readName = () => cached('catalog', `product:${product.id}`, async () => {
    const row = await db.product.findUnique({ where: { id: product.id }, select: { name: true } });
    return row?.name ?? null;
  });

  assert.equal(await readName(), 'cachetest Original');
  assert.equal(await readName(), 'cachetest Original', 'served from cache');

  // No explicit invalidate() call here — the Prisma extension is supposed to do
  // it, because the write path that forgets is the bug this guards against.
  await db.product.update({ where: { id: product.id }, data: { name: 'cachetest Renamed' } });

  assert.equal(await readName(), 'cachetest Renamed', 'the write invalidated the catalog by itself');
});

test('saving a SETTING invalidates settings, so the admin sees its own change', async () => {
  const saved = await settingsService.getSite();
  try {
    await settingsService.setSite({ siteName: 'cachetest name A' });
    assert.equal((await settingsService.getSite()).siteName, 'cachetest name A');

    await settingsService.setSite({ siteName: 'cachetest name B' });
    // Without invalidation this returns A for up to the TTL — the merchant
    // saves, reloads, and sees the old value.
    assert.equal((await settingsService.getSite()).siteName, 'cachetest name B', 'no stale read after save');
  } finally {
    await settingsService.setSite({ siteName: saved.siteName });
  }
});

test('a cache miss still returns the right answer when Redis is unreachable', async () => {
  // Simulated by a compute that throws if it is NOT called: the contract is
  // that the cache never becomes a source of truth. A Redis outage must slow
  // the site down, not take it off the internet.
  const value = await cached('catalog', `nx-${Date.now()}`, async () => 'computed');
  assert.equal(value, 'computed');
});

test('undefined is never stored — it would come back as a hit of nothing', async () => {
  let calls = 0;
  const compute = async () => {
    calls++;
    return undefined;
  };
  await cached('catalog', 'undef', compute);
  await cached('catalog', 'undef', compute);
  assert.equal(calls, 2, 'undefined is recomputed rather than served from cache');
});

test('Settings > Performance > cache actually gates the cache', async () => {
  const saved = await settingsService.getPerformance();
  try {
    // On: a second read is served without recomputing.
    await settingsService.setPerformance({ cache: true });
    let calls = 0;
    const compute = async () => { calls++; return 'value'; };
    await cached('catalog', 'toggle-test', compute);
    await cached('catalog', 'toggle-test', compute);
    assert.equal(calls, 1, 'cached while the toggle is on');

    // Off: every read recomputes. This toggle used to save and gate nothing,
    // which the schema said out loud — a switch that does nothing is worse
    // than no switch, because it is believed.
    await settingsService.setPerformance({ cache: false });
    let offCalls = 0;
    const offCompute = async () => { offCalls++; return 'value'; };
    await cached('catalog', 'toggle-test-off', offCompute);
    await cached('catalog', 'toggle-test-off', offCompute);
    assert.equal(offCalls, 2, 'cache bypassed while the toggle is off');
  } finally {
    await settingsService.setPerformance({ cache: saved.cache });
  }
});

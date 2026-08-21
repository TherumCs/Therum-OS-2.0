import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from './env.js';
import { invalidate, type CacheNamespace } from './cache.js';

// Prisma 7 requires a driver adapter for every database — the old
// datasources-object / bare `new PrismaClient()` construction no longer
// connects at all. Local dev Postgres (docker-compose) has no SSL, so no
// `ssl` option is passed — add one (see Prisma's v7 upgrade guide's SSL
// section) if this ever points at a server that requires it.
const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

const base = new PrismaClient({
  adapter,
  log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

/**
 * Which cache namespace a model's writes invalidate.
 *
 * Invalidation lives HERE, at the write itself, rather than in each service
 * that happens to save a product. Six files already write to the catalog — the
 * product service, two importers, the provider sync, the taxonomy service —
 * and the seventh would be written by someone who did not know a cache
 * existed. That is the classic stale-cache bug: never the caching, always the
 * one write path nobody remembered to hook.
 */
const INVALIDATES: Record<string, CacheNamespace> = {
  Product: 'catalog',
  ProductVariant: 'catalog',
  ProductCategory: 'catalog',
  ProductTag: 'catalog',
  Vendor: 'catalog',
  ProductReview: 'catalog',
  Content: 'content',
  Setting: 'settings',
};

const WRITES = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
]);

// Single cached Prisma client. Explicit dependency, no global leakage.
export const db = base.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const result = await query(args);
        const ns = model ? INVALIDATES[model] : undefined;
        // Awaited, and after the write succeeds: a request that saves and then
        // immediately re-reads must not race its own invalidation and hand
        // itself back the value it just replaced.
        if (ns && WRITES.has(operation)) await invalidate(ns);
        return result;
      },
    },
  },
}) as unknown as PrismaClient;

export async function disconnectDb(): Promise<void> {
  await base.$disconnect();
}

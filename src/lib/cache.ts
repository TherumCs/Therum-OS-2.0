import { redis } from './redis.js';

// A shared object cache, in Redis.
//
// Until now the only caching here was two in-process objects in
// settings.service — which means each PM2 worker kept its own copy, an edit
// applied to one and not the others, and a restart threw the lot away. This is
// the shared one: every worker sees the same entry, and an invalidation is seen
// by all of them at once.
//
// What it is FOR is the reads that happen on every single page view — the site
// settings, the storefront catalog — where the answer is identical for every
// visitor and changes only when someone edits it in the admin.
//
// What it must never hold is anything that differs per visitor. Member pricing
// is the trap: the same product is a different price for a member, so what gets
// cached is the CATALOG ROW, not the priced output. Anything keyed to a session
// or a customer stays out.

/**
 * Bumping this invalidates every entry at once, without SCAN or FLUSH.
 *
 * Raise it when a cached SHAPE changes — a new field on a settings object, a
 * different select on a product — because a deploy that starts reading a field
 * the cached JSON does not have is a bug that only appears on a warm cache and
 * disappears the moment anyone debugs it with a restart.
 */
const SCHEMA_VERSION = 'v1';

/** Namespaces get invalidated as a unit. */
export type CacheNamespace = 'settings' | 'catalog' | 'content';

const NS_KEY = (ns: CacheNamespace): string => `cache:${SCHEMA_VERSION}:ns:${ns}`;

/**
 * Every namespace carries a generation number that is part of the key of
 * everything in it. Invalidating is a single INCR — old entries stop being
 * addressable immediately and expire on their own TTL rather than needing to be
 * hunted down. That matters because SCAN over a large keyspace on every product
 * save is exactly the sort of thing that is fine in development and a stall in
 * production.
 */
async function generation(ns: CacheNamespace): Promise<string> {
  try {
    const g = await redis.get(NS_KEY(ns));
    if (g) return g;
    await redis.set(NS_KEY(ns), '1');
    return '1';
  } catch {
    return '0';
  }
}

/** Drop everything in a namespace. Called on write, not on a timer. */
export async function invalidate(ns: CacheNamespace): Promise<void> {
  try {
    await redis.incr(NS_KEY(ns));
  } catch {
    // A cache that cannot invalidate must not silently serve stale data, but a
    // Redis blip must not fail the write that triggered it either. The TTL
    // below is the backstop: every entry expires on its own regardless.
  }
}

/** Default TTL. Short enough that a missed invalidation self-heals in a minute. */
const DEFAULT_TTL_S = 60;

export interface CacheStats {
  hits: number;
  misses: number;
  errors: number;
}

const stats: CacheStats = { hits: 0, misses: 0, errors: 0 };

export function cacheStats(): CacheStats {
  return { ...stats };
}

export function resetCacheStats(): void {
  stats.hits = 0;
  stats.misses = 0;
  stats.errors = 0;
}

/**
 * Settings > Performance > cache. Read from the settings row, cached in this
 * process for a few seconds so consulting it costs nothing per request — and
 * deliberately NOT read through `cached()` itself, which would be circular.
 *
 * Until now this toggle saved and gated nothing, which the schema said out
 * loud. It gates this.
 */
let enabledCache: { value: boolean; at: number } | null = null;
const ENABLED_TTL_MS = 5_000;

async function cacheEnabled(): Promise<boolean> {
  if (enabledCache && Date.now() - enabledCache.at < ENABLED_TTL_MS) return enabledCache.value;
  try {
    const { db } = await import('./db.js');
    const row = await db.setting.findUnique({ where: { key: 'performance' } });
    const value = (row?.value as { cache?: boolean } | null)?.cache !== false;
    enabledCache = { value, at: Date.now() };
    return value;
  } catch {
    // Never let a settings read failure disable the cache — that would turn a
    // blip into a load spike.
    return true;
  }
}

/** Called when Performance is saved, so the switch takes effect immediately. */
export function forgetCacheEnabled(): void {
  enabledCache = null;
}

/**
 * Read through the cache, computing on a miss.
 *
 * Redis being unavailable is never fatal: on any error this falls through to
 * the real function. A cache outage should slow the site down, not take it off
 * the internet.
 */
export async function cached<T>(
  ns: CacheNamespace,
  key: string,
  compute: () => Promise<T>,
  ttlSeconds: number = DEFAULT_TTL_S,
): Promise<T> {
  if (!(await cacheEnabled())) return compute();

  let full: string | null = null;
  try {
    full = `cache:${SCHEMA_VERSION}:${ns}:${await generation(ns)}:${key}`;
    const hit = await redis.get(full);
    if (hit !== null) {
      stats.hits++;
      return JSON.parse(hit) as T;
    }
    stats.misses++;
  } catch {
    stats.errors++;
    full = null;
  }

  const value = await compute();

  if (full !== null) {
    try {
      // `undefined` does not survive JSON, and a stored "undefined" would come
      // back as a cache HIT of nothing. Those simply are not cached.
      if (value !== undefined) await redis.set(full, JSON.stringify(value), 'EX', ttlSeconds);
    } catch {
      stats.errors++;
    }
  }
  return value;
}

import { Redis } from 'ioredis';
import { env } from './env.js';

// Lazy connect — Phase 1 (Product slice) doesn't need Redis yet, so the server
// boots without it; the connection opens on first use (cache, jobs, sessions).
// NOTE this is NOT the BullMQ connection (queue.ts builds its own from a
// host/port object), so a finite retry + command timeout is safe here and
// wanted: cart/checkout requests must FAIL FAST with a real error when Redis
// is down rather than hang until an upstream timeout (audit M-5). The old
// maxRetriesPerRequest:null queued commands indefinitely.
export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 2,
  connectTimeout: 5000,
  commandTimeout: 5000,
});

export async function disconnectRedis(): Promise<void> {
  if (redis.status === 'ready' || redis.status === 'connecting') {
    // quit() on a connection that raced into a closed state rejects with
    // "Connection is closed." — that's the desired end state, not a failure.
    await redis.quit().catch(() => {});
  }
}

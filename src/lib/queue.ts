import { Queue } from 'bullmq';
import { env } from './env.js';
import { disconnectRedis } from './redis.js';

// BullMQ connection derived from REDIS_URL. Large imports are enqueued here and
// drained by the worker process (src/worker.ts) so the request never blocks.
const url = new URL(env.REDIS_URL);
export const connection = {
  host: url.hostname,
  port: Number(url.port || 6379),
  ...(url.password ? { password: url.password } : {}),
};

export const IMPORT_QUEUE = 'import';

export const importQueue = new Queue(IMPORT_QUEUE, { connection });

// Milieus daily maintenance (M3): expiry sweep + expiring-soon reminders.
// The worker upserts the scheduler at boot; POST /api/milieus/sweep stays as
// the manual trigger.
export const MILIEUS_QUEUE = 'milieus-sweep';

export const milieusQueue = new Queue(MILIEUS_QUEUE, { connection });

// Close every background Redis connection this process may hold: both BullMQ
// queues AND the lazy lib/redis.ts client (first connected by the login rate
// limiter — see rateLimit.ts). Tests MUST call this in after() — any one of
// these left open holds a live Redis socket that keeps the event loop alive
// forever, which presents as "the test run finished but never exited." That
// exact bug cost most of a day, twice: once when milieusQueue was added and
// every test file still closed only importQueue, and again because nothing
// ever closed the rate limiter's lazy client.
export async function closeQueues(): Promise<void> {
  await Promise.all([importQueue.close(), milieusQueue.close(), disconnectRedis()]);
}

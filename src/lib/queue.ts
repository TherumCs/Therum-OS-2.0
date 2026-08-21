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

// Scheduled backups (Settings > Backup). `enabled` + `frequency` both saved
// and were read by nothing — there was no scheduler for them to configure.
// The worker upserts the schedule at boot and again whenever the setting
// changes; POST /api/settings/backup/run stays as the manual trigger.
export const BACKUP_QUEUE = 'backup';

export const backupQueue = new Queue(BACKUP_QUEUE, { connection });

// Hourly catalog sync from connected POD providers (Printful, Printify, …), so
// a product designed on their side appears on the store without anyone clicking
// "Sync". The worker upserts the schedule at boot; the admin sync button stays
// as the manual trigger.
export const CATALOG_SYNC_QUEUE = 'catalog-sync';
export const CATALOG_SYNC_CRON = '0 * * * *'; // top of every hour
export const catalogSyncQueue = new Queue(CATALOG_SYNC_QUEUE, { connection });

// Daily lifecycle sweeps (review requests, abandoned carts). Off-peak.
export const LIFECYCLE_QUEUE = 'lifecycle';
export const LIFECYCLE_CRON = '0 5 * * *'; // daily at 05:00
export const lifecycleQueue = new Queue(LIFECYCLE_QUEUE, { connection });

/** Settings > Backup frequency -> cron. Times are deliberately off-peak. */
export const BACKUP_CRON: Record<string, string> = {
  hourly: '0 * * * *',
  twicedaily: '0 3,15 * * *',
  daily: '0 3 * * *',
  weekly: '0 3 * * 0',
};

// Close every background Redis connection this process may hold: both BullMQ
// queues AND the lazy lib/redis.ts client (first connected by the login rate
// limiter — see rateLimit.ts). Tests MUST call this in after() — any one of
// these left open holds a live Redis socket that keeps the event loop alive
// forever, which presents as "the test run finished but never exited." That
// exact bug cost most of a day, twice: once when milieusQueue was added and
// every test file still closed only importQueue, and again because nothing
// ever closed the rate limiter's lazy client.
export async function closeQueues(): Promise<void> {
  await Promise.all([importQueue.close(), milieusQueue.close(), backupQueue.close(), catalogSyncQueue.close(), lifecycleQueue.close(), disconnectRedis()]);
}

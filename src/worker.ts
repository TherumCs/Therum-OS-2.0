import { Worker } from 'bullmq';
import { BACKUP_CRON, BACKUP_QUEUE, backupQueue, CATALOG_SYNC_CRON, CATALOG_SYNC_QUEUE, catalogSyncQueue, connection, IMPORT_QUEUE, LIFECYCLE_CRON, LIFECYCLE_QUEUE, lifecycleQueue, MILIEUS_QUEUE, milieusQueue } from './lib/queue.js';
import { lifecycleService } from './services/lifecycle.service.js';
import { hookBus } from './lib/hooks.js';
import { importService } from './services/import.service.js';
import { milieuService } from './services/milieu.service.js';
import { backupService } from './services/backup.service.js';
import { notificationService } from './services/notification.service.js';
import { settingsService } from './services/settings.service.js';
import { applyBackupSchedule } from './lib/backupSchedule.js';
import { RunImportInput } from './schemas/import.schema.js';
import { logger } from './lib/logger.js';
import { disconnectDb } from './lib/db.js';
import { installProcessGuards } from './lib/processGuards.js';

// Same crash-guard as the API: a stray rejection in a job must not kill the
// whole worker and drop every other queue with it.
installProcessGuards('worker');

// Drains the import queue. Run: npm run build && node --env-file=.env dist/worker.js
const worker = new Worker(
  IMPORT_QUEUE,
  async (job) => {
    const input = RunImportInput.parse(job.data);
    logger.info({ jobId: job.id, rows: input.rows.length }, 'import job started');
    return importService.run(input);
  },
  { connection, concurrency: 2 },
);

worker.on('completed', (job) => logger.info({ jobId: job.id }, 'import job completed'));
worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'import job failed'));
// Without an 'error' listener an emitted error on the EventEmitter would
// crash the process (audit finding #8).
worker.on('error', (err) => logger.error({ err }, 'import worker error'));

// Milieus daily maintenance (M3): both 1.x sweep timelines + expiring-soon
// reminders, on a scheduler so it survives restarts (same daily cadence as
// 1.x's WP-cron sweep).
const milieusWorker = new Worker(
  MILIEUS_QUEUE,
  async (job) => {
    const sweep = await milieuService.runSweep();
    const reminders = await milieuService.runReminders();
    logger.info({ jobId: job.id, ...sweep, reminders }, 'milieus sweep completed');
    return { ...sweep, reminders };
  },
  { connection, concurrency: 1 },
);
milieusWorker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'milieus sweep failed'));
milieusWorker.on('error', (err) => logger.error({ err }, 'milieus worker error'));

// Upsert (idempotent) — one daily run at 04:00; replaces any prior schedule
// with the same id rather than stacking duplicates. Retries with backoff
// instead of crashing the whole worker if Redis isn't up yet at boot
// (audit finding #8) — the import worker can still drain once Redis returns.
async function ensureSweepSchedule(attempt = 0): Promise<void> {
  try {
    await milieusQueue.upsertJobScheduler('milieus-daily-sweep', { pattern: '0 4 * * *' }, { name: 'sweep' });
    logger.info('milieus daily sweep scheduled');
  } catch (err) {
    const delay = Math.min(60_000, 2 ** attempt * 1000);
    logger.error({ err, retryInMs: delay }, 'milieus sweep scheduling failed; retrying');
    setTimeout(() => void ensureSweepSchedule(attempt + 1), delay);
  }
}
void ensureSweepSchedule();

// The milieus sweep (above) fires onMembershipExpiringSoon per expiring member.
// That hook lives in THIS process, so register the core handler that emails the
// member here — without it the event fires into the void.
hookBus.register('core', 'onMembershipExpiringSoon', (payload) => lifecycleService.onMembershipExpiringSoon(payload as Parameters<typeof lifecycleService.onMembershipExpiringSoon>[0]));

// Daily lifecycle sweeps: post-delivery review requests + abandoned-cart nudges.
const lifecycleWorker = new Worker(
  LIFECYCLE_QUEUE,
  async (job) => {
    const reviews = await lifecycleService.reviewRequestSweep();
    const carts = await lifecycleService.abandonedCartSweep();
    logger.info({ jobId: job.id, reviews, carts }, 'lifecycle sweep completed');
    return { reviews, carts };
  },
  { connection, concurrency: 1 },
);
lifecycleWorker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'lifecycle sweep failed'));
lifecycleWorker.on('error', (err) => logger.error({ err }, 'lifecycle worker error'));

async function ensureLifecycleSchedule(attempt = 0): Promise<void> {
  try {
    await lifecycleQueue.upsertJobScheduler('lifecycle-daily', { pattern: LIFECYCLE_CRON }, { name: 'sweep' });
    logger.info('lifecycle daily sweep scheduled');
  } catch (err) {
    const delay = Math.min(60_000, 2 ** attempt * 1000);
    logger.error({ err, retryInMs: delay }, 'lifecycle sweep scheduling failed; retrying');
    setTimeout(() => void ensureLifecycleSchedule(attempt + 1), delay);
  }
}
void ensureLifecycleSchedule();

// Scheduled backups. Runs the same code path as the manual "Back up now"
// button, so a scheduled backup and a manual one are the same artifact.
const backupWorker = new Worker(
  BACKUP_QUEUE,
  async (job) => {
    const settings = await settingsService.getBackupSettings();
    // Checked at RUN time, not only at schedule time: turning backups off
    // should stop the next run even if the schedule outlives the change.
    if (!settings.enabled) {
      logger.info({ jobId: job.id }, 'scheduled backup skipped — backups disabled');
      return { skipped: true };
    }
    const file = await backupService.runNow();
    // The manual "Back up now" route notifies; a scheduled run is the one you
    // are MORE likely to want told about, since nobody is watching it happen.
    void notificationService.notifyBackupComplete(file.file, file.sizeBytes);
    logger.info({ jobId: job.id, file: file.file, bytes: file.sizeBytes }, 'scheduled backup completed');
    return { file: file.file };
  },
  { connection, concurrency: 1 },
);
backupWorker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'scheduled backup failed'));
backupWorker.on('error', (err) => logger.error({ err }, 'backup worker error'));

// Re-read on every boot so a frequency change picked up by the API is honoured
// here too; upsert replaces the previous schedule rather than stacking.
async function ensureBackupSchedule(attempt = 0): Promise<void> {
  try {
    const r = await applyBackupSchedule();
    logger.info(r, 'backup schedule applied');
  } catch (err) {
    const delay = Math.min(60_000, 2 ** attempt * 1000);
    logger.error({ err, retryInMs: delay }, 'backup scheduling failed; retrying');
    setTimeout(() => void ensureBackupSchedule(attempt + 1), delay);
  }
}
void ensureBackupSchedule();

// Hourly catalog sync. Pulls every CONNECTED provider so a product designed in
// Printful/Printify shows up on the store within the hour, no manual "Sync"
// click. Same code path as the button, per provider, failures isolated so one
// bad provider can't stop the others.
const catalogSyncWorker = new Worker(
  CATALOG_SYNC_QUEUE,
  async (job) => {
    const { catalogSyncService } = await import('./counter/catalogSync.js');
    const providers = await catalogSyncService.providers();
    const results: { id: string; ok: boolean; created?: number; updated?: number; error?: string }[] = [];
    for (const p of providers.filter((x) => x.connected)) {
      try {
        const r = await catalogSyncService.run(p.id);
        results.push({ id: p.id, ok: true, created: r.created, updated: r.updated });
      } catch (err) {
        results.push({ id: p.id, ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
    // Each post-sync cleanup is ISOLATED: a throw in the draft purge must never
    // skip the stale-pending sweep, because that sweep is what releases stock
    // reservations from abandoned checkouts — skip it and a stranded pending
    // order on a 1-in-stock jersey blocks every real buyer until the next run.
    let purged: { deleted: number; names: string[] } = { deleted: 0, names: [] };
    try {
      // Vendors create-as-draft then publish; a failed publish leaves the draft
      // stuck on our storefront. Manual drafts (no sourceId) are untouched.
      const { productService } = await import('./services/product.service.js');
      purged = await productService.purgeStaleVendorDrafts();
    } catch (err) { logger.error({ err }, 'stale vendor-draft purge failed (non-fatal)'); }

    let sweep: { failed: string[]; chargedStuck: string[] } = { failed: [], chargedStuck: [] };
    try {
      const { orderService } = await import('./services/order.service.js');
      sweep = await orderService.sweepStalePending();
      if (sweep.chargedStuck.length > 0) logger.error({ orders: sweep.chargedStuck }, 'CHARGED orders stuck in pending — investigate now');
    } catch (err) { logger.error({ err }, 'stale-pending sweep failed (non-fatal)'); }

    logger.info({ jobId: job.id, results, purgedDrafts: purged.deleted, purgedNames: purged.names, sweptPending: sweep.failed }, 'scheduled catalog sync');
    return { results, purged, sweep };
  },
  { connection, concurrency: 1 },
);
catalogSyncWorker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'scheduled catalog sync failed'));
catalogSyncWorker.on('error', (err) => logger.error({ err }, 'catalog sync worker error'));

async function ensureCatalogSyncSchedule(attempt = 0): Promise<void> {
  try {
    await catalogSyncQueue.upsertJobScheduler('catalog-sync-hourly', { pattern: CATALOG_SYNC_CRON }, { name: 'sync' });
    logger.info({ pattern: CATALOG_SYNC_CRON }, 'catalog sync schedule applied');
  } catch (err) {
    const delay = Math.min(60_000, 2 ** attempt * 1000);
    logger.error({ err, retryInMs: delay }, 'catalog sync scheduling failed; retrying');
    setTimeout(() => void ensureCatalogSyncSchedule(attempt + 1), delay);
  }
}
void ensureCatalogSyncSchedule();

logger.info('import worker started');

const shutdown = async (): Promise<void> => {
  // backupWorker was missing here — a SIGTERM mid-backup killed it ungracefully
  // instead of letting the running job finish and close its connection.
  await Promise.all([worker.close(), milieusWorker.close(), backupWorker.close(), catalogSyncWorker.close(), lifecycleWorker.close()]);
  await disconnectDb();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

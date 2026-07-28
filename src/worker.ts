import { Worker } from 'bullmq';
import { BACKUP_CRON, BACKUP_QUEUE, backupQueue, connection, IMPORT_QUEUE, MILIEUS_QUEUE, milieusQueue } from './lib/queue.js';
import { importService } from './services/import.service.js';
import { milieuService } from './services/milieu.service.js';
import { backupService } from './services/backup.service.js';
import { notificationService } from './services/notification.service.js';
import { settingsService } from './services/settings.service.js';
import { applyBackupSchedule } from './lib/backupSchedule.js';
import { RunImportInput } from './schemas/import.schema.js';
import { logger } from './lib/logger.js';
import { disconnectDb } from './lib/db.js';

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

logger.info('import worker started');

const shutdown = async (): Promise<void> => {
  await worker.close();
  await milieusWorker.close();
  await disconnectDb();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

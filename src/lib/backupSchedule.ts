import { BACKUP_CRON, backupQueue } from './queue.js';
import { settingsService } from '../services/settings.service.js';

// One definition of "what the backup schedule should be", used by BOTH the
// worker at boot and the settings route when the value changes. Keeping it in
// two places is how a scheduler ends up disagreeing with its own setting.
export async function applyBackupSchedule(): Promise<{ scheduled: boolean; pattern?: string }> {
  const settings = await settingsService.getBackupSettings();
  if (!settings.enabled) {
    await backupQueue.removeJobScheduler('backup-scheduled').catch(() => {});
    return { scheduled: false };
  }
  const pattern = BACKUP_CRON[settings.frequency] ?? BACKUP_CRON.daily!;
  await backupQueue.upsertJobScheduler('backup-scheduled', { pattern }, { name: 'backup' });
  return { scheduled: true, pattern };
}

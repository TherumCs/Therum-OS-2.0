import { apiGet } from '../../../../lib/api';
import { ActionButton, Field, SelectField, TextInput, Toggle } from '../SettingsControls';

export const dynamic = 'force-dynamic';

interface BackupSettings {
  enabled: boolean;
  frequency: 'hourly' | 'twicedaily' | 'daily' | 'weekly';
  destination: 'local' | 's3';
  s3Bucket: string;
  s3Region: string;
  s3AccessKey: string;
  s3SecretKey: string;
  s3Endpoint: string;
  s3Prefix: string;
}
const DEFAULTS: BackupSettings = {
  enabled: false,
  frequency: 'daily',
  destination: 'local',
  s3Bucket: '',
  s3Region: 'us-east-1',
  s3AccessKey: '',
  s3SecretKey: '',
  s3Endpoint: '',
  s3Prefix: 'therum-backups',
};
interface BackupFile {
  file: string;
  sizeBytes: number;
  createdAt: string;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Schedule/destination fields are real and saved. "Backup now" runs a real
// pg_dump — if pg_dump isn't installed in this environment, it reports that
// honestly rather than claiming success. The scheduled cron trigger that
// would run this automatically isn't wired up yet — a real gap, not hidden.
export default async function BackupSettingsPage() {
  const backup = await apiGet<BackupSettings>('/api/settings/backup').catch(() => DEFAULTS);
  const files = await apiGet<BackupFile[]>('/api/settings/backup/files').catch((): BackupFile[] => []);

  return (
    <div>
      <h2 style={{ marginTop: 0, fontSize: 'var(--th-fs-lg)' }}>Backup</h2>
      <p className="muted" style={{ marginTop: -8 }}>
        Schedule + restore.
      </p>

      <div className="settings-group">
        <h3 className="settings-group-title">Schedule</h3>
        <div className="settings-toggle-row" style={{ maxWidth: 480 }}>
          <span className="settings-toggle-row-label">Enable scheduled backups</span>
          <Toggle domain="backup" field="enabled" initial={backup.enabled} />
        </div>
        <Field label="Frequency">
          <SelectField
            domain="backup"
            field="frequency"
            initial={backup.frequency}
            options={[
              ['hourly', 'Every hour'],
              ['twicedaily', 'Twice daily'],
              ['daily', 'Daily'],
              ['weekly', 'Weekly'],
            ]}
          />
        </Field>
        <p className="field-help" style={{ maxWidth: 480 }}>
          The scheduled trigger that would actually run this automatically isn&apos;t wired up yet — this saves the preference, but nothing runs on
          a timer until that lands.
        </p>
      </div>

      <div className="settings-group">
        <h3 className="settings-group-title">Run on demand</h3>
        <ActionButton label="Backup now" endpoint="/api/settings/backup/run" successMessage="Backup complete." />
      </div>

      <div className="settings-group">
        <h3 className="settings-group-title">Destination</h3>
        <Field label="Backup destination">
          <SelectField
            domain="backup"
            field="destination"
            initial={backup.destination}
            options={[
              ['local', 'Local only'],
              ['s3', 'Local + S3'],
            ]}
          />
        </Field>
        {backup.destination === 's3' && (
          <>
            <Field label="Bucket">
              <TextInput domain="backup" field="s3Bucket" initial={backup.s3Bucket} />
            </Field>
            <Field label="Region">
              <TextInput domain="backup" field="s3Region" initial={backup.s3Region} />
            </Field>
            <Field label="Access key">
              <TextInput domain="backup" field="s3AccessKey" initial={backup.s3AccessKey} />
            </Field>
            <Field label="Secret key">
              <TextInput domain="backup" field="s3SecretKey" initial={backup.s3SecretKey} type="password" />
            </Field>
            <Field label="Endpoint (optional)">
              <TextInput domain="backup" field="s3Endpoint" initial={backup.s3Endpoint} />
            </Field>
            <Field label="Path prefix">
              <TextInput domain="backup" field="s3Prefix" initial={backup.s3Prefix} />
            </Field>
            <p className="field-help" style={{ maxWidth: 480 }}>
              Uploads on every &ldquo;Backup now&rdquo; run once a bucket + access key + secret key are all set — the local .zip is kept either way,
              so a failed S3 upload never loses the backup that just succeeded.
            </p>
          </>
        )}
      </div>

      {files.length > 0 && (
        <div className="settings-group">
          <h3 className="settings-group-title">Recent backups</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--th-fs-sm)', maxWidth: 560 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--th-line)' }}>
                <th style={{ padding: 'var(--th-space-6)', color: 'var(--th-muted)', fontSize: 'var(--th-fs-2xs)', textTransform: 'uppercase' }}>File</th>
                <th style={{ padding: 'var(--th-space-6)', color: 'var(--th-muted)', fontSize: 'var(--th-fs-2xs)', textTransform: 'uppercase' }}>Size</th>
                <th style={{ padding: 'var(--th-space-6)', color: 'var(--th-muted)', fontSize: 'var(--th-fs-2xs)', textTransform: 'uppercase' }}>When</th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.file} style={{ borderBottom: '1px solid var(--th-line)' }}>
                  <td style={{ padding: 'var(--th-space-6)', fontFamily: 'var(--th-font-mono)', fontSize: 'var(--th-fs-xs)' }}>{f.file}</td>
                  <td style={{ padding: 'var(--th-space-6)' }}>{fmtSize(f.sizeBytes)}</td>
                  <td style={{ padding: 'var(--th-space-6)', color: 'var(--th-muted)' }}>{new Date(f.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="settings-group">
        <h3 className="settings-group-title">Database</h3>
        <p className="settings-group-desc">PostgreSQL, not 1.9.44&apos;s single-file SQLite — restore is a real pg_restore against a dump file, not a file copy.</p>
      </div>
    </div>
  );
}

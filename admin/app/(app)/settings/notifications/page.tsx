import { apiGet } from '../../../../lib/api';
import { ActionButton, Field, NumberInput, TextInput, Toggle } from '../SettingsControls';

export const dynamic = 'force-dynamic';

interface Notifications {
  adminEmail: string;
  emailEnabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword: string;
  smtpFrom: string;
  slackWebhook: string;
  notifyOnLogin: boolean;
  notifyOnUpdate: boolean;
  notifyOnBackup: boolean;
}
const DEFAULTS: Notifications = {
  adminEmail: '',
  emailEnabled: true,
  smtpHost: '',
  smtpPort: 587,
  smtpUser: '',
  smtpPassword: '',
  smtpFrom: '',
  slackWebhook: '',
  notifyOnLogin: false,
  notifyOnUpdate: true,
  notifyOnBackup: false,
};

function ToggleRow({ label, domain, field, initial }: { label: string; domain: string; field: string; initial: boolean }) {
  return (
    <div className="settings-toggle-row">
      <div className="settings-toggle-row-text">
        <span className="settings-toggle-row-label">{label}</span>
      </div>
      <Toggle domain={domain} field={field} initial={initial} />
    </div>
  );
}

export default async function NotificationsSettingsPage() {
  const n = await apiGet<Notifications>('/api/settings/notifications').catch(() => DEFAULTS);

  return (
    <div>
      <h2 style={{ marginTop: 0, fontSize: 'var(--th-fs-lg)' }}>Notifications</h2>
      <p className="muted" style={{ marginTop: -8 }}>
        Email, Slack, webhooks.
      </p>

      <div className="settings-group">
        <h3 className="settings-group-title">Email</h3>
        <Field label="Admin email" help="Where login/backup notifications are sent.">
          <TextInput domain="notifications" field="adminEmail" initial={n.adminEmail} type="email" placeholder="you@example.com" />
        </Field>
        <div className="settings-toggle-row" style={{ maxWidth: 480 }}>
          <span className="settings-toggle-row-label">Email enabled</span>
          <Toggle domain="notifications" field="emailEnabled" initial={n.emailEnabled} />
        </div>
        <Field label="SMTP host" help="Required to actually send email — without one, only Slack (if configured) fires.">
          <TextInput domain="notifications" field="smtpHost" initial={n.smtpHost} placeholder="smtp.example.com" />
        </Field>
        <Field label="SMTP port">
          <NumberInput domain="notifications" field="smtpPort" initial={n.smtpPort} />
        </Field>
        <Field label="SMTP username">
          <TextInput domain="notifications" field="smtpUser" initial={n.smtpUser} />
        </Field>
        <Field label="SMTP password">
          <TextInput domain="notifications" field="smtpPassword" initial={n.smtpPassword} type="password" />
        </Field>
        <Field label="From address" help="Defaults to the SMTP username if left blank.">
          <TextInput domain="notifications" field="smtpFrom" initial={n.smtpFrom} placeholder="therum-cms@yourdomain.com" />
        </Field>
      </div>

      <div className="settings-group">
        <h3 className="settings-group-title">Slack</h3>
        <Field label="Webhook URL">
          <TextInput domain="notifications" field="slackWebhook" initial={n.slackWebhook} type="url" placeholder="https://hooks.slack.com/…" />
        </Field>
      </div>

      <div className="settings-group">
        <h3 className="settings-group-title">Triggers</h3>
        <ToggleRow label="New admin login" domain="notifications" field="notifyOnLogin" initial={n.notifyOnLogin} />
        <ToggleRow label="Application updates" domain="notifications" field="notifyOnUpdate" initial={n.notifyOnUpdate} />
        <p className="field-help" style={{ marginTop: -8, maxWidth: 480 }}>
          Saves, but has nothing to trigger it yet — there&apos;s no self-update/auto-update feature anywhere in 2.0 today.
        </p>
        <ToggleRow label="Backup completed" domain="notifications" field="notifyOnBackup" initial={n.notifyOnBackup} />
      </div>

      <div className="settings-group">
        <h3 className="settings-group-title">Test</h3>
        <ActionButton label="Send test notification" endpoint="/api/settings/notifications/test" successMessage="Test sent. Check inbox/Slack." />
      </div>
    </div>
  );
}

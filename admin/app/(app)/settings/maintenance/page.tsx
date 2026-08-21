import { apiGet } from '../../../../lib/api';
import { TextInput, SelectField, NumberInput } from '../SettingsControls';

export const dynamic = 'force-dynamic';

interface Maintenance {
  mode: 'off' | 'maintenance' | 'coming-soon';
  heading: string;
  message: string;
  buttonLabel: string;
  buttonHref: string;
  backgroundImage: string;
  retryAfterMinutes: number;
}

const DEFAULTS: Maintenance = {
  mode: 'off',
  heading: 'We will be back shortly',
  message: 'The site is down for scheduled maintenance. Thanks for your patience.',
  buttonLabel: '',
  buttonHref: '',
  backgroundImage: '',
  retryAfterMinutes: 60,
};

// Built into Therum OS rather than being a page an editor publishes: a
// maintenance screen stored as ordinary content is one that can be unpublished
// by accident, and one that cannot cover routes the CMS doesn't own.
export default async function MaintenanceSettingsPage() {
  const m = await apiGet<Maintenance>('/api/settings/maintenance').catch((): Maintenance => DEFAULTS);
  const live = m.mode !== 'off';

  return (
    <div>
      <h2 style={{ marginTop: 0, fontSize: 'var(--th-fs-lg)' }}>Maintenance &amp; coming soon</h2>
      <p className="muted" style={{ marginTop: -8 }}>
        Put the public site behind a holding page. The admin, the API and the store bridges stay reachable.
      </p>

      {live && (
        <div
          style={{
            background: 'var(--th-warning-bg)',
            color: 'var(--th-warning-text)',
            border: '1px solid var(--th-line)',
            borderRadius: 'var(--th-ctl-r)',
            padding: 'var(--th-space-8) var(--th-space-12)',
            margin: 'var(--th-space-16) 0',
            fontSize: 'var(--th-fs-sm)',
          }}
        >
          <strong>The public site is currently hidden</strong> — visitors see the{' '}
          {m.mode === 'maintenance' ? 'maintenance' : 'coming soon'} page. You still see the real site while signed in.
        </div>
      )}

      <div className="settings-group" style={{ maxWidth: 620 }}>
        <h3 className="settings-group-title">Mode</h3>
        <p className="settings-group-desc">
          <strong>Maintenance</strong> answers 503 with a Retry-After, so search engines keep your existing pages and
          come back. <strong>Coming soon</strong> answers 200, because that page <em>is</em> the site until you launch —
          serving a 503 there would tell crawlers your site is broken.
        </p>
        <div className="settings-toggle-row">
          <div className="settings-toggle-row-text">
            <span className="settings-toggle-row-label">Site visibility</span>
            <span className="settings-toggle-row-desc">Off means the site is public as normal.</span>
          </div>
          <SelectField
            domain="maintenance"
            field="mode"
            initial={m.mode}
            options={[
              ['off', 'Live (public)'],
              ['maintenance', 'Maintenance (503)'],
              ['coming-soon', 'Coming soon (200)'],
            ]}
          />
        </div>
      </div>

      <div className="settings-group" style={{ maxWidth: 620 }}>
        <h3 className="settings-group-title">What visitors see</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--th-space-12)' }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--th-muted)' }}>
            Heading
            <TextInput domain="maintenance" field="heading" initial={m.heading} />
          </label>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--th-muted)' }}>
            Message
            <TextInput domain="maintenance" field="message" initial={m.message} />
          </label>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--th-muted)' }}>
            Button label (optional)
            <TextInput domain="maintenance" field="buttonLabel" initial={m.buttonLabel} />
          </label>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--th-muted)' }}>
            Button link
            <TextInput domain="maintenance" field="buttonHref" initial={m.buttonHref} />
          </label>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--th-muted)' }}>
            Background image URL (optional)
            <TextInput domain="maintenance" field="backgroundImage" initial={m.backgroundImage} />
          </label>
          <div className="settings-toggle-row">
            <div className="settings-toggle-row-text">
              <span className="settings-toggle-row-label">Retry-After (minutes)</span>
              <span className="settings-toggle-row-desc">
                Maintenance mode only. Tells crawlers when to come back; 0 omits the header.
              </span>
            </div>
            <NumberInput domain="maintenance" field="retryAfterMinutes" initial={m.retryAfterMinutes} />
          </div>
        </div>
      </div>
    </div>
  );
}

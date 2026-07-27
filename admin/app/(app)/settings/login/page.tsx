import { apiGet } from '../../../../lib/api';
import { DEFAULT_LOGIN_BRANDING, type LoginBranding } from '../../../../lib/loginBranding';
import { Field, SelectField, TextInput, Toggle } from '../SettingsControls';

export const dynamic = 'force-dynamic';

export default async function LoginSettingsPage() {
  const login = await apiGet<LoginBranding>('/api/settings/login-branding').catch(() => DEFAULT_LOGIN_BRANDING);

  return (
    <div>
      <h2 style={{ marginTop: 0, fontSize: 'var(--th-fs-lg)' }}>Login</h2>
      <p className="muted" style={{ marginTop: -8 }}>
        Login screen background and branding.
      </p>

      <div className="settings-group">
        <h3 className="settings-group-title">Background</h3>
        <p className="settings-group-desc">What sits behind the login card. Match the active theme, pick a solid color, or link your own image or video.</p>
        <Field label="Source" help="Where the login background comes from.">
          <SelectField
            domain="login-branding"
            field="bgType"
            initial={login.bgType}
            options={[
              ['theme', 'Match active theme'],
              ['solid', 'Solid color'],
              ['image', 'Custom image'],
              ['video', 'Custom video'],
            ]}
          />
        </Field>
        <Field label="Solid color" help='Used when source is "Solid color".'>
          <TextInput domain="login-branding" field="bgColor" initial={login.bgColor} type="color" />
        </Field>
        <Field label="Image URL" help="JPG, PNG, or WebP. Recommended 2560×1440 or larger.">
          <TextInput domain="login-branding" field="bgImage" initial={login.bgImage} placeholder="https://…/login-bg.jpg" />
        </Field>
        <Field label="Video URL" help="MP4 or WebM. Plays muted on loop. Keep it under 5MB.">
          <TextInput domain="login-branding" field="bgVideo" initial={login.bgVideo} placeholder="https://…/login-bg.mp4" />
        </Field>
        <div className="settings-toggle-row" style={{ border: 'none', maxWidth: 480 }}>
          <div className="settings-toggle-row-text">
            <span className="settings-toggle-row-label">Darken overlay</span>
            <span className="settings-toggle-row-desc">Adds a soft vignette behind the card so text stays readable on busy backgrounds.</span>
          </div>
          <Toggle domain="login-branding" field="bgOverlay" initial={login.bgOverlay} />
        </div>
      </div>

      <div className="settings-group">
        <h3 className="settings-group-title">Copy</h3>
        <p className="settings-group-desc">Override the welcome heading shown on the login form.</p>
        <Field label="Heading">
          <TextInput domain="login-branding" field="heading" initial={login.heading} />
        </Field>
        <Field label="Subhead">
          <TextInput domain="login-branding" field="subhead" initial={login.subhead} />
        </Field>
      </div>

      <div className="settings-group">
        <h3 className="settings-group-title">Footer</h3>
        <p className="settings-group-desc">What appears at the bottom of the login screen.</p>
        <div className="settings-toggle-row" style={{ border: 'none', maxWidth: 480 }}>
          <div className="settings-toggle-row-text">
            <span className="settings-toggle-row-label">Show version stamp</span>
            <span className="settings-toggle-row-desc">Displays &ldquo;Therum CMS · v2.0.0&rdquo; at the bottom.</span>
          </div>
          <Toggle domain="login-branding" field="showVersion" initial={login.showVersion} />
        </div>
      </div>
    </div>
  );
}

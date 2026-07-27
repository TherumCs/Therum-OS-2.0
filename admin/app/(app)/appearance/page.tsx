import { apiGet } from '../../../lib/api';
import { BASE_PATH } from '../../../lib/session';
import { DEFAULT_APPEARANCE, type Appearance } from '../../../lib/appearance';

export const dynamic = 'force-dynamic';

function RadioGroup({ name, options, value }: { name: string; options: [string, string][]; value: string }) {
  return (
    <div className="settings-radio-group">
      {options.map(([v, label]) => (
        <label key={v} className="settings-radio">
          <input type="radio" name={name} value={v} defaultChecked={v === value} />
          {label}
        </label>
      ))}
    </div>
  );
}

// Separate top-level surface, not nested under Settings — matches 1.9.44,
// where Appearance/Customization is its own admin page, not one of the 16
// Settings sections (confirmed: therum-admin.php:5081-5083 explicitly routes
// it to admin.php?page=therum-customization instead).
export default async function AppearancePage() {
  let appearance: Appearance;
  let err: string | null = null;
  try {
    appearance = await apiGet<Appearance>('/api/settings/appearance');
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
    appearance = DEFAULT_APPEARANCE;
  }

  return (
    <div>
      <h1>Appearance</h1>
      <p className="muted" style={{ marginTop: -8 }}>
        Applies across the admin — the sign-in screen keeps its own look. These same 5 fields, plus
        everything else Quick Controls covers, now live in the panel opened from the topbar — this page
        still works but is a subset of that.
      </p>
      {err && <div className="notice">API offline ({err})</div>}
      <form action={`${BASE_PATH}/api/settings/appearance`} method="post" className="settings-form">
        <div className="settings-field">
          <div className="field-label">Density</div>
          <RadioGroup name="density" value={appearance.density} options={[['compact', 'Compact'], ['comfortable', 'Comfortable'], ['breathing', 'Breathing room']]} />
        </div>
        <div className="settings-field">
          <div className="field-label">Sidebar style</div>
          <RadioGroup name="sidebarStyle" value={appearance.sidebarStyle} options={[['default', 'Default'], ['pills', 'Pills'], ['minimal', 'Minimal']]} />
        </div>
        <div className="settings-field">
          <div className="field-label">Card style</div>
          <RadioGroup name="cardStyle" value={appearance.cardStyle} options={[['flat', 'Flat'], ['shadow', 'Shadow'], ['glass', 'Glass']]} />
        </div>
        <div className="settings-field">
          <div className="field-label">Color mode</div>
          <RadioGroup name="colorMode" value={appearance.colorMode} options={[['light', 'Light'], ['dark', 'Dark'], ['system', 'Match system']]} />
        </div>
        <div className="settings-field">
          <div className="field-label">Contrast</div>
          <RadioGroup name="contrast" value={appearance.contrast} options={[['normal', 'Normal'], ['high', 'High contrast']]} />
        </div>
        <button type="submit">Save appearance</button>
      </form>
    </div>
  );
}

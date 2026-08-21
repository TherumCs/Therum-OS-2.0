import { apiGet } from '../../../../lib/api';
import { Field, SelectField } from '../SettingsControls';

export const dynamic = 'force-dynamic';

interface AdminDock {
  position: 'bottom' | 'top';
  defaultMode: 'scroll' | 'always' | 'drawer';
  mobileStyle: 'fab' | 'none';
}

// The dock itself (a bottom/top toolbar for logged-in editors on the public
// front-end) isn't built in 2.0 yet — these are the settings it will read
// once it exists, matching th_dock_position/th_dock_default_mode/th_dock_mobile.
export default async function AdminDockSettingsPage() {
  const dock = await apiGet<AdminDock>('/api/settings/admin-dock').catch(
    (): AdminDock => ({ position: 'bottom', defaultMode: 'scroll', mobileStyle: 'fab' }),
  );

  return (
    <div>
      <h2 style={{ marginTop: 0, fontSize: 'var(--th-fs-lg)' }}>Admin Dock</h2>
      <p className="muted" style={{ marginTop: -8 }}>
        Position, default mode, and mobile behaviour of the frontend admin dock.
      </p>

      <div className="settings-group">
        <h3 className="settings-group-title">Dock position</h3>
        <p className="settings-group-desc">Where the admin dock appears for logged-in editors on the frontend.</p>
        <Field label="Desktop &amp; tablet position" help="Bottom mirrors a macOS dock. Top matches the classic WordPress toolbar.">
          <SelectField
            domain="admin-dock"
            field="position"
            initial={dock.position}
            options={[
              ['bottom', 'Bottom (default)'],
              ['top', 'Top bar'],
            ]}
          />
        </Field>
        <Field label="Default mode" help="Applied on first visit before the user makes a personal choice. Their pick persists in localStorage.">
          <SelectField
            domain="admin-dock"
            field="defaultMode"
            initial={dock.defaultMode}
            options={[
              ['scroll', 'Scroll-aware (default)'],
              ['always', 'Always on'],
              ['drawer', 'Drawer'],
            ]}
          />
        </Field>
      </div>

      <div className="settings-group">
        <h3 className="settings-group-title">Mobile</h3>
        <p className="settings-group-desc">On screens narrower than 768px the full dock is replaced.</p>
        <Field
          label="Mobile style"
          help="FAB shows a circular floating button at bottom-right that expands to admin actions. None hides the dock entirely on mobile."
        >
          <SelectField
            domain="admin-dock"
            field="mobileStyle"
            initial={dock.mobileStyle}
            options={[
              ['fab', 'FAB — floating action button (default)'],
              ['none', 'Hidden on mobile'],
            ]}
          />
        </Field>
      </div>

      <div className="settings-group">
        <h3 className="settings-group-title">Note</h3>
        <p className="settings-group-desc">
          These are site-wide defaults. Each logged-in user will be able to override mode and focus via the dock itself once it&apos;s built —
          their choice stored in localStorage per device.
        </p>
      </div>
    </div>
  );
}

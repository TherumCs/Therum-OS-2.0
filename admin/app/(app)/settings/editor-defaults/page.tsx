import { apiGet } from '../../../../lib/api';
import { Toggle } from '../SettingsControls';

export const dynamic = 'force-dynamic';

interface EditorDefaults {
  distractionFree: boolean;
}

// 1.9.44's Bricks-vs-Classic-editor choice has no equivalent here — 2.0 has
// one unified content builder, not two competing editors to pick a default
// between. Distraction-free mode is the one real preference that survives
// the port as-is.
export default async function EditorDefaultsSettingsPage() {
  const editor = await apiGet<EditorDefaults>('/api/settings/editor-defaults').catch((): EditorDefaults => ({ distractionFree: false }));

  return (
    <div>
      <h2 style={{ marginTop: 0, fontSize: 'var(--th-fs-lg)' }}>Editor Defaults</h2>
      <p className="muted" style={{ marginTop: -8 }}>
        Content builder preferences.
      </p>

      <div className="settings-group">
        <h3 className="settings-group-title">Editor preferences</h3>
        <p className="settings-group-desc">
          1.9.44 chose here between Bricks Builder and the WordPress classic editor — this stack has one unified content builder, so there&apos;s
          no editor to pick a default for. Distraction-free mode is the one preference that still applies.
        </p>
        <div className="settings-toggle-row" style={{ maxWidth: 480 }}>
          <div className="settings-toggle-row-text">
            <span className="settings-toggle-row-label">Distraction-free mode</span>
            <span className="settings-toggle-row-desc">Hides secondary chrome while writing.</span>
          </div>
          <Toggle domain="editor-defaults" field="distractionFree" initial={editor.distractionFree} />
        </div>
      </div>
    </div>
  );
}

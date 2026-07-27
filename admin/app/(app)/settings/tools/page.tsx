import { FindReplaceTool } from './ToolsClient';

export const dynamic = 'force-dynamic';

// Find & Replace is real (searches/replaces in page/post titles + excerpts).
// DB cleanup and broken-link checker are follow-ups — genuinely separate
// pieces of work (a maintenance-task runner; an external-link crawler),
// not stubbed with fake buttons here.
export default function ToolsSettingsPage() {
  return (
    <div>
      <h2 style={{ marginTop: 0, fontSize: 'var(--th-fs-lg)' }}>Tools</h2>
      <p className="muted" style={{ marginTop: -8 }}>
        Find &amp; replace, DB cleanup, link checker.
      </p>

      <div className="settings-group">
        <h3 className="settings-group-title">Find &amp; replace</h3>
        <p className="settings-group-desc">Searches page/post titles and excerpts — not the content builder canvas body yet.</p>
        <FindReplaceTool />
      </div>

      <div className="settings-group">
        <h3 className="settings-group-title">Database optimizer</h3>
        <p className="settings-group-desc">Not built yet — tracked as a follow-up.</p>
      </div>

      <div className="settings-group">
        <h3 className="settings-group-title">Broken link checker</h3>
        <p className="settings-group-desc">Not built yet — tracked as a follow-up.</p>
      </div>
    </div>
  );
}

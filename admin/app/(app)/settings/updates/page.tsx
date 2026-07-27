import { apiGet } from '../../../../lib/api';

export const dynamic = 'force-dynamic';

interface About {
  version: string;
  node: string;
  database: string;
  env: string;
}

// 1.9.44's WordPress core/plugin/theme auto-update toggles have no
// equivalent — this stack has no WordPress core and no plugin ecosystem to
// auto-update. What's real here is just the current versions.
export default async function UpdatesSettingsPage() {
  const about = await apiGet<About>('/api/system/about').catch((): About => ({ version: '2.0.0', node: process.version, database: 'PostgreSQL', env: 'development' }));

  return (
    <div>
      <h2 style={{ marginTop: 0, fontSize: 'var(--th-fs-lg)' }}>Updates</h2>
      <p className="muted" style={{ marginTop: -8 }}>
        Versions and update behaviour.
      </p>

      <div className="settings-group">
        <h3 className="settings-group-title">Versions</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, maxWidth: 560 }}>
          <div>
            <span className="muted" style={{ fontSize: 'var(--th-fs-2xs)', textTransform: 'uppercase', display: 'block' }}>
              Therum CMS
            </span>
            <strong>v{about.version}</strong>
          </div>
          <div>
            <span className="muted" style={{ fontSize: 'var(--th-fs-2xs)', textTransform: 'uppercase', display: 'block' }}>
              Node
            </span>
            <strong>{about.node}</strong>
          </div>
          <div>
            <span className="muted" style={{ fontSize: 'var(--th-fs-2xs)', textTransform: 'uppercase', display: 'block' }}>
              Database
            </span>
            <strong>{about.database}</strong>
          </div>
        </div>
      </div>

      <div className="settings-group">
        <h3 className="settings-group-title">How updates work here</h3>
        <p className="settings-group-desc">
          1.9.44 offered auto-update toggles for WordPress core, plugins, and themes — none of that exists in this stack. Therum CMS updates by
          deploying a new build (git pull + restart), not through an in-admin updater. There&apos;s nothing to toggle here yet.
        </p>
      </div>
    </div>
  );
}

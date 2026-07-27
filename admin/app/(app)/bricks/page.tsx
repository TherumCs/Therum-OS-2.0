import { apiGet } from '../../../lib/api';
import { installBricksZip, toggleBricksAddon, removeBricksAddon } from '../../actions';

export const dynamic = 'force-dynamic';

interface Component {
  id: string;
  slug: string;
  kind: 'core' | 'addon';
  title: string;
  version: string;
  description: string;
  author: string;
  uri: string;
  enabled: boolean;
  files: number;
  bytes: number;
  phpFiles: number;
  assets: { css: number; js: number };
  installedAt: string;
}

interface Status {
  core: Component | null;
  addons: Component[];
  nativeRenderer: boolean;
}

const fmtBytes = (n: number): string => {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
};

const fmtDate = (iso: string): string =>
  iso ? new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '';

function ComponentCard({ c }: { c: Component }): React.ReactElement {
  return (
    <div className="card" style={{ borderTop: '3px solid ' + (c.enabled ? 'var(--th-accent)' : 'var(--th-line)') }}>
      <div className="row-between">
        <strong>{c.title}</strong>
        <span className={'pill pill-' + (c.enabled ? 'ok' : 'archived')}>{c.enabled ? 'active' : 'off'}</span>
      </div>
      <div className="muted" style={{ margin: 'var(--th-space-6) 0 var(--th-space-10)' }}>
        {c.description || <em>No description provided.</em>}
      </div>
      <div className="muted" style={{ fontSize: 12, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <span>v{c.version}</span>
        {c.author && <span>· {c.author}</span>}
        <span>· {c.files.toLocaleString()} files</span>
        <span>· {fmtBytes(c.bytes)}</span>
        <span>· {c.assets.css} CSS / {c.assets.js} JS</span>
        {c.installedAt && <span>· installed {fmtDate(c.installedAt)}</span>}
      </div>
      {c.phpFiles > 0 && (
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          {c.phpFiles.toLocaleString()} PHP files stored but never executed — Therum OS renders Bricks natively.
        </div>
      )}
      <div className="actions" style={{ marginTop: 'var(--th-space-10)' }}>
        <form action={toggleBricksAddon.bind(null, c.slug, !c.enabled)}>
          <button className={c.enabled ? 'ghost' : ''} style={{ fontSize: 11 }}>
            {c.enabled ? 'Deactivate' : 'Activate'}
          </button>
        </form>
        <form action={removeBricksAddon.bind(null, c.slug)}>
          <button className="ghost" style={{ fontSize: 11 }}>Remove</button>
        </form>
        {c.uri && (
          <a className="ghost button" href={c.uri} target="_blank" rel="noreferrer" style={{ fontSize: 11 }}>
            Website
          </a>
        )}
      </div>
    </div>
  );
}

export default async function BricksBridgePage(): Promise<React.ReactElement> {
  let status: Status | null = null;
  let err = '';
  try {
    status = await apiGet<Status>('/api/bricks/status');
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }

  const addons = status?.addons ?? [];

  return (
    <section>
      <h1>Bricks Bridge</h1>
      <p className="muted">
        Run Bricks without WordPress. Therum OS speaks the Bricks element format natively — imported designs
        become real, Builder-editable pages, and any page can be exported back to Bricks template JSON.
        Install the Bricks theme and its addons here as <code>.zip</code> archives.
      </p>

      {err && <div className="notice">API offline ({err})</div>}

      <div
        className="notice row-between"
        style={{ background: 'var(--th-success-bg)', color: 'var(--th-success-text)' }}
      >
        <span>
          Native Bricks renderer: <strong>active</strong> — no WordPress in the render path.
        </span>
      </div>

      <h2 style={{ fontSize: 16, margin: 'var(--th-space-4) 0 var(--th-space-4)' }}>Install</h2>
      <p className="muted">
        Upload a Bricks theme or addon <code>.zip</code> (Advanced Themer, NextBricks, Bricksable, and the like).
        Archives are unpacked and registered for their CSS/JS and element definitions — PHP is stored for
        reference but never executed.
      </p>
      <form action={installBricksZip} className="card" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="file" name="file" accept=".zip,application/zip" required />
        <button style={{ fontSize: 12 }}>Install ZIP</button>
      </form>

      <h2 style={{ fontSize: 16, margin: 'var(--th-space-4) 0 var(--th-space-4)' }}>Bricks core</h2>
      {status?.core ? (
        <div className="cards">
          <ComponentCard c={status.core} />
        </div>
      ) : (
        <p className="muted">
          Bricks core isn&apos;t installed. Pages still render — the element format is native — but installing
          the theme zip brings its CSS, JS and element definitions along.
        </p>
      )}

      <h2 style={{ fontSize: 16, margin: 'var(--th-space-4) 0 var(--th-space-4)' }}>
        Addons {addons.length > 0 && <span className="muted" style={{ fontWeight: 400 }}>({addons.length})</span>}
      </h2>
      {addons.length > 0 ? (
        <div className="cards">
          {addons.map((a) => (
            <ComponentCard key={a.id} c={a} />
          ))}
        </div>
      ) : (
        <p className="muted">No addons installed yet.</p>
      )}
    </section>
  );
}

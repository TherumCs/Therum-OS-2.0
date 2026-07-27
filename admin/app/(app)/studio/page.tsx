import { apiGet } from '../../../lib/api';
import { setEdition, toggleFoundation, toggleCapability, selectProvider, toggleStudioApp } from '../../actions';
import { BASE_PATH } from '../../../lib/session';

interface StudioApp {
  id: string;
  name: string;
  description: string;
  navLabel: string;
  navHref: string;
  enabled: boolean;
}
interface Foundation {
  id: string;
  name: string;
  kind: string;
  description: string;
  core: boolean;
  status: string;
  enabled: boolean;
  locked?: boolean;
}
interface CapProvider {
  id: string;
  name: string;
  foundation: string;
  status: string;
  selectable: boolean;
  locked?: boolean;
  distribution: 'native' | 'ecosystem' | 'platform' | 'custom';
  version?: string;
}
interface Capability {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  provider: string;
  active: string | null;
  providers: CapProvider[];
}

export const dynamic = 'force-dynamic';

export default async function StudioPage() {
  let data: Foundation[] | null = null;
  let caps: Capability[] | null = null;
  let apps: StudioApp[] | null = null;
  let edition: 'pure' | 'unlocked' = 'pure';
  let err: string | null = null;
  try {
    const [f, c, a, e] = await Promise.all([
      apiGet<Foundation[]>('/api/foundations'),
      apiGet<Capability[]>('/api/capabilities'),
      apiGet<StudioApp[]>('/api/studio-apps'),
      apiGet<{ edition: 'pure' | 'unlocked' }>('/api/edition'),
    ]);
    data = f;
    caps = c;
    apps = a;
    edition = e.edition;
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  const stack = edition === 'unlocked' && data?.find((f) => f.id === 'bricks')?.enabled ? 'Therum OS + Bricks' : edition === 'unlocked' ? 'Therum OS (Unlocked)' : 'Therum OS Pure';

  return (
    <section>
      <h1>Studio</h1>
      <p className="muted">Pure is our native ecosystem, locked to native. Unlock to pair with others (Bricks, WordPress, ecosystem plugins).</p>
      <div className="notice row-between" style={{ background: edition === 'unlocked' ? 'var(--th-accent-tint)' : 'var(--th-success-bg)', color: edition === 'unlocked' ? 'var(--th-accent)' : 'var(--th-success-text)' }}>
        <span>
          Edition: <strong>{edition === 'unlocked' ? 'Unlocked' : 'Pure'}</strong> · {stack}
        </span>
        <span className="actions">
          <form action={setEdition.bind(null, 'pure')}>
            <button className={edition === 'pure' ? '' : 'ghost'} style={{ fontSize: 11 }}>Pure</button>
          </form>
          <form action={setEdition.bind(null, 'unlocked')}>
            <button className={edition === 'unlocked' ? '' : 'ghost'} style={{ fontSize: 11 }}>Unlocked</button>
          </form>
        </span>
      </div>
      {err && <div className="notice">API offline ({err})</div>}

      <h2 style={{ fontSize: 16, margin: 'var(--th-space-4) 0 var(--th-space-4)' }}>From the Studio</h2>
      <p className="muted">Self-contained apps — enable one to add its own nav entry and settings area.</p>
      <div className="cards">
        {apps?.map((a) => (
          <div key={a.id} className="card" style={{ borderTop: '3px solid ' + (a.enabled ? 'var(--th-accent)' : 'var(--th-line)') }}>
            <div className="row-between">
              <strong>{a.name}</strong>
              <span className={'pill pill-' + (a.enabled ? 'ok' : 'archived')}>{a.enabled ? 'on' : 'off'}</span>
            </div>
            <div className="muted" style={{ margin: 'var(--th-space-6) 0 var(--th-space-10)' }}>{a.description}</div>
            <div style={{ display: 'flex', gap: 'var(--th-space-8)', alignItems: 'center' }}>
              <form action={toggleStudioApp.bind(null, a.id, !a.enabled)}>
                <button className={a.enabled ? 'ghost' : ''}>{a.enabled ? 'Disable' : 'Enable'}</button>
              </form>
              {a.enabled && (
                <a href={`${BASE_PATH}${a.navHref}`} className="th-card-link">
                  Open {a.navLabel} →
                </a>
              )}
            </div>
          </div>
        ))}
      </div>

      <h2 style={{ fontSize: 16, margin: 'var(--th-space-28) 0 var(--th-space-4)' }}>Foundations</h2>
      <p className="muted">Pluggable builder / CMS-compat layers.</p>
      <div className="cards">
        {data?.map((f) => (
          <div key={f.id} className="card" style={{ borderTop: '3px solid ' + (f.enabled ? 'var(--th-accent)' : 'var(--th-line)') }}>
            <div className="row-between">
              <strong>{f.name}</strong>
              <span className={'pill pill-' + (f.enabled ? 'ok' : f.status === 'planned' ? 'pending' : 'archived')}>
                {f.enabled ? 'on' : f.status === 'planned' ? 'planned' : 'off'}
              </span>
            </div>
            <div className="muted" style={{ margin: 'var(--th-space-6) 0 var(--th-space-10)' }}>{f.description}</div>
            <div className="muted" style={{ fontSize: 11, marginBottom: 'var(--th-space-10)' }}>
              {f.kind}
              {f.core ? ' · core' : ''}
            </div>
            {f.core ? (
              <span className="muted" style={{ fontSize: 12 }}>Always on (Pure base)</span>
            ) : f.status === 'planned' ? (
              <span className="muted" style={{ fontSize: 12 }}>Coming soon</span>
            ) : f.locked ? (
              <span className="muted" style={{ fontSize: 12 }}>🔒 Requires Unlocked</span>
            ) : (
              <form action={toggleFoundation.bind(null, f.id, !f.enabled)}>
                <button className={f.enabled ? 'ghost' : ''}>{f.enabled ? 'Disable' : 'Enable'}</button>
              </form>
            )}
          </div>
        ))}
      </div>

      <h2 style={{ fontSize: 16, margin: 'var(--th-space-28) 0 var(--th-space-4)' }}>Capabilities</h2>
      <p className="muted">What the OS can do. Each resolves to a provider based on the active foundation.</p>
      <div className="cards">
        {caps?.map((c) => (
          <div key={c.id} className="card">
            <div className="row-between">
              <strong>{c.name}</strong>
              <form action={toggleCapability.bind(null, c.id, !c.enabled)}>
                <button className={c.enabled ? '' : 'ghost'}>{c.enabled ? 'On' : 'Off'}</button>
              </form>
            </div>
            <div className="muted" style={{ margin: 'var(--th-space-6) 0 var(--th-space-10)' }}>{c.description}</div>
            <div className="field-label">Provider {c.enabled ? '' : '(enable to use)'}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--th-space-6)' }}>
              {c.providers
                .filter((p) => p.selectable)
                .map((p) => (
                  <form key={p.id} action={selectProvider.bind(null, c.id, p.id)}>
                    <button className={c.provider === p.id ? '' : 'ghost'} style={{ fontSize: 11 }} title={p.distribution}>
                      {p.name}
                      {p.distribution === 'ecosystem' ? ' ◆' : p.distribution === 'custom' ? ' ✎' : ''}
                    </button>
                  </form>
                ))}
            </div>
            {c.providers.filter((p) => p.locked).length > 0 && (
              <div className="muted" style={{ fontSize: 11, marginTop: 'var(--th-space-8)' }}>
                🔒 unlock to use: {c.providers.filter((p) => p.locked).map((p) => `${p.name} (${p.distribution})`).join(', ')}
              </div>
            )}
            {c.providers.filter((p) => !p.selectable && !p.locked).length > 0 && (
              <div className="muted" style={{ fontSize: 11, marginTop: 'var(--th-space-4)' }}>
                planned: {c.providers.filter((p) => !p.selectable && !p.locked).map((p) => p.name).join(', ')}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

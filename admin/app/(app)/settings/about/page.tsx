import { apiGet } from '../../../../lib/api';

export const dynamic = 'force-dynamic';

interface About {
  version: string;
  node: string;
  database: string;
  env: string;
  platform: string;
  uptimeSeconds: number;
  startedAt: string;
  adminVersion: string;
  builderVersion: string;
}

function Row({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="th-about-row">
      <span className="th-about-label">{label}</span>
      <strong className="th-about-value">{value}</strong>
      {note && <span className="th-about-note">{note}</span>}
    </div>
  );
}

function fmtUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

// About — what you are running, on what, and whether the separately-deployed
// pieces agree with each other. It used to be four bare values (version, node,
// database, env) with no way to tell whether the admin and builder bundles had
// drifted from the API, which is the failure this screen is best placed to
// catch.
export default async function AboutSettingsPage() {
  let about: About | null = null;
  let err: string | null = null;
  try {
    about = await apiGet<About>('/api/system/about');
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }

  // A mismatch here means one of the three was deployed without the others.
  const versions = [about?.version, about?.adminVersion, about?.builderVersion].filter(Boolean);
  const inSync = versions.length === 3 && new Set(versions).size === 1;

  return (
    <div>
      <h2 style={{ marginTop: 0, fontSize: 'var(--th-fs-lg)' }}>About</h2>
      <p className="muted" style={{ marginTop: -8 }}>
        What this install is running, and what it is running on.
      </p>
      {err && <div className="notice">API offline ({err})</div>}

      <div className="card th-about-hero">
        <div>
          <div className="th-about-name">Therum OS</div>
          <div className="th-about-tagline">
            Content, commerce and design system in one place. Node and TypeScript end to end — no WordPress underneath.
          </div>
        </div>
        <div className="th-about-version">
          <span className="th-about-version-num">v{about?.version ?? '—'}</span>
          <span className={'th-about-badge' + (about?.env === 'production' ? ' is-prod' : '')}>
            {about?.env ?? 'unknown'}
          </span>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="l">Components</div>
        <p className="th-about-sub">
          Each ships and deploys on its own. They should all report the same version.
        </p>
        <div className="th-about-grid">
          <Row label="API / core" value={`v${about?.version ?? '—'}`} note="Fastify + Prisma" />
          <Row label="Admin" value={`v${about?.adminVersion ?? '—'}`} note="Next.js, /tos-admin" />
          <Row label="Builder" value={`v${about?.builderVersion ?? '—'}`} note="Vite SPA, /builder" />
        </div>
        {versions.length === 3 && (
          <p className={'th-about-sync' + (inSync ? ' ok' : ' warn')}>
            {inSync
              ? 'All three components are on the same version.'
              : 'Versions differ — one of these was deployed without the others.'}
          </p>
        )}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="l">Runtime</div>
        <div className="th-about-grid">
          <Row label="Node" value={about?.node ?? '—'} />
          <Row label="Platform" value={about?.platform ?? '—'} />
          <Row label="Database" value={about?.database ?? '—'} />
          <Row
            label="Uptime"
            value={about ? fmtUptime(about.uptimeSeconds) : '—'}
            note={about ? `since ${about.startedAt.slice(0, 16).replace('T', ' ')} UTC` : undefined}
          />
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="l">Credits</div>
        <p className="th-about-credits">
          Built and maintained by <strong>Bam</strong> at <strong>Therum Creative Studios</strong>. A ground-up rebuild
          of Therum OS 1.9.44 — the WordPress-era version — as its own platform: same ideas, none of the inherited
          weight. Anti-agency. Anti-bloat.
        </p>
      </div>
    </div>
  );
}

import { apiGet } from '../../../../lib/api';

export const dynamic = 'force-dynamic';

interface About {
  version: string;
  node: string;
  database: string;
  env: string;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="muted" style={{ fontSize: 'var(--th-fs-2xs)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block' }}>
        {label}
      </span>
      <strong>{value}</strong>
    </div>
  );
}

export default async function AboutSettingsPage() {
  let about: About | null = null;
  let err: string | null = null;
  try {
    about = await apiGet<About>('/api/system/about');
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }

  return (
    <div>
      <h2 style={{ marginTop: 0, fontSize: 'var(--th-fs-lg)' }}>About</h2>
      {err && <div className="notice">API offline ({err})</div>}
      <div className="card" style={{ maxWidth: 560 }}>
        <div className="l">Therum CMS</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 12 }}>
          <Row label="Version" value={`v${about?.version ?? '?'}`} />
          <Row label="Node" value={about?.node ?? '?'} />
          <Row label="Database" value={about?.database ?? '?'} />
          <Row label="Environment" value={about?.env ?? '?'} />
        </div>
      </div>
      <div className="card" style={{ maxWidth: 560, marginTop: 14 }}>
        <div className="l">Credits</div>
        <p style={{ fontSize: 'var(--th-fs-sm)', color: 'var(--th-ink-2)', lineHeight: 1.6, marginTop: 8 }}>
          Therum CMS is built and maintained by <strong>Bam</strong> at <strong>Therum Creative Studios</strong>. Ground-up Node/TypeScript rebuild of Therum OS — no WordPress underneath. Anti-agency. Anti-bloat.
        </p>
      </div>
    </div>
  );
}

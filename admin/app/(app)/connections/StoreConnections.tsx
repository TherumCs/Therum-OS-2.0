'use client';

import { BASE_PATH } from '../../../lib/session';
import { iconColor } from '../settings/connections/ConnectionsClient';

// Counter's mini-Nexus.
//
// The card is deliberately the SAME shape as Nexus's — same icon tile, same
// status dot, same corner radius, same hover lift — and it imports Nexus's own
// iconColor so a provider is the same colour in both places. A lookalike built
// from scratch is a lookalike that drifts.
//
// What differs is WHAT is listed: only what is connected, and only the three
// categories a store runs on. Nexus is the catalogue and the vault; this is
// the answer to "am I open for business".
export interface StoreConnection {
  id: string;
  name: string;
  category: string;
  connected: boolean;
  status: string | null;
  maskedPreview: string | null;
  connectedAt: string | null;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
}

const GROUPS: { key: string; label: string; blurb: string; empty: string }[] = [
  { key: 'payments', label: 'Payments', blurb: 'Who takes the money.', empty: 'Nothing connected — checkout can only take the mock method.' },
  { key: 'fulfillment', label: 'Fulfillment', blurb: 'Who prints, packs and ships.', empty: 'Nothing connected — orders wait for manual handling.' },
  { key: 'ecommerce', label: 'Ecommerce platforms', blurb: 'Where products and orders sync from.', empty: 'Nothing connected — this store is standalone.' },
  { key: 'custom', label: 'Custom', blurb: 'Connectors you defined yourself.', empty: '' },
];

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
}

function Card({ c }: { c: StoreConnection }) {
  const ic = iconColor(c.id);
  const bad = c.status === 'error' || c.lastTestOk === false;
  const statusColor = bad ? 'var(--th-danger, #ef4444)' : 'var(--th-success, #10b981)';
  return (
    <a
      href={`${BASE_PATH}/settings/connections?tab=${encodeURIComponent(c.category)}`}
      style={{
        position: 'relative', textAlign: 'left', padding: 18, minHeight: 150,
        background: 'linear-gradient(180deg, rgba(16,185,129,.05), var(--th-surface))',
        border: bad ? '1px solid rgba(239,68,68,.35)' : '1px solid rgba(16,185,129,.3)',
        borderRadius: 14, display: 'flex', flexDirection: 'column', gap: 6,
        transition: 'transform .15s ease, box-shadow .15s ease',
        textDecoration: 'none', color: 'var(--th-ink)',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 10px 28px rgba(0,0,0,.10)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}
    >
      <span style={{ position: 'absolute', top: 14, right: 14, display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, letterSpacing: '.04em', textTransform: 'uppercase', color: statusColor }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />
        {bad ? 'error' : 'connected'}
      </span>
      <span style={{ width: 40, height: 40, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, letterSpacing: '-.02em', background: ic.bg, color: ic.fg, marginBottom: 6 }}>
        {c.name.slice(0, 2)}
      </span>
      <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>{c.name}</span>
      <span style={{ display: 'block', fontSize: 11, color: 'var(--th-muted)' }}>
        {c.maskedPreview ?? 'Credential stored'}
      </span>
      <span style={{ display: 'flex', marginTop: 'auto', paddingTop: 10, borderTop: '1px solid var(--th-line)', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, fontWeight: 600 }}>
        <span>Manage →</span>
        <span style={{ fontSize: 9, color: 'var(--th-muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
          {c.lastTestedAt ? `tested ${when(c.lastTestedAt)}` : 'never tested'}
        </span>
      </span>
    </a>
  );
}

export function StoreConnections({ connections }: { connections: StoreConnection[] }) {
  const live = connections.filter((c) => c.connected);

  return (
    <div style={{ display: 'grid', gap: 'var(--th-space-20)' }}>
      {GROUPS.map((g) => {
        const rows = live.filter((c) => c.category === g.key);
        // Custom only appears once one exists — an empty "Custom" card on
        // every store is permanent furniture.
        if (g.key === 'custom' && rows.length === 0) return null;
        return (
          <div className="settings-group" key={g.key}>
            <h3 className="settings-group-title">
              {g.label}{' '}
              <span className="muted" style={{ fontWeight: 400 }}>— {rows.length || 'none'}</span>
            </h3>
            <p className="settings-group-desc">{g.blurb}</p>
            {rows.length === 0 ? (
              <div className="settings-empty-state">
                {g.empty}{' '}
                <a href={`${BASE_PATH}/settings/connections?tab=${g.key}`}>Connect one in Nexus →</a>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
                {rows.map((c) => (
                  <Card key={c.id} c={c} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

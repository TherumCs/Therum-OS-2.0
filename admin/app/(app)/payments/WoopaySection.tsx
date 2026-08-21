import { money } from './format';
import { BASE_PATH } from '../../../lib/session';
import type { AcctTile, Track } from './merge';

// Payments › Overview — section 2: two symmetric account tiles.
//
// The store settles on two rails that both pay out to the same bank:
// WooPayments (the live card/wallet/BNPL rail) and the direct-Stripe track
// (legacy). This card shows each rail on its own — balance, deposit cadence,
// and the one control each track exposes — side by side, so the operator reads
// both without opening WordPress or the Stripe dashboard. Presentational only:
// page.tsx does the fetching and hands down the merged AcctTile props; this
// file renders exactly what they carry and invents nothing.

// Both internal controls point at the same in-app Settings tab; Stripe's
// deep links, when present, open the external dashboard in a new tab instead.
const SETTINGS = `${BASE_PATH}/payments/settings`;

// Shared bank glyph, used in the same-bank footer.
function BankIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21h18M4 10h16M12 3 4 7h16zM6 10v8m4-8v8m4-8v8m4-8v8" />
    </svg>
  );
}

// Deposits renders the head cadence plain and any "· suffix" small + muted,
// matching the mockup. depositLabel arrives as one string ("Daily · 2-day
// delay" for woo, "Daily" for stripe); split on the first " · " to peel the
// qualifier back out for the <small>.
function Deposits({ label }: { label: string }) {
  const [head, ...rest] = label.split(' · ');
  return (
    <div className="st-v">
      {head}
      {rest.length ? <> <small>· {rest.join(' · ')}</small></> : null}
    </div>
  );
}

function Tile({ track, tile }: { track: Track; tile: AcctTile }) {
  const woo = track === 'woo';

  return (
    <div className={woo ? 'acct acct-woo' : 'acct acct-stripe'}>
      <div className="acct-head">
        <div className="acct-id">
          <div className={woo ? 'mono mono-w' : 'mono mono-s'}>{woo ? 'Wp' : 'St'}</div>
          <div>
            <div className="acct-name">
              {woo ? 'WooPayments' : (
                <>Stripe <span style={{ fontWeight: 500, color: 'var(--th-muted)', fontSize: 'var(--th-fs-xs)' }}>(direct)</span></>
              )}
            </div>
            <div className="acct-role">
              {woo ? 'Card · wallets · BNPL — the live rail' : 'Legacy card track — same bank'}
            </div>
          </div>
        </div>
        <div className="acct-badges">
          <span className={tile.connected ? 'th-about-badge is-prod' : 'th-about-badge'}>
            {tile.connected ? 'Connected' : 'Not connected'}
          </span>
          {tile.payoutsOn ? <span className="th-about-badge badge-ok">Payouts on</span> : null}
        </div>
      </div>

      <div className="stat-grid">
        <div>
          <div className="st-l">Available</div>
          <div className={tile.available < 0 ? 'st-v pay-neg' : 'st-v'}>{money(tile.available)}</div>
        </div>
        <div>
          <div className="st-l">Pending</div>
          <div className="st-v">{money(tile.pending)}</div>
        </div>
        <div>
          <div className="st-l">Deposits</div>
          <Deposits label={tile.depositLabel} />
        </div>
        {woo ? (
          <div>
            <div className="st-l">Instant payout</div>
            <div className="st-v" style={{ fontSize: 'var(--th-fs-sm)' }}>{tile.instantEligible ? 'On' : 'Pending'}</div>
            <div className="st-note">Eligibility is volume-gated</div>
          </div>
        ) : (
          <div>
            <div className="st-l">Effective fee</div>
            <div className="st-v">{tile.feePct != null ? `~${tile.feePct}%` : '—'}</div>
            {tile.feeSample != null ? <div className="st-note">Last {tile.feeSample} charges</div> : null}
          </div>
        )}
      </div>

      <div className="acct-actions">
        {woo ? (
          <>
            <button
              type="button"
              className="th-btn th-btn-primary"
              aria-disabled={tile.instantEligible ? undefined : true}
              title={tile.instantEligible ? undefined : 'Instant payout is pending eligibility — needs more processing volume'}
            >
              ⚡ Instant payout
            </button>
            <a className="th-btn" href={SETTINGS}>Change schedule</a>
            <a className="th-btn" href={SETTINGS}>Payment methods</a>
            {tile.instantEligible ? null : (
              <p className="reason">{tile.instantReason ?? 'Pending eligibility — unlocks with payment volume'}</p>
            )}
          </>
        ) : (
          <>
            {tile.scheduleUrl
              ? <a className="th-btn" href={tile.scheduleUrl} target="_blank" rel="noreferrer">Change schedule</a>
              : <a className="th-btn" href={SETTINGS}>Change schedule</a>}
            <a className="th-btn" href={SETTINGS}>Payment methods</a>
            {tile.manageUrl
              ? <a className="th-btn" href={tile.manageUrl} target="_blank" rel="noreferrer">Manage in Stripe ↗</a>
              : null}
          </>
        )}
      </div>
    </div>
  );
}

export function AccountTiles({ woo, stripe, bankLast4 }: { woo: AcctTile; stripe: AcctTile; bankLast4: string | null }) {
  return (
    <section className="card accounts">
      <div className="acct-grid">
        <Tile track="woo" tile={woo} />
        <Tile track="stripe" tile={stripe} />
      </div>
      <div className="same-bank">
        <BankIcon />
        Both accounts pay out to the same bank account{bankLast4 ? <> <b>••••{bankLast4}</b></> : null}
      </div>
    </section>
  );
}

import type { Track } from './merge';
import { money } from './format';

// Counter › Payments › section 1 — the UNIFIED BALANCE HERO.
//
// One "how much do I have, everywhere" number across both money rails, then a
// per-account split so each track (WooPayments red, Stripe blue) can still be
// read on its own. Both rails settle to the same bank. Purely presentational:
// page.tsx fetches every value and hands it down; this component renders it and
// fetches nothing. All amounts are minor units (cents) → money().

interface PerAccount {
  key: Track;
  name: string;
  amount: number;
  pct: number;
}

interface BalanceHeroProps {
  available: number;
  pending: number;
  instant: number;
  total: number;
  perAccount: PerAccount[];
  bankLast4: string | null;
}

// The two-track colour key, carried from here into the tiles and activity: red
// segment/dot = WooPayments, blue = Stripe.
const segClass = (k: Track) => (k === 'woo' ? 'seg-w' : 'seg-s');
const dotClass = (k: Track) => (k === 'woo' ? 'dot-w' : 'dot-s');

export function BalanceHero({ available, pending, instant, total, perAccount, bankLast4 }: BalanceHeroProps) {
  // Spoken description of the split for screen readers, built from the same
  // numbers the bar draws.
  const barLabel = perAccount.map((a) => `${a.name} ${a.pct.toFixed(1)}%`).join(', ') + ' of the balance';

  return (
    <section className="card pay-hero">
      <div>
        <div className="hero-head">
          <span className="l">Total balance · both accounts</span>
          <span className="updated">Updated just now</span>
        </div>
        <div className="hero-num">{money(total)}</div>
        <div className="hero-caption">Everything across WooPayments and Stripe, both settling to one bank.</div>
        <div className="hero-stats">
          <div>
            <div className={'hs-v' + (available < 0 ? ' pay-neg' : '')}>{money(available)}</div>
            <div className="hs-l">Available now</div>
          </div>
          <div>
            <div className="hs-v">{money(pending)}</div>
            <div className="hs-l">Pending / clearing</div>
          </div>
          <div>
            <div className="hs-v">{money(instant)}</div>
            <div className="hs-l">Instant-eligible</div>
          </div>
        </div>
      </div>

      <div className="split">
        <div className="split-title">Where the money is</div>
        {/* Each segment sized by its share, but never thinner than 6px so a
            tiny track stays visible; overflow is clipped by .split-bar. */}
        <div className="split-bar" role="img" aria-label={barLabel}>
          {perAccount.map((a) => (
            <div key={a.key} className={segClass(a.key)} style={{ flex: `0 0 max(6px, ${a.pct}%)` }} />
          ))}
        </div>
        <div className="legend">
          {perAccount.map((a) => (
            <div key={a.key} className="lg-row">
              <span className="lg-name">
                <span className={'dot ' + dotClass(a.key)} />
                {a.name}
              </span>
              <span className="lg-amt">{money(a.amount)}</span>
              <span className="lg-pct">{a.pct.toFixed(1)}%</span>
            </div>
          ))}
        </div>
        <div className="split-foot">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 21h18M4 10h16M12 3 4 7h16zM6 10v8m4-8v8m4-8v8m4-8v8" />
          </svg>
          Both rails deposit to the same bank{bankLast4 ? <> <b>{`••••${bankLast4}`}</b></> : null}
        </div>
      </div>
    </section>
  );
}

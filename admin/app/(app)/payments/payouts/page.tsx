import { revalidatePath } from 'next/cache';
import { apiGet, apiSend } from '../../../../lib/api';
import { money, fmtDate } from '../format';
import { WoopayInstantPayout } from '../WoopayInstantPayout';

export const dynamic = 'force-dynamic';

// Counter › Payments › Payouts — every deposit sent to the bank. Two accounts
// can surface here: the WooPayments engine (the sealed merchant account, top),
// and the direct-Stripe connection read straight from the Nexus key (below).
// WooPayments is where the instant-payout action lives — the one control that
// moves money — because that is the account this store's checkout settles into.

// ── WooPayments (engine, over the bridge) ─────────────────────────────────
interface WoopayDeposit {
  id: string;
  amount: number;
  currency: string;
  status: string;
  date: number | null;
  type: string | null;
  automatic: boolean | null;
  bankLast4: string | null;
}
interface WoopayDepositsResp {
  connected: boolean;
  error?: string;
  account?: {
    depositsEnabled: boolean;
    depositSchedule: string | null;
    instantEligible: boolean;
    instantFeePct: number | null;
    instantReason: string | null;
  };
  balance?: { available: number; pending: number; instant: number; currency: string };
  deposits: WoopayDeposit[];
}

// Server Action: request an instant payout of the instant-eligible balance.
// Errors come back as a serialisable { error } the island can render, rather
// than a thrown 500 — the same shape every write on these screens returns.
async function woopayInstantPayout(currency: string): Promise<{ error?: string } | void> {
  'use server';
  try {
    await apiSend('POST', '/api/counter/payments/woopay/payout', { currency });
    revalidatePath('/payments/payouts');
    revalidatePath('/payments');
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'The payout could not be started.' };
  }
}

// ── Direct Stripe (Nexus key) ─────────────────────────────────────────────
interface Payout {
  id: string;
  amount: number;
  currency: string;
  status: string;
  method: string;
  arrivalDate: number | null;
  created: number | null;
  description: string | null;
  bankLast4: string | null;
}
interface Resp {
  connected: boolean;
  payouts: Payout[];
  error?: string;
}

function StatusPill({ status }: { status: string }) {
  // Only a settled payout earns the accent badge; everything else stays neutral.
  const ok = status === 'paid';
  return <span className={'th-about-badge' + (ok ? ' is-prod' : '')}>{status.replace(/_/g, ' ')}</span>;
}

export default async function PayoutsPage() {
  const [wd, r] = await Promise.all([
    apiGet<WoopayDepositsResp>('/api/counter/payments/woopay/deposits').catch(
      (): WoopayDepositsResp => ({ connected: false, deposits: [] }),
    ),
    apiGet<Resp>('/api/counter/payments/payouts?limit=50').catch((): Resp => ({ connected: false, payouts: [] })),
  ]);

  return (
    <div>
      {/* WooPayments deposits — the engine account, with the instant-payout action. */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="l">WooPayments deposits</div>
        <p className="th-about-sub">
          Every deposit the WooPayments engine sent to your bank, net of fees and refunds
          {wd.account?.depositSchedule ? ` — ${wd.account.depositSchedule} cadence` : ''}. Move the instant-eligible
          balance to your debit card now with the button below.
        </p>

        {!wd.connected ? (
          <p className="muted">{wd.error ?? 'WooPayments is not connected yet — connect it from the Overview tab.'}</p>
        ) : (
          <>
            <WoopayInstantPayout
              instantAvailable={wd.balance?.instant ?? 0}
              currency={wd.balance?.currency ?? 'USD'}
              eligible={wd.account?.instantEligible ?? false}
              reason={wd.account?.instantReason}
              feePct={wd.account?.instantFeePct}
              onPayout={woopayInstantPayout}
            />
            {wd.error && <p className="muted" style={{ marginTop: 8 }}>{wd.error}</p>}
            {wd.deposits.length === 0 ? (
              <p className="muted" style={{ marginTop: 12 }}>
                No deposits yet — your first lands once a charge clears and the bank hold passes.
              </p>
            ) : (
              <div className="pay-scroll" style={{ marginTop: 12 }}>
                <table>
                  <thead>
                    <tr>
                      <th className="pay-num">Amount</th>
                      <th>Status</th>
                      <th>Bank</th>
                      <th>Date</th>
                      <th>Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wd.deposits.map((d) => (
                      <tr key={d.id}>
                        <td className="pay-num">{money(d.amount)}</td>
                        <td>
                          <span className={'th-about-badge' + (d.status === 'paid' ? ' is-prod' : '')}>
                            {d.status.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td>{d.bankLast4 ? `•••• ${d.bankLast4}` : '—'}</td>
                        <td>{fmtDate(d.date)}</td>
                        <td style={{ textTransform: 'capitalize' }}>
                          {d.type ? d.type.replace(/_/g, ' ') : d.automatic === false ? 'instant' : 'deposit'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {/* Direct-Stripe payouts — the Nexus-key account, read-only. */}
      {r.connected ? (
        <div className="card">
          <div className="l">Payouts to your bank (direct Stripe)</div>
          <p className="th-about-sub">
            Each deposit the directly-connected Stripe account sent to your bank, net of fees and refunds. Payout timing
            is set with your processor.
          </p>
          {r.error && <p className="muted">{r.error}</p>}
          {r.payouts.length === 0 ? (
            <p className="muted">No payouts yet — your first lands once a charge clears and the bank hold passes.</p>
          ) : (
            <div className="pay-scroll">
              <table>
                <thead>
                  <tr>
                    <th className="pay-num">Amount</th>
                    <th>Status</th>
                    <th>Bank</th>
                    <th>Arrival</th>
                    <th>Method</th>
                  </tr>
                </thead>
                <tbody>
                  {r.payouts.map((p) => (
                    <tr key={p.id}>
                      <td className="pay-num">{money(p.amount)}</td>
                      <td>
                        <StatusPill status={p.status} />
                      </td>
                      <td>{p.bankLast4 ? `•••• ${p.bankLast4}` : '—'}</td>
                      <td>{fmtDate(p.arrivalDate)}</td>
                      <td style={{ textTransform: 'capitalize' }}>{p.method}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

import { apiGet } from '../../../../lib/api';
import { money, fmtDate } from '../format';

export const dynamic = 'force-dynamic';

// Counter › Payments › Payouts — every deposit Stripe sent to the bank.

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
  const r = await apiGet<Resp>('/api/counter/payments/payouts?limit=50').catch((): Resp => ({ connected: false, payouts: [] }));

  if (!r.connected) {
    return (
      <div className="card">
        <div className="l">Stripe not connected</div>
        <p className="th-about-sub">Connect Stripe in Nexus to see payouts here.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="l">Payouts to your bank</div>
      <p className="th-about-sub">
        Each deposit Stripe sent to your bank account, net of fees and refunds. Payout timing is set with your processor.
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
                  <td><StatusPill status={p.status} /></td>
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
  );
}

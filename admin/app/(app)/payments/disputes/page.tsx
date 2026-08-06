import { apiGet } from '../../../../lib/api';
import { money, fmtDate } from '../format';

export const dynamic = 'force-dynamic';

// Counter › Payments › Disputes — chargebacks and inquiries. Evidence is
// submitted in the Stripe dashboard (that is where the case file lives); this
// screen is the running list and the respond-by clock.

interface Dispute {
  id: string;
  amount: number;
  currency: string;
  status: string;
  reason: string;
  created: number;
  evidenceDueBy: number | null;
  hasEvidence: boolean;
  chargeId: string | null;
}
interface Resp {
  connected: boolean;
  disputes: Dispute[];
  error?: string;
}

export default async function DisputesPage() {
  const r = await apiGet<Resp>('/api/counter/payments/disputes?limit=50').catch((): Resp => ({ connected: false, disputes: [] }));

  if (!r.connected) {
    return (
      <div className="card">
        <div className="l">Stripe not connected</div>
        <p className="th-about-sub">Connect Stripe in Nexus to see disputes here.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="l">Disputes &amp; chargebacks</div>
      <p className="th-about-sub">
        When a cardholder disputes a charge the amount is held. You have until the respond-by date to submit evidence in
        your Stripe dashboard.
      </p>
      {r.error && <p className="muted">{r.error}</p>}
      {r.disputes.length === 0 ? (
        <p className="muted">No disputes — a clean record, nothing to respond to.</p>
      ) : (
        <div className="pay-scroll">
          <table>
            <thead>
              <tr>
                <th className="pay-num">Amount</th>
                <th>Reason</th>
                <th>Status</th>
                <th>Respond by</th>
                <th>Opened</th>
              </tr>
            </thead>
            <tbody>
              {r.disputes.map((d) => (
                <tr key={d.id}>
                  <td className="pay-num">{money(d.amount)}</td>
                  <td style={{ textTransform: 'capitalize' }}>{d.reason.replace(/_/g, ' ')}</td>
                  <td><span className="th-about-badge">{d.status.replace(/_/g, ' ')}</span></td>
                  <td>{fmtDate(d.evidenceDueBy)}</td>
                  <td>{fmtDate(d.created)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

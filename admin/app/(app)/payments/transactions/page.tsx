import { apiGet } from '../../../../lib/api';
import { BASE_PATH } from '../../../../lib/session';
import { money, fmtDate } from '../format';

export const dynamic = 'force-dynamic';

// Counter › Payments › Transactions — the money ledger. Every charge, refund
// and fee, the fee taken, and the net that reaches the balance. Where a row is
// a charge on one of this store's orders, it links straight to that order.

interface Txn {
  id: string;
  type: string;
  amount: number;
  fee: number;
  net: number;
  currency: string;
  status: string;
  created: number;
  description: string | null;
  orderNumber: string | null;
  orderId: string | null;
}
interface Resp {
  connected: boolean;
  transactions: Txn[];
  error?: string;
  hasMore?: boolean;
}

const TYPE_LABEL: Record<string, string> = {
  charge: 'Payment',
  payment: 'Payment',
  refund: 'Refund',
  payment_refund: 'Refund',
  payout: 'Payout',
  payout_cancel: 'Payout reversal',
  adjustment: 'Adjustment',
  stripe_fee: 'Fee',
  application_fee: 'Fee',
};

export default async function TransactionsPage() {
  const r = await apiGet<Resp>('/api/counter/payments/transactions?limit=50').catch((): Resp => ({ connected: false, transactions: [] }));

  if (!r.connected) {
    return (
      <div className="card">
        <div className="l">Stripe not connected</div>
        <p className="th-about-sub">Connect Stripe in Nexus to see transactions here.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="l">Transactions</div>
      <p className="th-about-sub">
        Every charge, refund and fee on your Stripe account — gross, the fee taken, and the net that reaches your balance.
      </p>
      {r.error && <p className="muted">{r.error}</p>}
      {r.transactions.length === 0 ? (
        <p className="muted">No transactions yet.</p>
      ) : (
        <div className="pay-scroll">
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Order / reference</th>
                <th>Date</th>
                <th className="pay-num">Gross</th>
                <th className="pay-num">Fee</th>
                <th className="pay-num">Net</th>
              </tr>
            </thead>
            <tbody>
              {r.transactions.map((t) => (
                <tr key={t.id}>
                  <td>{TYPE_LABEL[t.type] ?? t.type.replace(/_/g, ' ')}</td>
                  <td>
                    {t.orderNumber && t.orderId ? (
                      <a className="pay-orderlink" href={`${BASE_PATH}/orders/${t.orderId}`}>{t.orderNumber}</a>
                    ) : (
                      <span className="muted">{t.description ?? '—'}</span>
                    )}
                  </td>
                  <td>{fmtDate(t.created)}</td>
                  <td className={'pay-num' + (t.amount < 0 ? ' pay-neg' : '')}>{money(t.amount)}</td>
                  <td className="pay-num">{t.fee ? money(-t.fee) : '—'}</td>
                  <td className={'pay-num ' + (t.net < 0 ? 'pay-neg' : 'pay-pos')}>{money(t.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

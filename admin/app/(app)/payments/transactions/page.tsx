import { apiGet } from '../../../../lib/api';
import { BASE_PATH } from '../../../../lib/session';
import { money, fmtDate } from '../format';

export const dynamic = 'force-dynamic';

// Counter › Payments › Transactions — the money ledger. Every charge, refund
// and fee, the fee taken, and the net that reaches the balance. Two accounts
// can surface here: the WooPayments engine (top, the account checkout settles
// into) and the direct-Stripe connection (below). Where a row is a charge on
// one of this store's orders, it links straight to that order.

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
// The WooPayments ledger is the same row shape — WCPay's transactions API
// mirrors Stripe's — so both tables share this type and the label map.
type WoopayTxnsResp = Resp;

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
  dispute: 'Dispute',
  reserve: 'Reserve',
};

function Ledger({ transactions }: { transactions: Txn[] }) {
  if (transactions.length === 0) return <p className="muted">No transactions yet.</p>;
  return (
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
          {transactions.map((t) => (
            <tr key={t.id}>
              <td>{TYPE_LABEL[t.type] ?? t.type.replace(/_/g, ' ')}</td>
              <td>
                {t.orderNumber && t.orderId ? (
                  <a className="pay-orderlink" href={`${BASE_PATH}/orders/${t.orderId}`}>
                    {t.orderNumber}
                  </a>
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
  );
}

export default async function TransactionsPage() {
  const [wt, r] = await Promise.all([
    apiGet<WoopayTxnsResp>('/api/counter/payments/woopay/transactions?limit=50').catch(
      (): WoopayTxnsResp => ({ connected: false, transactions: [] }),
    ),
    apiGet<Resp>('/api/counter/payments/transactions?limit=50').catch((): Resp => ({ connected: false, transactions: [] })),
  ]);

  return (
    <div>
      {/* WooPayments ledger — the engine account. */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="l">WooPayments transactions</div>
        <p className="th-about-sub">
          Every charge, refund and fee on the WooPayments engine account — gross, the fee taken, and the net that reaches
          your balance.
        </p>
        {!wt.connected ? (
          <p className="muted">{wt.error ?? 'WooPayments is not connected yet — connect it from the Overview tab.'}</p>
        ) : (
          <>
            {wt.error && <p className="muted">{wt.error}</p>}
            <Ledger transactions={wt.transactions} />
          </>
        )}
      </div>

      {/* Direct-Stripe ledger — the Nexus-key account. */}
      {r.connected ? (
        <div className="card">
          <div className="l">Transactions (direct Stripe)</div>
          <p className="th-about-sub">
            Every charge, refund and fee on the directly-connected Stripe account — gross, the fee taken, and the net
            that reaches your balance.
          </p>
          {r.error && <p className="muted">{r.error}</p>}
          <Ledger transactions={r.transactions} />
        </div>
      ) : null}
    </div>
  );
}

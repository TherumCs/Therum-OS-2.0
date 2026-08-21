'use client';

import { useState } from 'react';
import { money, fmtDate } from './format';
import { TrackChip, type MergedTxn, type MergedPayout, type Track } from './merge';
import { BASE_PATH } from '../../../lib/session';

// Payments › Overview › section 3 — the merged activity card. One account
// filter (All / WooPayments / Stripe) drives BOTH ledgers at once, so an
// operator reads "this account's money movement" in a single flip rather than
// two separate tables. It is a client island purely for that filter: the
// default (All) renders every row on the server, and the filter is a
// progressive enhancement over that fully-formed table — turn JS off and you
// still see the complete activity, just without the segmented control working.
//
// Every value shown is carried in by the page (Counter → both rails, merged in
// merge.ts). Nothing is invented here: a charge with no customer name shows the
// order/reference it belongs to, never a placeholder name.

// Same label map the standalone Transactions ledger uses — keep them in step so
// a "payment_refund" reads "Refund" in both places.
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

// The customer identity for a transaction row: the name when we have one, else
// the order it belongs to (linked to the order when we hold its id) or the raw
// reference — but never a stand-in name.
function OrderRef({ txn }: { txn: MergedTxn }) {
  if (txn.orderId && txn.ref) {
    return (
      <a className="pay-orderlink" href={`${BASE_PATH}/orders/${txn.orderId}`}>
        {txn.ref}
      </a>
    );
  }
  return <span className="muted">{txn.ref ?? '—'}</span>;
}

// Only a settled payout earns the accent badge; everything in flight stays neutral.
function PayoutStatus({ status }: { status: string }) {
  return (
    <span className={'th-about-badge' + (status === 'paid' ? ' is-prod' : '')}>{status.replace(/_/g, ' ')}</span>
  );
}

export function Activity({ transactions, payouts }: { transactions: MergedTxn[]; payouts: MergedPayout[] }) {
  const [filter, setFilter] = useState<'all' | Track>('all');
  const shows = (account: Track): boolean => filter === 'all' || filter === account;

  // Count what the current filter leaves visible, so each ledger's empty line
  // appears exactly when its table has no matching rows.
  const txnShown = transactions.filter((t) => shows(t.account)).length;
  const payShown = payouts.filter((p) => shows(p.account)).length;

  return (
    <section className="card activity">
      <div className="act-head">
        <div className="act-title">
          Activity <span>· both accounts</span>
        </div>
        <div className="seg" role="group" aria-label="Filter by account">
          <button
            type="button"
            className={'seg-btn' + (filter === 'all' ? ' active' : '')}
            data-filter="all"
            onClick={() => setFilter('all')}
          >
            All
          </button>
          <button
            type="button"
            className={'seg-btn' + (filter === 'woo' ? ' active' : '')}
            data-filter="woo"
            onClick={() => setFilter('woo')}
          >
            <span className="dot dot-w" />WooPayments
          </button>
          <button
            type="button"
            className={'seg-btn' + (filter === 'stripe' ? ' active' : '')}
            data-filter="stripe"
            onClick={() => setFilter('stripe')}
          >
            <span className="dot dot-s" />Stripe
          </button>
        </div>
      </div>

      {/* Transactions ledger — both accounts, account-labelled, with customer. */}
      <div className="act-section-l">Transactions</div>
      <div className="pay-scroll act-divider">
        <table className="act-tbl">
          <thead>
            <tr>
              <th>Account</th>
              <th>Customer</th>
              <th>Type</th>
              <th>Date</th>
              <th className="pay-num">Gross</th>
              <th className="pay-num">Fee</th>
              <th className="pay-num">Net</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((t, i) => {
              const label = TYPE_LABEL[t.type] ?? t.type.replace(/_/g, ' ');
              const isRefund = label === 'Refund';
              return (
                <tr key={`txn-${i}`} data-account={t.account} style={{ display: shows(t.account) ? undefined : 'none' }}>
                  <td>
                    <TrackChip account={t.account} />
                  </td>
                  <td>
                    {t.customer ? (
                      <>
                        <span className="cust">{t.customer}</span>
                        {t.ref ? <div className="cust-sub">{t.ref}</div> : null}
                      </>
                    ) : (
                      <OrderRef txn={t} />
                    )}
                  </td>
                  <td>
                    <span className="type-tag" style={isRefund ? { color: 'var(--th-danger)' } : undefined}>
                      {label}
                    </span>
                  </td>
                  <td>{fmtDate(t.created)}</td>
                  <td className={'pay-num' + (t.gross < 0 ? ' pay-neg' : '')}>{money(t.gross)}</td>
                  <td className="pay-num muted">{t.fee ? money(-t.fee) : '—'}</td>
                  <td className={'pay-num ' + (t.net < 0 ? 'pay-neg' : 'pay-pos')}>{money(t.net)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="no-match" style={{ display: txnShown ? 'none' : 'block' }}>
          No transactions for this account.
        </div>
      </div>

      {/* Payouts to bank — both accounts, account-labelled. */}
      <div className="act-section-l">Payouts to bank</div>
      <div className="pay-scroll act-divider">
        <table className="act-tbl">
          <thead>
            <tr>
              <th>Account</th>
              <th>To bank</th>
              <th>Status</th>
              <th>Date</th>
              <th className="pay-num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {payouts.map((p, i) => (
              <tr key={`pay-${i}`} data-account={p.account} style={{ display: shows(p.account) ? undefined : 'none' }}>
                <td>
                  <TrackChip account={p.account} />
                </td>
                <td>{p.bankLast4 ? `••••${p.bankLast4}` : '—'}</td>
                <td>
                  <PayoutStatus status={p.status} />
                </td>
                <td>{fmtDate(p.date)}</td>
                <td className="pay-num">{money(p.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="no-match" style={{ display: payShown ? 'none' : 'block' }}>
          No payouts for this account.
        </div>
      </div>

      <div className="act-foot">
        <a className="th-btn" href={`${BASE_PATH}/payments/transactions`}>
          View all transactions
        </a>
        <a className="th-btn" href={`${BASE_PATH}/payments/payouts`}>
          View all payouts
        </a>
      </div>
    </section>
  );
}

import { createElement } from 'react';

// Payments › Overview — the shared money-merge module.
//
// The store settles on two rails that both pay out to the same bank:
// WooPayments (the live card/wallet/BNPL rail, /woopay/*) and the direct-Stripe
// track (legacy, /payments/*). The Overview screen presents them as ONE ledger,
// so both feeds get normalised into a single row shape here, tagged with which
// account they came from, and sorted newest-first. This module is pure and
// presentational — it fetches nothing; page.tsx does every fetch and hands the
// raw endpoint arrays in. Keeping it JSX-free (createElement, not <span/>) is
// what lets the two-track colour key live in a .ts the other section components
// can import types from without pulling a client boundary along.

export type Track = 'woo' | 'stripe';

export interface MergedTxn {
  account: Track;
  customer: string | null;
  ref: string | null;
  orderId: string | null;
  type: string;
  created: number | null;
  gross: number;
  fee: number;
  net: number;
}

export interface MergedPayout {
  account: Track;
  bankLast4: string | null;
  status: string;
  date: number | null;
  amount: number;
}

export interface AcctTile {
  connected: boolean;
  available: number;
  pending: number;
  payoutsOn: boolean;
  depositLabel: string; // e.g. "Daily · 2-day delay" (woo) / "Daily" (stripe)
  instantEligible: boolean;
  instantReason: string | null; // woo only; stripe passes false/null
  feePct: number | null; // stripe only; woo passes null
  feeSample: number | null; // stripe only; woo passes null
  manageUrl: string | null; // stripe deep links (target=_blank); woo passes null
  scheduleUrl: string | null;
}

// One display name per rail, so section components never hardcode the label.
export const TRACK = { woo: { name: 'WooPayments' }, stripe: { name: 'Stripe' } } as const;

// One row of the transactions ledger from either feed. Both endpoints hand back
// the same fee/net/amount shape; only the account tag and where the reference
// comes from differ. `ref` is the fallback identifier shown when there is no
// named customer (orderNumber first, then the raw description); when a customer
// IS present, `ref` stays null and the row leans on `customer` + `orderId`.
function mapTxn(account: Track, r: any): MergedTxn {
  const customer = r.customer ?? null;
  return {
    account,
    customer,
    ref: customer ? null : (r.orderNumber || r.description || null),
    // Single order field for the ledger to show ("Order #1039"): the human order
    // number is what an operator reads, so prefer it and fall back to the
    // internal id only when the number is absent.
    orderId: r.orderNumber ?? (r.orderId != null ? String(r.orderId) : null),
    type: r.type,
    created: r.created ?? null,
    gross: r.amount,
    fee: r.fee,
    net: r.net,
  };
}

// Tag both transaction feeds, then interleave newest-first. Rows with no
// timestamp fall to the bottom (treated as epoch under a descending sort).
export function mergeTxns(woo: any[], stripe: any[]): MergedTxn[] {
  return [
    ...(woo ?? []).map((r) => mapTxn('woo', r)),
    ...(stripe ?? []).map((r) => mapTxn('stripe', r)),
  ].sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
}

// Tag both payout feeds and interleave newest-first. WooPayments deposit rows
// carry the bank as `bankAccount` (the live endpoint already flattens it to
// `bankLast4`, so read either); Stripe payouts land on `arrivalDate`, falling
// back to `created` when a payout has not been scheduled to arrive yet.
export function mergePayouts(wooDeposits: any[], stripePayouts: any[]): MergedPayout[] {
  const woo = (wooDeposits ?? []).map((r): MergedPayout => ({
    account: 'woo',
    bankLast4: r.bankAccount ?? r.bankLast4 ?? null,
    status: r.status,
    date: r.date ?? null,
    amount: r.amount,
  }));
  const stripe = (stripePayouts ?? []).map((r): MergedPayout => ({
    account: 'stripe',
    bankLast4: r.bankLast4 ?? null,
    status: r.status,
    date: r.arrivalDate ?? r.created ?? null,
    amount: r.amount,
  }));
  return [...woo, ...stripe].sort((a, b) => (b.date ?? 0) - (a.date ?? 0));
}

// The two-track colour chip carried from the hero split into the activity
// tables: <span class="track-chip chip-w"><span class="dot dot-w"></span>WooPayments</span>.
// Pure server component (no state, no effects) — built with createElement so it
// can live in this .ts alongside the shared types.
export function TrackChip({ account }: { account: Track }) {
  const woo = account === 'woo';
  return createElement(
    'span',
    { className: `track-chip ${woo ? 'chip-w' : 'chip-s'}` },
    createElement('span', { className: `dot ${woo ? 'dot-w' : 'dot-s'}` }),
    woo ? TRACK.woo.name : TRACK.stripe.name,
  );
}

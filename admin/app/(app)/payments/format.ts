// Shared formatting for the Payments & Transactions screens.
export { money } from '../../../lib/types';

/** Stripe hands back unix seconds; render them as a short calendar date. */
export function fmtDate(sec: number | null | undefined): string {
  if (!sec) return '—';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(sec * 1000));
}

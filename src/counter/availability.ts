// Whether a variant can be sold, and how many.
//
// ONE definition, used by the cart, the checkout reservation, the storefront
// and the admin. Stock is the classic place for two subtly different rules to
// drift apart: the page says "in stock", the checkout says "insufficient
// stock", and the shopper is the one who finds out.
//
// The four modes exist because counting is only right for goods that can run
// out. Print-on-demand cannot, and the workaround before this was to import POD
// lines with an inventory of 999999 — a real number in the admin that a
// merchant could edit, that meant nothing, and that would have quietly become
// 999998 on the first sale.

export type StockStatus = 'tracked' | 'in_stock' | 'out_of_stock' | 'backorder';

export interface StockLike {
  inventory: number;
  reserved: number;
  stockStatus: string;
}

/**
 * Stand-in for "as many as you like". A real number rather than Infinity so it
 * survives JSON, arithmetic and a database column — but far enough above any
 * genuine order that it cannot be mistaken for a count, unlike 999999 which
 * looked exactly like one.
 */
export const UNLIMITED = 1_000_000_000;

/** How many can be sold right now. */
export function availableOf(v: StockLike): number {
  switch (v.stockStatus) {
    case 'out_of_stock':
      return 0;
    case 'in_stock':
    case 'backorder':
      return UNLIMITED;
    default:
      // 'tracked', and anything unrecognised — counting is the safe default,
      // because it can only ever refuse a sale, never oversell one.
      return Math.max(0, v.inventory - v.reserved);
  }
}

/** True when stock is a number a merchant maintains. */
export function isTracked(v: { stockStatus: string }): boolean {
  return v.stockStatus !== 'in_stock' && v.stockStatus !== 'out_of_stock' && v.stockStatus !== 'backorder';
}

/**
 * What the storefront says about it. Backorder is deliberately NOT dressed up
 * as in-stock: someone buying a thing that ships in three weeks is entitled to
 * know before they pay, not after.
 */
export function stockLabel(v: StockLike): { label: string; sellable: boolean; low: boolean } {
  const available = availableOf(v);
  if (v.stockStatus === 'backorder') return { label: 'On backorder', sellable: true, low: false };
  if (available <= 0) return { label: 'Sold out', sellable: false, low: false };
  if (isTracked(v) && available <= 5) return { label: `Only ${available} left`, sellable: true, low: true };
  return { label: 'In stock', sellable: true, low: false };
}

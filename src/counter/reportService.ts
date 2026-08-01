import { db } from '../lib/db.js';
import { ValidationError } from '../lib/errors.js';
import { availableOf } from './availability.js';

// Counter — reports.
//
// Read-only aggregations over orders. Ported in spirit from Counter 0.45's
// Reports service.
//
// Two rules the numbers here obey, both places a naive sales report misleads:
//
//   Revenue is NET of refunds. `Order.refundedTotal` exists and a report that
//   ignores it overstates takings — the number a merchant reconciles against
//   their bank will not match, and they will trust the bank.
//
//   Only orders that represent real money are counted: processing, shipped,
//   delivered. Pending orders are abandoned checkouts and failed ones never
//   took payment; counting either inflates every figure on the page.
//
// Everything returns MINOR UNITS, like the rest of the schema. Formatting is
// the caller's job (see currency.ts) — a report service that returns
// pre-formatted strings cannot be summed.

/** Order states that represent money actually taken. */
const REVENUE_STATES = ['processing', 'shipped', 'delivered'] as const;

export interface Range {
  from: Date;
  to: Date;
}

export interface SalesSummary {
  currency: string;
  gross: number;
  refunded: number;
  net: number;
  orders: number;
  averageOrderValue: number;
  range: { from: string; to: string };
}

export interface SeriesPoint {
  date: string;
  gross: number;
  refunded: number;
  net: number;
  orders: number;
}

function assertRange(range: Range): void {
  if (!(range.from instanceof Date) || Number.isNaN(range.from.getTime())) {
    throw new ValidationError('Invalid start date.', 'from');
  }
  if (!(range.to instanceof Date) || Number.isNaN(range.to.getTime())) {
    throw new ValidationError('Invalid end date.', 'to');
  }
  if (range.from > range.to) throw new ValidationError('The start date is after the end date.', 'from');
}

export const reportService = {
  /** Headline numbers for a period. */
  async salesSummary(range: Range, currency = 'USD'): Promise<SalesSummary> {
    assertRange(range);
    const orders = await db.order.findMany({
      where: {
        status: { in: [...REVENUE_STATES] },
        currency,
        createdAt: { gte: range.from, lte: range.to },
      },
      select: { total: true, refundedTotal: true },
    });

    const gross = orders.reduce((s, o) => s + o.total, 0);
    const refunded = orders.reduce((s, o) => s + o.refundedTotal, 0);
    const net = gross - refunded;
    return {
      currency,
      gross,
      refunded,
      net,
      orders: orders.length,
      // Average of NET, and guarded — an empty period is 0, not NaN.
      averageOrderValue: orders.length === 0 ? 0 : Math.round(net / orders.length),
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
    };
  },

  /**
   * Daily series for charting. Days with no orders are present with zeroes —
   * a chart that silently skips empty days draws a misleadingly smooth line.
   */
  async salesSeries(range: Range, currency = 'USD'): Promise<SeriesPoint[]> {
    assertRange(range);
    const orders = await db.order.findMany({
      where: {
        status: { in: [...REVENUE_STATES] },
        currency,
        createdAt: { gte: range.from, lte: range.to },
      },
      select: { total: true, refundedTotal: true, createdAt: true },
    });

    const byDay = new Map<string, SeriesPoint>();
    for (let d = new Date(range.from); d <= range.to; d.setUTCDate(d.getUTCDate() + 1)) {
      const key = d.toISOString().slice(0, 10);
      byDay.set(key, { date: key, gross: 0, refunded: 0, net: 0, orders: 0 });
    }
    for (const o of orders) {
      const key = o.createdAt.toISOString().slice(0, 10);
      const point = byDay.get(key);
      if (!point) continue;
      point.gross += o.total;
      point.refunded += o.refundedTotal;
      point.net = point.gross - point.refunded;
      point.orders += 1;
    }
    return [...byDay.values()];
  },

  /**
   * Best sellers by units. Counts line items on revenue-bearing orders only,
   * so an abandoned cart never makes a product look popular.
   */
  async topProducts(range: Range, limit = 10) {
    assertRange(range);
    const items = await db.orderItem.findMany({
      where: {
        order: {
          status: { in: [...REVENUE_STATES] },
          createdAt: { gte: range.from, lte: range.to },
        },
      },
      select: {
        quantity: true,
        priceAtTime: true,
        variant: { select: { productId: true, product: { select: { name: true } } } },
      },
    });

    const totals = new Map<string, { productId: string; name: string; units: number; revenue: number }>();
    for (const i of items) {
      const productId = i.variant?.productId;
      if (!productId) continue;
      const row = totals.get(productId) ?? {
        productId,
        name: i.variant?.product?.name ?? 'Unknown product',
        units: 0,
        revenue: 0,
      };
      row.units += i.quantity;
      row.revenue += i.quantity * i.priceAtTime;
      totals.set(productId, row);
    }
    return [...totals.values()].sort((a, b) => b.units - a.units).slice(0, limit);
  },

  /**
   * Where orders are sitting right now. Includes the non-revenue states
   * deliberately — "how many are stuck pending" is the operational question
   * this answers, and excluding them would hide it.
   */
  async ordersByStatus(range: Range): Promise<Record<string, number>> {
    assertRange(range);
    const rows = await db.order.groupBy({
      by: ['status'],
      where: { createdAt: { gte: range.from, lte: range.to } },
      _count: { _all: true },
    });
    const out: Record<string, number> = {};
    for (const r of rows) out[r.status] = r._count._all;
    return out;
  },

  /** Products at or below a stock threshold, soonest to run out first. */
  async lowStock(threshold = 5, limit = 20) {
    const variants = await db.productVariant.findMany({
      where: { inventory: { lte: threshold } },
      orderBy: { inventory: 'asc' },
      take: limit,
      select: {
        id: true,
        sku: true,
        inventory: true,
        reserved: true,
        stockStatus: true,
        product: { select: { id: true, name: true, status: true } },
      },
    });
    return variants.map((v) => ({
      variantId: v.id,
      sku: v.sku,
      productId: v.product.id,
      productName: v.product.name,
      productStatus: v.product.status,
      // Reserved stock is spoken for by open carts — available is what can
      // actually still be sold, and it is the number worth alerting on.
      available: availableOf(v),
      inventory: v.inventory,
    }));
  },
};

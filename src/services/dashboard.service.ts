import { db } from '../lib/db.js';
import { redis } from '../lib/redis.js';

// Store-activity summary for the admin dashboard: orders by status, the
// checkouts that were ATTEMPTED but never completed, live abandoned carts, the
// coming-soon launch list, and where recent orders came from (attribution).
//
// This is what turns "did anyone try to buy today" into a glance instead of a
// database query. Abandoned carts and the launch list were previously written
// to and never read anywhere — this is the read side they were missing.

export interface StoreActivity {
  orders: {
    total: number;
    byStatus: Record<string, number>;
    last30d: number;
    revenue30dCents: number;
  };
  attempted: number;
  abandonedCarts: { count: number; units: number; valueCents: number };
  launchList: number;
  sources: { source: string; orders: number }[];
}

export const dashboardService = {
  async activity(): Promise<StoreActivity> {
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);

    const [grouped, total, agg30, launchList, recentMeta] = await Promise.all([
      db.order.groupBy({ by: ['status'], _count: { _all: true } }),
      db.order.count(),
      db.order.aggregate({
        where: { createdAt: { gte: since }, status: { in: ['processing', 'shipped', 'delivered'] } },
        _count: { _all: true },
        _sum: { total: true },
      }),
      db.emailSignup.count().catch(() => 0),
      db.order.findMany({ where: { createdAt: { gte: since } }, select: { meta: true } }),
    ]);

    const byStatus: Record<string, number> = {};
    for (const g of grouped) byStatus[g.status] = g._count._all;
    const last30d = await db.order.count({ where: { createdAt: { gte: since } } });

    // Attribution: first-touch source stamped onto order.meta.source at checkout.
    const sourceCounts = new Map<string, number>();
    for (const o of recentMeta) {
      const src = (o.meta as { source?: unknown } | null)?.source;
      const label = typeof src === 'string' && src.trim() ? src.trim().slice(0, 60) : 'direct / unknown';
      sourceCounts.set(label, (sourceCounts.get(label) ?? 0) + 1);
    }
    const sources = [...sourceCounts.entries()]
      .map(([source, orders]) => ({ source, orders }))
      .sort((a, b) => b.orders - a.orders)
      .slice(0, 8);

    // Live abandoned carts: any Redis cart holding items. Value is priced from
    // the current catalog (carts store only variant ids + quantities).
    let count = 0;
    let units = 0;
    const wanted = new Map<string, number>();
    let cursor = '0';
    let guard = 0;
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', 'counter:cart:*', 'COUNT', 300);
      cursor = next;
      for (const k of keys) {
        try {
          const raw = await redis.get(k);
          if (!raw) continue;
          const c = JSON.parse(raw) as { items?: { variantId: string; quantity: number }[] };
          const items = Array.isArray(c.items) ? c.items : [];
          if (!items.length) continue;
          count++;
          for (const it of items) {
            const q = Number(it.quantity) || 0;
            units += q;
            if (it.variantId) wanted.set(it.variantId, (wanted.get(it.variantId) ?? 0) + q);
          }
        } catch { /* skip a corrupt cart */ }
      }
      guard++;
    } while (cursor !== '0' && guard < 10000);

    let valueCents = 0;
    if (wanted.size) {
      const priced = await db.productVariant.findMany({ where: { id: { in: [...wanted.keys()] } }, select: { id: true, price: true } });
      for (const v of priced) valueCents += (v.price ?? 0) * (wanted.get(v.id) ?? 0);
    }

    return {
      orders: {
        total,
        byStatus,
        last30d,
        revenue30dCents: agg30._sum.total ?? 0,
      },
      // Attempted-but-unfinished checkouts: pending (mid-checkout) + failed.
      attempted: (byStatus.pending ?? 0) + (byStatus.failed ?? 0),
      abandonedCarts: { count, units, valueCents },
      launchList,
      sources,
    };
  },
};

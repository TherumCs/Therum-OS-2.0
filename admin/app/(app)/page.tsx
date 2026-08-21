import { apiGet } from '../../lib/api';
import { StudioAgentCard } from './StudioAgentCard';
import { DashboardTabs, type DashData } from './DashboardTabs';
import type { Paged, Product, Order } from '../../lib/types';

export const dynamic = 'force-dynamic';

interface ContentItem { id: string; type: string; title: string; status: string; updatedAt: string }
interface MeResponse { username: string }
interface HealthCheck { id: string; label: string; status: 'ok' | 'warn' | 'error'; detail: string }
interface HealthResponse { status: 'ok' | 'warn' | 'error'; checks: HealthCheck[] }
interface CapabilitySummary { id: string; active: string | null }
interface CustomerRow { id: string }
interface StoreActivity {
  orders: { total: number; byStatus: Record<string, number>; last30d: number; revenue30dCents: number };
  attempted: number;
  abandonedCarts: { count: number; units: number; valueCents: number };
  launchList: number;
  sources: { source: string; orders: number }[];
}

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try { return await p; } catch { return null; }
}

export default async function Dashboard() {
  const [content, prods, orders, me, health, caps, customers, activity] = await Promise.all([
    safe(apiGet<Paged<ContentItem>>('/api/content?limit=200')),
    safe(apiGet<Paged<Product>>('/api/products?limit=200')),
    safe(apiGet<Paged<Order>>('/api/orders?limit=100')),
    safe(apiGet<MeResponse>('/api/me')),
    safe(apiGet<HealthResponse>('/api/system/health')),
    safe(apiGet<CapabilitySummary[]>('/api/capabilities')),
    safe(apiGet<Paged<CustomerRow>>('/api/customers?limit=1')),
    safe(apiGet<StoreActivity>('/api/counter/activity')),
  ]);

  const commerceActive = Boolean(caps?.find((c) => c.id === 'commerce')?.active);
  const items = content?.items ?? [];
  const byType = (t: string) => items.filter((c) => c.type === t);
  const statusOf = (arr: ContentItem[]) => ({
    total: arr.length,
    published: arr.filter((c) => c.status === 'published').length,
    draft: arr.filter((c) => c.status === 'draft').length,
    recent: [...arr].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)).slice(0, 6)
      .map((c) => ({ title: c.title, updatedAt: c.updatedAt, status: c.status, type: c.type })),
  });

  const orderRows = orders?.items ?? [];
  const variantCount = (prods?.items ?? []).reduce((n, p) => n + ((p as { variants?: unknown[] }).variants?.length ?? 0), 0);

  type RawItem = { quantity: number; priceAtTime: number; variant?: { product?: { name?: string | null } | null } | null };
  const recentOrders = orderRows.slice(0, 8).map((o) => {
    const oo = o as unknown as { number: string; total: number; status: string; customer?: { name?: string | null } | null; guestEmail?: string | null; items?: RawItem[] };
    const its = (oo.items ?? []).map((it) => ({ name: it.variant?.product?.name || 'Item', qty: it.quantity, total: (it.priceAtTime ?? 0) * it.quantity }));
    return { who: oo.customer?.name || oo.guestEmail || 'Guest', number: oo.number.slice(-8), total: oo.total ?? 0, status: oo.status, items: its };
  });

  // Top sellers — aggregate real order line items by product name.
  const prodMap = new Map<string, number>();
  for (const o of orderRows) {
    for (const it of ((o as unknown as { items?: RawItem[] }).items ?? [])) {
      const name = it.variant?.product?.name || 'Item';
      prodMap.set(name, (prodMap.get(name) ?? 0) + (it.priceAtTime ?? 0) * it.quantity);
    }
  }
  const topProducts = [...prodMap.entries()].map(([name, cents]) => ({ name, cents })).sort((a, b) => b.cents - a.cents).slice(0, 5);

  const isPaid = (s: string) => s === 'processing' || s === 'shipped' || s === 'delivered';
  const paidCount = orderRows.filter((o) => isPaid((o as { status: string }).status)).length;
  const revenueCents = activity?.orders.revenue30dCents ?? 0;

  // Real monthly revenue series (from paid orders' dates) — the chart plots this.
  const monthly = new Map<string, number>();
  for (const o of orderRows) {
    const oo = o as unknown as { createdAt?: string; status: string; total: number };
    if (!isPaid(oo.status) || !oo.createdAt) continue;
    const dt = new Date(oo.createdAt);
    if (Number.isNaN(+dt)) continue;
    const key = dt.getUTCFullYear() + '-' + String(dt.getUTCMonth() + 1).padStart(2, '0');
    monthly.set(key, (monthly.get(key) ?? 0) + (oo.total ?? 0));
  }
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const revenueSeries = [...monthly.entries()].sort().slice(-8).map(([k, cents]) => ({ label: MON[Number(k.split('-')[1]) - 1] ?? k, cents }));

  const data: DashData = {
    storeName: process.env.SITE_NAME || 'Therum Store',
    commerceActive,
    pages: statusOf(byType('page')),
    posts: statusOf(byType('post')),
    contentTotal: items.length,
    mediaCount: 0,
    products: { total: prods?.total ?? prods?.items.length ?? 0, active: (prods?.items ?? []).filter((p) => p.status === 'active').length, variants: variantCount },
    topProducts,
    customers: customers?.total ?? 0,
    orders: {
      total: activity?.orders.total ?? orders?.total ?? 0,
      byStatus: activity?.orders.byStatus ?? {},
      last30d: activity?.orders.last30d ?? 0,
      revenueCents,
      aovCents: paidCount ? Math.round(revenueCents / paidCount) : 0,
      series: revenueSeries,
      recent: recentOrders,
    },
    activity: {
      attempted: activity?.attempted ?? 0,
      abandoned: { count: activity?.abandonedCarts.count ?? 0, valueCents: activity?.abandonedCarts.valueCents ?? 0 },
      launchList: activity?.launchList ?? 0,
      sources: activity?.sources ?? [],
    },
    health: {
      status: health?.status ?? 'error',
      checks: (health?.checks ?? []).map((c) => ({ label: c.label, status: c.status, detail: c.detail })),
    },
  };

  return <DashboardTabs data={data} studioAgent={<StudioAgentCard />} />;
}

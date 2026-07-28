import { apiGet } from '../../../lib/api';
import { money, type Paged, type Order } from '../../../lib/types';
import { transitionOrder } from '../../actions';
import { ListControls, ListPager, type SortOption } from '../ListControls';

export const dynamic = 'force-dynamic';

const NEXT: Record<string, string[]> = {
  pending: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  failed: [],
  cancelled: [],
};

const SORTS: SortOption[] = [
  { key: 'createdAt:desc', label: 'Newest' },
  { key: 'createdAt:asc', label: 'Oldest' },
  { key: 'number:asc', label: 'Order no. ↑' },
  { key: 'number:desc', label: 'Order no. ↓' },
  { key: 'total:desc', label: 'Largest total' },
  { key: 'total:asc', label: 'Smallest total' },
  { key: 'status:asc', label: 'Status' },
];
// Page size comes from Appearance > Lists & cards, not a constant — the
// setting existed and was saved but nothing ever read it.
const PER_PAGE_FALLBACK = 24;

async function perPage(): Promise<number> {
  const a = await apiGet<{ itemsPerPage: number }>('/api/settings/appearance').catch(() => null);
  return a?.itemsPerPage ?? PER_PAGE_FALLBACK;
}
const ORDER_STATUSES = ['pending', 'processing', 'shipped', 'delivered', 'failed', 'cancelled'] as const;

interface SP { status?: string; q?: string; sort?: string; order?: string; cursor?: string }

export default async function OrdersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const qs = new URLSearchParams({ limit: String(await perPage()) });
  if (sp.status && sp.status !== 'all') qs.set('status', sp.status);
  if (sp.q) qs.set('q', sp.q);
  if (sp.sort) qs.set('sort', sp.sort);
  if (sp.order) qs.set('order', sp.order);
  if (sp.cursor) qs.set('cursor', sp.cursor);
  const countFor = async (status?: string): Promise<number> => {
    const q = new URLSearchParams({ limit: '1' });
    if (status) q.set('status', status);
    if (sp.q) q.set('q', sp.q);
    return apiGet<Paged<Order>>(`/api/orders?${q}`).then((r) => r.total ?? 0).catch(() => 0);
  };
  const counts = Object.fromEntries(
    await Promise.all([
      countFor().then((n) => ['all', n] as const),
      ...ORDER_STATUSES.map(async (st) => [st, await countFor(st)] as const),
    ]),
  ) as Record<string, number>;
  let data: Paged<Order> | null = null;
  let err: string | null = null;
  try {
    data = await apiGet<Paged<Order>>(`/api/orders?${qs}`);
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  return (
    <section>
      <h1>Orders</h1>
      {err && <div className="notice">API offline ({err})</div>}

      <ListControls
        filters={[
          { key: 'all', label: 'All', count: counts.all },
          ...ORDER_STATUSES.map((st) => ({
            key: st,
            label: st.charAt(0).toUpperCase() + st.slice(1),
            count: counts[st] ?? 0,
          })),
        ]}
        sorts={SORTS}
        searchPlaceholder="Search by order number…"
      />

      {data && data.items.length === 0 && (
        <div className="th-lp-empty">
          <div className="th-lp-empty-title">No matches</div>
          <div className="th-lp-empty-sub">Adjust filters or clear the search.</div>
        </div>
      )}
      {data && data.items.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Order</th>
              <th>Status</th>
              <th>Payment</th>
              <th>Total</th>
              <th>Advance</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((o) => (
              <tr key={o.id}>
                <td>
                  {o.number}
                  <div className="sub">{o.items.length} item(s)</div>
                </td>
                <td>
                  <span className={'pill pill-' + o.status}>{o.status}</span>
                </td>
                <td>
                  <span className={'pill pill-' + (o.payment?.status ?? 'pending')}>{o.payment?.status ?? '—'}</span>
                </td>
                <td>{money(o.total)}</td>
                <td className="actions">
                  {(NEXT[o.status] ?? []).map((s) => (
                    <form key={s} action={transitionOrder.bind(null, o.id, s)}>
                      <button className="ghost">{s}</button>
                    </form>
                  ))}
                </td>
              </tr>
            ))}
            {!data.items.length && (
              <tr>
                <td colSpan={5} className="muted">
                  No orders yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      {data && <ListPager nextCursor={data.nextCursor ?? null} shown={data.items.length} total={data.total ?? data.items.length} />}
    </section>
  );
}

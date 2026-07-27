import { apiGet } from '../../../lib/api';
import { money, type Paged, type Order } from '../../../lib/types';
import { transitionOrder } from '../../actions';

export const dynamic = 'force-dynamic';

const NEXT: Record<string, string[]> = {
  pending: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  failed: [],
  cancelled: [],
};

export default async function OrdersPage() {
  let data: Paged<Order> | null = null;
  let err: string | null = null;
  try {
    data = await apiGet<Paged<Order>>('/api/orders?limit=50');
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  return (
    <section>
      <h1>Orders</h1>
      {err && <div className="notice">API offline ({err})</div>}
      {data && (
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
    </section>
  );
}

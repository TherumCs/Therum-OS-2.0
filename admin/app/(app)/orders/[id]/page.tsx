import { apiGet } from '../../../../lib/api';
import { BASE_PATH } from '../../../../lib/session';
import { OrderDetail, type FullOrder } from './OrderDetail';

export const dynamic = 'force-dynamic';

// The order you clicked. There was no such page: the list showed five columns
// and every row was a dead end, so the one thing you actually do with an order
// — open it, see what was bought, move it along — had nowhere to happen.
export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let order: FullOrder | null = null;
  let err: string | null = null;
  try {
    order = await apiGet<FullOrder>(`/api/orders/${id}`);
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }

  if (!order) {
    return (
      <section>
        <a href={`${BASE_PATH}/orders`} className="th-hint">← Orders</a>
        <div className="notice" style={{ marginTop: 12 }}>Could not load that order{err ? ` (${err})` : ''}.</div>
      </section>
    );
  }
  return <OrderDetail order={order} />;
}

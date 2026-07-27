import { apiGet } from '../../../lib/api';
import { money, type Paged, type Product } from '../../../lib/types';
import { createProduct } from '../../actions';

export const dynamic = 'force-dynamic';

export default async function ProductsPage() {
  let data: Paged<Product> | null = null;
  let err: string | null = null;
  try {
    data = await apiGet<Paged<Product>>('/api/products?limit=50');
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  return (
    <section>
      <h1>Products</h1>
      <form action={createProduct} className="row-form">
        <input name="name" placeholder="Product name" required />
        <input name="price" type="number" step="0.01" placeholder="Price (USD)" />
        <button type="submit">Add product</button>
      </form>
      {err && <div className="notice">API offline — start it on :4100 ({err})</div>}
      {data && (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Variants</th>
              <th>From</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((p) => (
              <tr key={p.id}>
                <td>
                  <a href={`products/${p.id}`} style={{ fontWeight: 600 }}>{p.name}</a>
                  <div className="sub">{p.slug}</div>
                </td>
                <td>
                  <span className={'pill pill-' + p.status}>{p.status}</span>
                </td>
                <td>{p.variants.length}</td>
                <td>{p.variants.length ? money(Math.min(...p.variants.map((v) => v.price))) : '—'}</td>
              </tr>
            ))}
            {!data.items.length && (
              <tr>
                <td colSpan={4} className="muted">
                  No products yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </section>
  );
}

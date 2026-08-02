import { apiGet } from '../../../lib/api';
import { BASE_PATH } from '../../../lib/session';
import { money, type Paged, type Product } from '../../../lib/types';
import { createProduct } from '../../actions';
import { ListControls, ListPager, type SortOption } from '../ListControls';
import { CatalogTabs } from './CatalogTabs';

export const dynamic = 'force-dynamic';

const SORTS: SortOption[] = [
  { key: 'updatedAt:desc', label: 'Last updated' },
  { key: 'createdAt:desc', label: 'Newest' },
  { key: 'createdAt:asc', label: 'Oldest' },
  { key: 'name:asc', label: 'Name A–Z' },
  { key: 'name:desc', label: 'Name Z–A' },
  { key: 'status:asc', label: 'Status' },
];
// Page size comes from Appearance > Lists & cards, not a constant — the
// setting existed and was saved but nothing ever read it.
const PER_PAGE_FALLBACK = 24;

async function perPage(): Promise<number> {
  const a = await apiGet<{ itemsPerPage: number }>('/api/settings/appearance').catch(() => null);
  return a?.itemsPerPage ?? PER_PAGE_FALLBACK;
}

interface SP { status?: string; q?: string; sort?: string; order?: string; cursor?: string; categoryId?: string; tagId?: string; view?: string; add?: string }

export default async function ProductsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const qs = new URLSearchParams({ limit: String(await perPage()) });
  if (sp.status && sp.status !== 'all') qs.set('status', sp.status);
  if (sp.q) qs.set('q', sp.q);
  if (sp.sort) qs.set('sort', sp.sort);
  if (sp.order) qs.set('order', sp.order);
  if (sp.cursor) qs.set('cursor', sp.cursor);
  // Arriving from the Category or Tag manager: "show me what is in this".
  // A category brings its descendants with it, so a parent never reports an
  // empty list while its children hold products.
  if (sp.categoryId) qs.set('categoryId', sp.categoryId);
  if (sp.tagId) qs.set('tagId', sp.tagId);

  let data: Paged<Product> | null = null;
  let err: string | null = null;
  try {
    data = await apiGet<Paged<Product>>(`/api/products?${qs}`);
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  const countFor = async (status?: string): Promise<number> => {
    const q = new URLSearchParams({ limit: '1' });
    if (status) q.set('status', status);
    if (sp.q) q.set('q', sp.q);
    return apiGet<Paged<Product>>(`/api/products?${q}`).then((r) => r.total ?? 0).catch(() => 0);
  };
  const [allC, activeC, draftC, archivedC] = await Promise.all([
    countFor(), countFor('active'), countFor('draft'), countFor('archived'),
  ]);
  // Name the filter when one is applied, so the list never silently shows a
  // subset that looks like the whole catalogue.
  let scopeLabel: string | null = null;
  if (sp.categoryId) {
    scopeLabel = await apiGet<{ name: string }>(`/api/catalog/categories`)
      .then((all) => (all as unknown as { id: string; name: string }[]).find((c) => c.id === sp.categoryId)?.name ?? 'category')
      .then((n) => `Category: ${n}`)
      .catch(() => 'Filtered by category');
  } else if (sp.tagId) {
    scopeLabel = await apiGet<{ id: string; name: string }[]>('/api/catalog/tags')
      .then((all) => `Tag: ${all.find((t) => t.id === sp.tagId)?.name ?? 'tag'}`)
      .catch(() => 'Filtered by tag');
  }

  // Query-string helpers that PRESERVE the current filters — a view toggle that
  // silently drops the search or the status filter is a reset button wearing a
  // different icon.
  const keep = (over: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...over })) if (v) q.set(k, String(v));
    q.delete('cursor');
    return q.toString();
  };
  const grid = sp.view === 'grid';
  const adding = sp.add === '1';
  const viewQs = (v: string) => keep({ view: v === 'list' ? undefined : v, add: undefined });
  const addQs = keep({ add: adding ? undefined : '1' });

  return (
    <section>
      {/* Title and the primary action on one line. The quick-add form used to
          sit permanently between the tabs and the filters — three rows of
          controls stacked before any product appeared, which is what made this
          page read as jumbled. */}
      <div className="th-pagehead">
        <h1>Product Catalog</h1>
        <a className="th-btn th-btn--primary" href={`${BASE_PATH}/products?${addQs}`}>
          {adding ? 'Cancel' : '+ Add product'}
        </a>
      </div>
      <CatalogTabs current="products" counts={{ products: allC }} />
      {scopeLabel && (
        <p className="th-hint" style={{ marginTop: 12 }}>
          {scopeLabel} · <a href="/products">show all products</a>
        </p>
      )}
      {adding && (
        <form action={createProduct} className="th-quickadd">
          <input name="name" placeholder="Product name" required autoFocus />
          <input name="price" type="number" step="0.01" placeholder="Price (USD)" />
          <button type="submit" className="th-btn th-btn--primary">Add product</button>
        </form>
      )}
      {err && <div className="notice">API offline — start it on :4100 ({err})</div>}

      <div className="th-listbar">
        <ListControls
          filters={[
            { key: 'all', label: 'All', count: allC },
            { key: 'active', label: 'Active', count: activeC },
            { key: 'draft', label: 'Draft', count: draftC },
            { key: 'archived', label: 'Archived', count: archivedC },
          ]}
          sorts={SORTS}
          searchPlaceholder="Search products…"
        />
        {/* Plain links, not client state: the view survives a reload and a
            shared URL, and this page stays a server component. */}
        <div className="th-viewtoggle" role="group" aria-label="View">
          <a className={grid ? '' : 'is-on'} href={`${BASE_PATH}/products?${viewQs('list')}`} aria-label="List view">☰</a>
          <a className={grid ? 'is-on' : ''} href={`${BASE_PATH}/products?${viewQs('grid')}`} aria-label="Grid view">▦</a>
        </div>
      </div>

      {data && data.items.length === 0 && (
        <div className="th-lp-empty">
          <div className="th-lp-empty-title">No matches</div>
          <div className="th-lp-empty-sub">Adjust filters or clear the search.</div>
        </div>
      )}
      {data && data.items.length > 0 && (grid ? (
        <div className="th-pgrid">
          {data.items.map((p) => (
            <a key={p.id} className="th-pcard" href={`${BASE_PATH}/products/${p.id}`}>
              <div className="th-pcard__img">
                {p.image ? <img src={p.image} alt="" loading="lazy" /> : <span className="th-pcard__ph">No image</span>}
              </div>
              <div className="th-pcard__body">
                <strong>{p.name}</strong>
                <div className="th-pcard__meta">
                  <span className={'pill pill-' + p.status}>{p.status}</span>
                  <span>{p.variants.length ? money(Math.min(...p.variants.map((v) => v.price))) : '—'}</span>
                </div>
              </div>
            </a>
          ))}
        </div>
      ) : (
        <table className="th-ptable">
          <thead>
            <tr>
              <th colSpan={2}>Product</th>
              <th>Status</th>
              <th>Variants</th>
              <th>From</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {data.items.map((p) => (
              <tr key={p.id}>
                {/* A thumbnail is the fastest way to find a product in a list
                    of caps that all read "… Snapback". */}
                <td className="th-ptable__thumbcell">
                  <span className="th-ptable__thumb">
                    {p.image ? <img src={p.image} alt="" loading="lazy" /> : null}
                  </span>
                </td>
                <td>
                  {/* BASE_PATH, not a bare /products/… — a plain <a> does not
                      get the basePath prepended the way next/link does, so an
                      absolute path here lands on the STOREFRONT. */}
                  <a href={`${BASE_PATH}/products/${p.id}`} style={{ fontWeight: 600 }}>{p.name}</a>
                  <div className="sub">{p.slug}</div>
                </td>
                <td>
                  <span className={'pill pill-' + p.status}>{p.status}</span>
                </td>
                <td>{p.variants.length}</td>
                <td>{p.variants.length ? money(Math.min(...p.variants.map((v) => v.price))) : '—'}</td>
                <td className="th-rowactions">
                  <a className="th-btn th-btn--xs" href={`${BASE_PATH}/products/${p.id}`}>Edit</a>
                  <a className="th-btn th-btn--xs" href={`/product/${p.slug}`} target="_blank" rel="noreferrer">View ↗</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
      {data && <ListPager nextCursor={data.nextCursor ?? null} shown={data.items.length} total={data.total ?? data.items.length} />}
    </section>
  );
}

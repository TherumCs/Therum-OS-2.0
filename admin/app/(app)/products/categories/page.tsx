import Link from 'next/link';
import { AssignProducts } from './AssignProducts';
import { apiGet } from '../../../../lib/api';
import { createCategory, updateCategory, deleteCategory } from '../../../actions';
import { CatalogTabs } from '../CatalogTabs';

export const dynamic = 'force-dynamic';

interface Category {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  _count?: { products: number };
}

/**
 * Categories, as a tree.
 *
 * Slugs are unique within a PARENT, not globally, so Mens > T-Shirts and
 * Womens > T-Shirts are both plain "t-shirts" — the thing WooCommerce cannot
 * do without renaming one of them to t-shirts-1. That only works if you can
 * see the tree while you build it, which is what this screen is for.
 */
function buildTree(rows: Category[]): { row: Category; depth: number; path: string }[] {
  const byParent = new Map<string | null, Category[]>();
  for (const r of rows) {
    const key = r.parentId;
    byParent.set(key, [...(byParent.get(key) ?? []), r]);
  }
  const out: { row: Category; depth: number; path: string }[] = [];
  const walk = (parentId: string | null, depth: number, prefix: string): void => {
    const kids = (byParent.get(parentId) ?? []).sort((a, b) => a.name.localeCompare(b.name));
    for (const row of kids) {
      const path = prefix ? `${prefix}/${row.slug}` : row.slug;
      out.push({ row, depth, path });
      // Depth-capped so a cycle in the data cannot hang the page render.
      if (depth < 10) walk(row.id, depth + 1, path);
    }
  };
  walk(null, 0, '');
  return out;
}

export default async function CategoriesPage() {
  let rows: Category[] = [];
  let err: string | null = null;
  try {
    rows = await apiGet<Category[]>('/api/catalog/categories');
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  const tree = buildTree(rows);
  const options = tree.map(({ row, depth, path }) => ({ id: row.id, label: `${'— '.repeat(depth)}${row.name}`, path }));

  return (
    <section>
      <h1>Product Catalog</h1>
      <CatalogTabs current="categories" counts={{ categories: rows.length }} />

      {err && <div className="notice">Could not load categories ({err})</div>}

      <form action={createCategory} className="row-form" style={{ marginTop: 18 }}>
        <input name="name" placeholder="Category name" required />
        <input name="slug" placeholder="slug (optional)" />
        <select name="parentId" defaultValue="" aria-label="Parent category">
          <option value="">Top level</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
        <button type="submit">Add category</button>
      </form>
      <p className="th-hint" style={{ marginTop: 6 }}>
        Two categories can share a name and a slug as long as they sit under different parents —
        Mens › T-Shirts and Womens › T-Shirts are both <code>t-shirts</code>, and their URLs stay clean.
      </p>

      {tree.length === 0 && !err && (
        <div className="th-lp-empty">
          <div className="th-lp-empty-title">No categories yet</div>
          <div className="th-lp-empty-sub">Add a top-level one above, then nest under it.</div>
        </div>
      )}

      {tree.length > 0 && (
        <table style={{ marginTop: 18 }}>
          <thead>
            <tr>
              <th>Category</th>
              <th>URL</th>
              <th>Products</th>
              <th>Move to</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tree.map(({ row, depth, path }) => (
              <tr key={row.id}>
                <td>
                  <form action={updateCategory} className="th-inline-form">
                    <input type="hidden" name="id" value={row.id} />
                    <span style={{ display: 'inline-block', width: depth * 18 }} aria-hidden="true" />
                    <input name="name" defaultValue={row.name} aria-label={`Name of ${row.name}`} />
                    <input name="slug" defaultValue={row.slug} aria-label={`Slug of ${row.name}`} style={{ maxWidth: 150 }} />
                    <button type="submit" className="th-btn">Rename</button>
                  </form>
                </td>
                <td>
                  <a href={`/c/${path}`} target="_blank" rel="noreferrer"><code>/c/{path}</code></a>
                </td>
                <td>
                  {/* Counts and this link both include DESCENDANTS, so a parent
                      never reports 0 while its children hold stock. */}
                  <Link href={`/products?categoryId=${row.id}`}>
                    {row._count?.products ?? 0} product{(row._count?.products ?? 0) === 1 ? '' : 's'}
                  </Link>
                  {/* Pull products INTO this category from here — the reverse
                      of tagging a product with a category in the editor. */}
                  <div style={{ marginTop: 4 }}>
                    <AssignProducts kind="categories" termId={row.id} termName={row.name} />
                  </div>
                </td>
                <td>
                  <form action={updateCategory} className="th-inline-form">
                    <input type="hidden" name="id" value={row.id} />
                    <select name="parentId" defaultValue={row.parentId ?? ''} aria-label={`Parent of ${row.name}`}>
                      <option value="">Top level</option>
                      {options
                        .filter((o) => o.id !== row.id)
                        .map((o) => (
                          <option key={o.id} value={o.id}>{o.label}</option>
                        ))}
                    </select>
                    <button type="submit" className="th-btn">Move</button>
                  </form>
                </td>
                <td>
                  <form action={deleteCategory}>
                    <input type="hidden" name="id" value={row.id} />
                    {/* Children re-root instead of vanishing, and products keep
                        existing — only the link goes. */}
                    <button type="submit" className="th-btn th-btn-danger">Delete</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

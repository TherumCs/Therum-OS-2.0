import Link from 'next/link';
import { apiGet } from '../../../../lib/api';
import { createTag, deleteTag } from '../../../actions';
import { CatalogTabs } from '../CatalogTabs';

export const dynamic = 'force-dynamic';

interface Tag {
  id: string;
  name: string;
  slug: string;
  _count?: { products: number };
}

/**
 * Tags — flat by design.
 *
 * Categories answer "where does this live" and nest; tags answer "what is this
 * like" and do not. A tag tree is the usual way a catalogue turns into two
 * competing hierarchies that disagree with each other.
 */
export default async function TagsPage() {
  let rows: Tag[] = [];
  let err: string | null = null;
  try {
    rows = await apiGet<Tag[]>('/api/catalog/tags');
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <section>
      <h1>Product Catalog</h1>
      <CatalogTabs current="tags" counts={{ tags: rows.length }} />

      {err && <div className="notice">Could not load tags ({err})</div>}

      <form action={createTag} className="row-form" style={{ marginTop: 18 }}>
        <input name="name" placeholder="Tag name" required />
        <input name="slug" placeholder="slug (optional)" />
        <button type="submit">Add tag</button>
      </form>

      {sorted.length === 0 && !err && (
        <div className="th-lp-empty">
          <div className="th-lp-empty-title">No tags yet</div>
          <div className="th-lp-empty-sub">Tags cut across categories — “new-in”, “sale”, “limited”.</div>
        </div>
      )}

      {sorted.length > 0 && (
        <table style={{ marginTop: 18 }}>
          <thead>
            <tr>
              <th>Tag</th>
              <th>URL</th>
              <th>Products</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sorted.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td>
                  <a href={`/t/${t.slug}`} target="_blank" rel="noreferrer"><code>/t/{t.slug}</code></a>
                </td>
                <td>
                  <Link href={`/products?tagId=${t.id}`}>
                    {t._count?.products ?? 0} product{(t._count?.products ?? 0) === 1 ? '' : 's'}
                  </Link>
                </td>
                <td>
                  <form action={deleteTag}>
                    <input type="hidden" name="id" value={t.id} />
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

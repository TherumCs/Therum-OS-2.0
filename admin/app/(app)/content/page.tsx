import { apiGet, authToken, builderEditUrl } from '../../../lib/api';
import { createContent, setContentStatus } from '../../actions';

interface ContentItem {
  id: string;
  type: string;
  title: string;
  slug: string;
  status: string;
}
interface Paged {
  items: ContentItem[];
  nextCursor: string | null;
}

export const dynamic = 'force-dynamic';

// case_study deliberately omitted — it's the future Portfolio/Studio-addon
// content type (see admin/lib/nav.ts), not user-facing until that addon is
// actually built and turned on. Keep this route (it's what that nav item
// will point at), just don't let it be created/browsed from here yet.
const TYPES: [string, string][] = [
  ['', 'All'],
  ['page', 'Pages'],
  ['post', 'Blog'],
];

export default async function ContentPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const type = (await searchParams).type ?? '';
  let data: Paged | null = null;
  let err: string | null = null;
  const token = await authToken();
  try {
    data = await apiGet<Paged>('/api/content' + (type ? `?type=${type}` : ''));
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  return (
    <section>
      <h1>
        Content <span className="muted" style={{ fontSize: 'var(--th-fs-sm)', fontWeight: 400 }}>· Folio</span>
      </h1>
      <div className="actions" style={{ marginBottom: 'var(--th-space-14)' }}>
        {TYPES.map(([v, l]) => (
          <a key={v} href={'/content' + (v ? `?type=${v}` : '')} className="pill" style={type === v ? { background: 'var(--th-accent)', color: '#fff' } : undefined}>
            {l}
          </a>
        ))}
      </div>
      <form action={createContent} className="row-form">
        <input name="title" placeholder="Title" required />
        <select name="type" style={{ padding: 'var(--th-space-8) var(--th-space-10)', border: '1px solid var(--th-line)', borderRadius: 'var(--th-r)', fontSize: 'var(--th-fs-sm)' }}>
          <option value="page">Page</option>
          <option value="post">Blog post</option>
        </select>
        <button type="submit">New</button>
      </form>
      {err && <div className="notice">API offline ({err})</div>}
      {data && (
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Type</th>
              <th>Status</th>
              <th>Slug</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((c) => (
              <tr key={c.id}>
                <td>{c.title}</td>
                <td>
                  <span className="muted">{c.type.replace('_', ' ')}</span>
                </td>
                <td>
                  <span className={'pill pill-' + (c.status === 'published' ? 'ok' : c.status === 'archived' ? 'archived' : 'pending')}>{c.status}</span>
                </td>
                <td className="muted">/{c.slug}</td>
                <td className="actions">
                  <a href={builderEditUrl(c.id, token)} target="_blank" rel="noopener" className="pill" style={{ padding: 'var(--th-space-6) var(--th-space-10)' }}>
                    Edit ↗
                  </a>
                  {c.status === 'published' ? (
                    <form action={setContentStatus.bind(null, c.id, 'draft')}>
                      <button className="ghost">Unpublish</button>
                    </form>
                  ) : (
                    <form action={setContentStatus.bind(null, c.id, 'published')}>
                      <button>Publish</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {!data.items.length && (
              <tr>
                <td colSpan={5} className="muted">
                  No content yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </section>
  );
}

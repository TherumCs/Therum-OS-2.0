import { apiGet, authToken, builderEditUrl } from '../../lib/api';
import { BASE_PATH } from '../../lib/session';
import { ContentCard, type ContentCardItem } from './ContentCard';
import { ListControls, ListPager, type SortOption } from './ListControls';
import { ListViewSwitch } from './ListViewSwitch';
import { resolveListView } from './listViews';
import { NewContentButton } from './NewContentButton';

interface Paged {
  items: ContentCardItem[];
  nextCursor: string | null;
  total: number;
}

// Shared list page for the three content types (page / post / case_study).
// Filtering, search, sorting and paging are all server-side now: this reads
// them off the URL and forwards them to the API, so they apply to every row
// rather than to whichever rows happened to fit in the first fetch.
const SORTS: SortOption[] = [
  { key: 'updatedAt:desc', label: 'Last updated' },
  { key: 'updatedAt:asc', label: 'Least recently updated' },
  { key: 'createdAt:desc', label: 'Newest' },
  { key: 'createdAt:asc', label: 'Oldest' },
  { key: 'title:asc', label: 'Title A–Z' },
  { key: 'title:desc', label: 'Title Z–A' },
  { key: 'publishedAt:desc', label: 'Recently published' },
  { key: 'status:asc', label: 'Status' },
];

// Page size comes from Appearance > Lists & cards, not a constant — the
// setting existed and was saved but nothing ever read it.
const PER_PAGE_FALLBACK = 24;

interface ListPrefs { itemsPerPage: number; thumbnailSource: string }
const LIST_PREF_FALLBACK: ListPrefs = { itemsPerPage: PER_PAGE_FALLBACK, thumbnailSource: 'auto' };

async function listPrefs(): Promise<ListPrefs> {
  return apiGet<ListPrefs>('/api/settings/appearance').catch(() => LIST_PREF_FALLBACK);
}

export interface ListSearchParams {
  status?: string;
  q?: string;
  sort?: string;
  order?: string;
  cursor?: string;
  view?: string;
}

export async function ContentTypeListPage({
  type,
  label,
  singularLabel,
  sub,
  searchPlaceholder,
  emptyTitle,
  emptySub,
  showImport = false,
  searchParams,
}: {
  type: 'page' | 'post' | 'case_study';
  label: string;
  singularLabel: string;
  sub: string;
  searchPlaceholder: string;
  emptyTitle: string;
  emptySub: string;
  showImport?: boolean;
  searchParams: ListSearchParams;
}) {
  const prefs = await listPrefs();
  const qs = new URLSearchParams({ type, limit: String(prefs.itemsPerPage) });
  if (searchParams.status && searchParams.status !== 'all') qs.set('status', searchParams.status);
  if (searchParams.q) qs.set('q', searchParams.q);
  if (searchParams.sort) qs.set('sort', searchParams.sort);
  if (searchParams.order) qs.set('order', searchParams.order);
  if (searchParams.cursor) qs.set('cursor', searchParams.cursor);

  let data: Paged = { items: [], nextCursor: null, total: 0 };
  let err: string | null = null;
  let token = '';
  try {
    [data, token] = await Promise.all([apiGet<Paged>(`/api/content?${qs}`), authToken()]);
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }

  // Pill counts describe the whole type, not the current filter — otherwise
  // the active pill would always read the same number as the result set.
  let counts = { all: 0, published: 0, draft: 0 };
  try {
    const base = new URLSearchParams({ type, limit: '1' });
    if (searchParams.q) base.set('q', searchParams.q);
    const [all, pub, draft] = await Promise.all([
      apiGet<Paged>(`/api/content?${base}`),
      apiGet<Paged>(`/api/content?${base}&status=published`),
      apiGet<Paged>(`/api/content?${base}&status=draft`),
    ]);
    counts = { all: all.total, published: pub.total, draft: draft.total };
  } catch {
    /* counts are cosmetic — a failure here must not blank the list */
  }

  const items = data.items.map((i) => ({
    ...i,
    editUrl: builderEditUrl(i.id, token),
    caseStudyDetails: type === 'case_study',
  }));
  const view = resolveListView(searchParams.view);
  const countLabel = (counts.all === 1 ? singularLabel : label).toUpperCase();
  const filtering = Boolean(searchParams.q || (searchParams.status && searchParams.status !== 'all'));

  return (
    <section>
      <div className="th-lp-header">
        <div className="th-lp-header-left">
          <div className="th-lp-meta">
            <span className="th-lp-meta-dot" />
            {counts.all} {countLabel} · {counts.draft} DRAFTS
          </div>
          <h1 className="th-lp-title">{label}</h1>
          <p className="th-lp-sub">{sub}</p>
        </div>
        <div className="th-lp-actions">
          {showImport && (
            <a className="th-btn" href={`${BASE_PATH}/import`}>
              Import
            </a>
          )}
          <NewContentButton type={type} label={singularLabel} />
        </div>
      </div>

      {err && <div className="notice">API offline ({err})</div>}

      <ListControls
        filters={[
          { key: 'all', label: 'All', count: counts.all },
          { key: 'published', label: 'Published', count: counts.published },
          { key: 'draft', label: 'Drafts', count: counts.draft },
        ]}
        sorts={SORTS}
        searchPlaceholder={searchPlaceholder}
        trailing={<ListViewSwitch view={view} />}
      />

      {items.length ? (
        <>
          <div className={`th-lp-list th-lp-list-${view}`}>
            {items.map((item) => (
              <ContentCard key={item.id} item={item} variant={view} thumbnailSource={prefs.thumbnailSource} />
            ))}
          </div>
          <ListPager nextCursor={data.nextCursor} shown={items.length} total={data.total} />
        </>
      ) : (
        <div className="th-lp-empty">
          <div className="th-lp-empty-title">{filtering ? 'No matches' : emptyTitle}</div>
          <div className="th-lp-empty-sub">{filtering ? 'Adjust filters or clear the search.' : emptySub}</div>
        </div>
      )}
    </section>
  );
}

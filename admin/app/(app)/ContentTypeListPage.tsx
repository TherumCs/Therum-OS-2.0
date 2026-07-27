import { apiGet, authToken, builderEditUrl } from '../../lib/api';
import { BASE_PATH } from '../../lib/session';
import { NewContentButton } from './NewContentButton';
import { ListPageToolbar, type FilterPill } from './ListPageToolbar';
import type { ContentCardItem } from './ContentCard';

type RawContentItem = Omit<ContentCardItem, 'editUrl'>;
interface Paged {
  items: RawContentItem[];
}

export interface ContentTypeListPageProps {
  type: 'page' | 'post' | 'case_study';
  label: string; // plural, e.g. "Pages"
  singularLabel: string; // e.g. "Page"
  sub: string;
  searchPlaceholder: string;
  emptyTitle: string;
  emptySub: string;
  showImport?: boolean;
}

// Shared by pages/, posts/, and case-studies/ page.tsx — near-identical
// surfaces (same fetch, same card grid, same toolbar), differing only in
// copy and the `type` filter. case_study became the third caller when the
// Case Studies Studio App shipped (2026-07-23).
export async function ContentTypeListPage({ type, label, singularLabel, sub, searchPlaceholder, emptyTitle, emptySub, showImport }: ContentTypeListPageProps) {
  let items: ContentCardItem[] = [];
  let err: string | null = null;
  try {
    const [data, token] = await Promise.all([apiGet<Paged>(`/api/content?type=${type}&limit=100`), authToken()]);
    items = data.items.map((i) => ({ ...i, editUrl: builderEditUrl(i.id, token), caseStudyDetails: type === 'case_study' }));
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }

  const published = items.filter((i) => i.status === 'published').length;
  const draft = items.filter((i) => i.status === 'draft').length;
  const filters: FilterPill[] = [
    { key: 'all', label: 'All', count: items.length },
    { key: 'published', label: 'Published', count: published },
    { key: 'draft', label: 'Drafts', count: draft },
  ];
  const countLabel = (items.length === 1 ? singularLabel : label).toUpperCase();

  return (
    <section>
      <div className="th-lp-header">
        <div className="th-lp-header-left">
          <div className="th-lp-meta">
            <span className="th-lp-meta-dot" />
            {items.length} {countLabel} · {draft} DRAFTS
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
      <ListPageToolbar items={items} filters={filters} searchPlaceholder={searchPlaceholder} emptyTitle={emptyTitle} emptySub={emptySub} />
    </section>
  );
}

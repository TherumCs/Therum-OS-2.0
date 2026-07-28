import { apiGet } from '../../../lib/api';
import { type MediaItem } from './MediaTable';
import { MediaUploadButton } from './MediaUploadButton';
import { BulkRenameButton } from './BulkRenameButton';
import { MediaLibrary } from './MediaLibrary';

interface Paged {
  items: MediaItem[];
  nextCursor: string | null;
  total: number;
}

interface MediaSearchParams {
  kind?: string;
  q?: string;
  sort?: string;
  order?: string;
  cursor?: string;
}

// Page size comes from Appearance > Lists & cards, not a constant — the
// setting existed and was saved but nothing ever read it.
const PER_PAGE_FALLBACK = 48;

async function perPage(): Promise<number> {
  const a = await apiGet<{ itemsPerPage: number }>('/api/settings/appearance').catch(() => null);
  return a?.itemsPerPage ?? PER_PAGE_FALLBACK;
}

interface Me {
  mediaViewMode: string;
  mediaDensity: number;
}

export const dynamic = 'force-dynamic';

function formatTotalSize(bytesTotal: number): string {
  if (bytesTotal < 1024 * 1024) return `${(bytesTotal / 1024).toFixed(0)} KB`;
  return `${(bytesTotal / (1024 * 1024)).toFixed(0)} MB`;
}

export default async function MediaPage({ searchParams }: { searchParams: Promise<MediaSearchParams> }) {
  const sp = await searchParams;
  const qs = new URLSearchParams({ limit: String(await perPage()) });
  if (sp.kind && sp.kind !== 'all') qs.set('kind', sp.kind);
  if (sp.q) qs.set('q', sp.q);
  if (sp.sort) qs.set('sort', sp.sort);
  if (sp.order) qs.set('order', sp.order);
  if (sp.cursor) qs.set('cursor', sp.cursor);

  let page: Paged = { items: [], nextCursor: null, total: 0 };
  let err: string | null = null;
  try {
    page = await apiGet<Paged>(`/api/media?${qs}`);
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  const items = page.items;
  const me = await apiGet<Me>('/api/me').catch((): Me => ({ mediaViewMode: '', mediaDensity: 5 }));
  // Appearance > Lists & cards sets the default view; the per-user Media view
  // switch overrides it once used. Previously the fallback was hardcoded to
  // 'grid', so the setting was saved and never read.
  const appearance = await apiGet<{ listViewDefault: string; thumbnailSource: string }>('/api/settings/appearance')
    .catch(() => ({ listViewDefault: 'grid', thumbnailSource: 'auto' }));
  const viewMode = me.mediaViewMode || appearance.listViewDefault;

  const totalSize = items.reduce((sum, i) => sum + (i.size ?? 0), 0);
  // Kind counts describe the WHOLE library, not the page being shown — a
  // count that changes when you paginate is worse than no count.
  const countFor = async (kind?: string): Promise<number> => {
    const q = new URLSearchParams({ limit: '1' });
    if (kind) q.set('kind', kind);
    if (sp.q) q.set('q', sp.q);
    return apiGet<Paged>(`/api/media?${q}`).then((r) => r.total).catch(() => 0);
  };
  const [allC, imageC, videoC, audioC, fileC] = await Promise.all([
    countFor(), countFor('image'), countFor('video'), countFor('audio'), countFor('file'),
  ]);
  const filters = [
    { key: 'all', label: 'All', count: allC },
    { key: 'image', label: 'Images', count: imageC },
    { key: 'video', label: 'Video', count: videoC },
    { key: 'audio', label: 'Audio', count: audioC },
    { key: 'file', label: 'Documents', count: fileC },
  ];
  const filtering = Boolean(sp.q || (sp.kind && sp.kind !== 'all'));

  return (
    <section>
      <div className="th-lp-header">
        <div className="th-lp-header-left">
          <div className="th-lp-meta">
            <span className="th-lp-meta-dot" />
            {allC} FILES · {formatTotalSize(totalSize)} on this page
          </div>
          <h1 className="th-lp-title">Media</h1>
          <p className="th-lp-sub">Images, video, audio, and documents in the media library.</p>
        </div>
        <div className="th-lp-actions">
          <BulkRenameButton items={items} />
          <MediaUploadButton />
        </div>
      </div>

      {err && <div className="notice">API offline ({err})</div>}
      <MediaLibrary
        items={items}
        filters={filters}
        filtering={filtering}
        nextCursor={page.nextCursor}
        total={page.total}
        initialViewMode={viewMode}
        initialDensity={me.mediaDensity}
      />
    </section>
  );
}

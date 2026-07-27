import { apiGet } from '../../../lib/api';
import { type MediaItem } from './MediaTable';
import { MediaUploadButton } from './MediaUploadButton';
import { BulkRenameButton } from './BulkRenameButton';
import { MediaLibrary } from './MediaLibrary';

interface Paged {
  items: MediaItem[];
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

export default async function MediaPage() {
  let items: MediaItem[] = [];
  let err: string | null = null;
  try {
    const data = await apiGet<Paged>('/api/media?limit=100');
    items = data.items;
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  const me = await apiGet<Me>('/api/me').catch((): Me => ({ mediaViewMode: 'grid', mediaDensity: 5 }));

  const totalSize = items.reduce((sum, i) => sum + (i.size ?? 0), 0);
  const counts = { image: 0, video: 0, audio: 0, file: 0 };
  items.forEach((i) => {
    if (i.kind in counts) counts[i.kind as keyof typeof counts]++;
  });
  const filters = [
    { key: 'all', label: 'All', count: items.length },
    { key: 'image', label: 'Images', count: counts.image },
    { key: 'video', label: 'Video', count: counts.video },
    { key: 'audio', label: 'Audio', count: counts.audio },
    { key: 'file', label: 'Documents', count: counts.file },
  ];

  return (
    <section>
      <div className="th-lp-header">
        <div className="th-lp-header-left">
          <div className="th-lp-meta">
            <span className="th-lp-meta-dot" />
            {items.length} FILES · {formatTotalSize(totalSize)}
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
      <MediaLibrary items={items} filters={filters} initialViewMode={me.mediaViewMode} initialDensity={me.mediaDensity} />
    </section>
  );
}

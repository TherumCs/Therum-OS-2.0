import { MediaRow } from './MediaRow';

export interface MediaItem {
  id: string;
  url: string;
  alt: string | null;
  kind: string;
  size: number | null;
  width?: number | null;
  height?: number | null;
  createdAt: string;
  meta?: { thumbnailUrl?: string } | null;
}

// The table pane — MediaLibrary owns the toolbar/filtering/view-switching
// now and hands this already-filtered items list straight through.
export function MediaTable({ items }: { items: MediaItem[] }) {
  return (
    <table className="th-lp-table">
      <thead>
        <tr>
          <th>File</th>
          <th>Alt text</th>
          <th>Type</th>
          <th>Size</th>
          <th>Uploaded</th>
          <th aria-label="Actions" />
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <MediaRow key={item.id} item={item} />
        ))}
      </tbody>
    </table>
  );
}

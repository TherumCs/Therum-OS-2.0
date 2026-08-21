// Small presentational helpers shared by MediaCard, MediaRow, and MediaLibrary
// — was duplicated per-component before the grid/masonry view added a third
// call site for each.
export function filename(url: string): string {
  return url.split('/').pop() ?? url;
}

export function formatSize(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

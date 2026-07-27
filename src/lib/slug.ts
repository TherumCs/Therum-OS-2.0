// Shared by content.service.ts (post/page slugs) and media.service.ts (rename
// engine) — was a private copy inside content.service.ts; media's rename
// needs the identical logic, so it moved here rather than getting a second copy.
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 240);
}

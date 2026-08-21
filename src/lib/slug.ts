// THE slugifier. Was duplicated four times with divergent length caps (240,
// 200, 80) — one identity generator that quietly disagreed with itself by
// domain. The cap is a parameter so every caller keeps its own limit while
// sharing one implementation: products/content/media 240, imports 200,
// taxonomy 80.
export function slugify(input: string, maxLen = 240): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen);
}

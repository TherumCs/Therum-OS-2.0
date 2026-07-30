import { db } from '../lib/db.js';

// Category paths.
//
// A category slug is unique only within its parent (see the note on
// ProductCategory in schema.prisma), so a slug on its own no longer identifies
// anything: "t-shirts" may exist under Mens AND under Womens. Everything here
// works in terms of the PATH — the chain of slugs from the root — because that
// is what is actually unique, and it is what the URL already looks like.
//
// Depth is not capped. Two levels is the common case (Mens > T-Shirts) and
// Accessories goes three (Mens > Accessories > Hats); nothing here counts
// segments, so a fourth level costs no code.

export interface CategoryNode {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
}

/** `mens/accessories/hats` → the Hats category, or null. */
export async function resolveCategoryPath(segments: string[]): Promise<CategoryNode | null> {
  const clean = segments.map((s) => s.trim()).filter(Boolean);
  if (!clean.length) return null;

  // Walked one segment at a time, each scoped to the parent found by the last.
  // THE PARENT CHECK IS THE POINT: without it /c/womens/t-shirts would happily
  // serve the Mens t-shirts page, so two URLs would return identical content
  // and compete with each other in search results.
  let parentId: string | null = null;
  let node: CategoryNode | null = null;
  for (const slug of clean) {
    node = await db.productCategory.findFirst({
      where: { slug, parentId },
      select: { id: true, name: true, slug: true, parentId: true },
    });
    if (!node) return null;
    parentId = node.id;
  }
  return node;
}

/**
 * A category and everything beneath it.
 *
 * `/c/mens` must list the products in Mens > T-Shirts too. A shopper clicking
 * "Mens" and getting an empty page because every product is filed one level
 * down is the single most common way a category tree goes wrong.
 */
export async function categoryAndDescendantIds(id: string): Promise<string[]> {
  const out = [id];
  let frontier = [id];
  for (let depth = 0; frontier.length && depth < 12; depth += 1) {
    const kids: { id: string }[] = await db.productCategory.findMany({
      where: { parentId: { in: frontier } },
      select: { id: true },
    });
    frontier = kids.map((k) => k.id).filter((k) => !out.includes(k));
    out.push(...frontier);
  }
  return out;
}

/**
 * Every category that has products, as `{ id, name, slug, path, label }`.
 *
 * `label` is the breadcrumb ("Mens › T-Shirts") because a filter list showing
 * two entries both called "T-Shirts" is useless — which is exactly what a flat
 * name list becomes once slugs are parent-scoped.
 */
export async function categoryFacets(): Promise<
  { id: string; name: string; slug: string; path: string; label: string }[]
> {
  const rows = await db.productCategory.findMany({
    select: { id: true, name: true, slug: true, parentId: true },
    orderBy: { name: 'asc' },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const labelOf = (r: (typeof rows)[number]): string => {
    const names: string[] = [];
    let cursor: typeof r | undefined = r;
    for (let depth = 0; cursor && depth < 12; depth += 1) {
      names.unshift(cursor.name);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
    return names.join(' › ');
  };
  const pathOf = (r: (typeof rows)[number]): string => {
    const slugs: string[] = [];
    let cursor: typeof r | undefined = r;
    for (let depth = 0; cursor && depth < 12; depth += 1) {
      slugs.unshift(cursor.slug);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
    return slugs.join('/');
  };
  return rows.map((r) => ({ id: r.id, name: r.name, slug: r.slug, path: pathOf(r), label: labelOf(r) }));
}

/**
 * Resolve for a FILTER value, which is more forgiving than a URL.
 *
 * `/c/mens/t-shirts` must be strict — the path is the identity of the page, and
 * accepting a bare "t-shirts" there would serve one category at two URLs.
 * `?category=` is not an identity, it is a control: it comes from a link
 * somebody saved, from the toolbar, or from a hand-edited URL. So a full path
 * is tried first, and a bare slug is accepted when it names exactly ONE
 * category. Two categories called "t-shirts" is ambiguous, and rather than pick
 * one it resolves to nothing — guessing would silently show the wrong products.
 */
export async function resolveCategoryFilter(value: string): Promise<CategoryNode | null> {
  const segments = value.split('/').filter(Boolean);
  if (!segments.length) return null;

  const byPath = await resolveCategoryPath(segments);
  if (byPath) return byPath;
  if (segments.length > 1) return null;

  const matches = await db.productCategory.findMany({
    where: { slug: segments[0] },
    select: { id: true, name: true, slug: true, parentId: true },
    take: 2,
  });
  return matches.length === 1 ? matches[0] ?? null : null;
}

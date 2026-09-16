import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// Per-category page content — which template a top-level category renders, plus
// its hero tagline and the intro below the grid. Keyed by top-level slug.
//
// Voice, from the brand guide: "Revolutionary but never preachy.
// Streetwise, philosophical, emotionally intelligent… poetry, not a megaphone."
// Inspirations: Basquiat, Baldwin, early Jay-Z, Adult Swim bumps. Money is the
// lens on ownership, access, class, freedom — a modern Robin Hood built on the
// hustle. Short, layered, meaningful. No hype, no cliché, no invented facts.
// Use the store's brand name consistently, exactly as the brand guide sets it.
//
// template: 'grid' → Template 1 (departments) · 'collection' → Template 2 (lines)

export interface CategoryPage {
  template: 'grid' | 'collection';
  tagline?: string;
  blurbTitle?: string;
  blurb?: string;
  heroImage?: string | null;
  /** Light-background hero (studio/cream shot): dark title, no dark scrim. */
  heroLight?: boolean;
  /** Self-contained header art: the title/logo are baked INTO the image, so the
   *  hero renders as the image alone — no scrim, no overlaid <h1>/tagline/logo. */
  heroBare?: boolean;
  /** A logo image centered over the hero image (keeps the text title/tagline). */
  heroLogo?: string;
  /** CSS background-position for the hero image (default 'center 30%'). Set e.g.
   *  'center bottom' to show the lower part of the shot instead of the top. */
  heroPos?: string;
  /** Grid columns for THIS page, overriding the store-wide toolbar columns.
   *  Set e.g. 3 for a smaller collection that reads better three-up. */
  columns?: number;
  /** Template 1: editorial shots woven between product rows, in order. */
  editorial?: string[];
  /** Landing-page product callouts (Zappos-style story blocks): a numbered beat
   *  with an eyebrow + big title + body + spec rows + CTA on one side and the
   *  product image on the other, sides alternating. Built for jersey storytelling
   *  on the seasonal pages — the story behind each piece. Rendered right after the
   *  hero, above the product grid, on 'grid' pages. Missing image → a labelled
   *  placeholder panel (never a broken box), so a page can be laid out before the
   *  art exists. */
  callouts?: {
    index?: string;
    eyebrow?: string;
    title: string;
    body: string;
    image?: string;
    specs?: { label: string; value: string }[];
    ctaLabel?: string;
    ctaHref?: string;
  }[];
  /** Varied story sections (Kith-style), rendered in order after the callouts,
   *  above the grid. Breaks the uniform grid + carries the collection narrative.
   *  band = full-bleed image beat; split = wide image + copy (half/two-thirds);
   *  story = centred text beat. Every image optional → labelled placeholder. */
  sections?: Array<
    | { type: 'band'; image?: string; video?: string; center?: boolean; eyebrow?: string; title?: string; body?: string; ctaLabel?: string; ctaHref?: string; light?: boolean }
    | { type: 'split'; image?: string; media?: 'left' | 'right'; ratio?: 'half' | 'twothird'; eyebrow?: string; title: string; body: string; ctaLabel?: string; ctaHref?: string }
    | { type: 'story'; eyebrow?: string; title: string; body: string; ctaLabel?: string; ctaHref?: string }
  >;
  /** Show a horizontal "featured / in the collection" product rail between the
   *  jersey carousel and the full grid. Pulls this category's own products;
   *  falls back to placeholder cards while the collection is empty. */
  featuredRail?: boolean;
  /** Template 2: intro / concept copy. Falls back to `blurb` when absent. */
  intro?: { title?: string; body: string };
  /** Template 2: big lookbook shot beside the first two hero products. */
  lookbook?: string;
  /** Template 2: alternating copy + shot story blocks. */
  story?: { title: string; body: string; image?: string }[];
}

/**
 * Category landing pages come from the SITE PACK, not from this codebase:
 * `${SITE_PACK_DIR}/categoryPages.json` — a map of category slug → CategoryPage.
 * Therum OS ships no store's copy; a merchant's editorial lives with the
 * merchant (for the first store: the TSC-BETA instance repo, deployed to the box).
 * Missing file or unset env = no landings, which is a valid install.
 */
export const CATEGORY_PAGES: Record<string, CategoryPage> = loadSitePackCategoryPages();

function loadSitePackCategoryPages(): Record<string, CategoryPage> {
  const dir = process.env.SITE_PACK_DIR;
  if (!dir) return {};
  try {
    const parsed = JSON.parse(readFileSync(join(dir, 'categoryPages.json'), 'utf8')) as Record<string, CategoryPage>;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function categoryPageFor(slug: string | undefined): CategoryPage | undefined {
  if (!slug) return undefined;
  return CATEGORY_PAGES[slug];
}

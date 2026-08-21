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
  /** Template 2: intro / concept copy. Falls back to `blurb` when absent. */
  intro?: { title?: string; body: string };
  /** Template 2: big lookbook shot beside the first two hero products. */
  lookbook?: string;
  /** Template 2: alternating copy + shot story blocks. */
  story?: { title: string; body: string; image?: string }[];
}

export const CATEGORY_PAGES: Record<string, CategoryPage> = {
  // ── Template 1 · departments ──
  mens: {
    template: 'grid',
    tagline: 'The full line, in men’s cuts.',
    blurbTitle: 'Men’s',
    blurb: 'From the quiet Essentials to the loudest Narrative pieces. The whole conversation, your size.',
    heroImage: '/api/uploads/b29f3161-08de-4e1f-b304-b93338db845c-mens-category-hero.png',
    editorial: ['/api/uploads/bd2e09d9-9c5a-416b-b30d-8c19f03c21ba-mens-editorial-blue.webp'],
  },
  womens: {
    template: 'grid',
    tagline: 'The full line, in women’s cuts.',
    blurbTitle: 'Women’s',
    blurb: 'From the quiet Essentials to the loudest Narrative pieces. The whole conversation, your size.',
    heroImage: '/api/uploads/3571b2fa-3fa0-4127-a50f-242e7ec9a6bc-womens-category-hero.webp',
    editorial: ['/api/uploads/8370abc1-4dec-485c-a153-c93cbb3037d0-womens-editorial-money-wallet.webp'],
  },
  'play-money': {
    template: 'grid',
    tagline: 'The next generation, in their language.',
    blurbTitle: 'Playmoney',
    blurb: 'The line, sized down for the kids. Same motifs, same message, built to survive being a kid.',
    heroImage: '/api/uploads/17864827-750e-47de-9bea-ef81e38b2edb-playmoney-category-hero-v2.webp',
    heroLight: true,
  },
  'house-money': {
    template: 'grid',
    tagline: 'Off your back, into the room.',
    blurbTitle: 'House Money',
    blurb: 'Cushions and home pieces carrying the money motifs into the space you actually live in.',
    heroImage: '/api/uploads/0a083fd1-01a9-4943-9cd1-e069dfa8d56d-housemoney-category-hero.webp',
    heroLight: true,
  },
  accessories: {
    template: 'grid',
    tagline: 'The details.',
    blurbTitle: 'Accessories',
    blurb: 'Hats, totes, socks, cases. The motifs at arm’s length, finishing what the fit started.',
    heroImage: '/api/uploads/c686e04b-c6ab-4143-b9b1-9259ce6e5a43-accessories-category-hero.webp',
  },

  // ── Template 2 · collections / lines ──
  essentials: {
    template: 'collection',
    tagline: 'The purest form of the line.',
    blurbTitle: 'Essentials',
    blurb: 'Minimal expression across a myriad of colors. All for one. Made for all.',
  },
  'narrative-series': {
    template: 'collection',
    tagline: 'The obvious is often the most unspoken.',
    blurbTitle: 'The Narrative Series',
    blurb: 'We decided to break those rules. Welcome to the anthology of our lives. Each piece tells a story. Some lines we know all too familiar.',
    heroImage: '/api/uploads/d8f56f8e-a671-46db-b07b-852930ed61b2-narrative-series-hero-soul-sold-out.webp',
    heroPos: 'center',
  },
  'special-projects': {
    template: 'collection',
    tagline: 'One-offs and limited runs.',
    blurbTitle: 'Special Projects',
    blurb: 'Limited collections used to push our mission forward.',
  },
  smu: {
    template: 'collection',
    tagline: 'Where the grind gets a syllabus.',
    blurbTitle: 'University',
    blurb: 'Money and education in the same breath. Varsity weight, campus energy, financial literacy you can wear. One subject: how the system runs, and how you run it back.',
  },
  'a-pas-dores': {
    template: 'collection',
    tagline: 'Money and sports go hand in hand.',
    blurbTitle: 'À Pas Dorés',
    blurb: 'This is our take. Join our league. Made for those who understand the hustle.',
    lookbook: '/api/uploads/68e318a6-6677-439c-8ceb-de59718da8d6-lookbook.jpg',
  },
  // Seasonal capsule — its own T2 page, linked
  // from the homepage panel. Copy here is a first pass;
  // graphics + the product roster are supplied by the operator.
  'seasonal': {
    template: 'collection',
    tagline: 'The city’s colors, worn loud.',
    blurbTitle: 'Seasonal Capsule',
    blurb: 'Our seasonal capsule — a limited run, for the ones who claim it.',
    heroImage: '/api/uploads/a6e078f9-f596-407a-b3d6-6276c04f5e83-hero.jpg',
    heroLogo: '/api/uploads/baac0255-468d-48c3-9cb3-984ef6d3d6ec-logo.webp',
    heroPos: 'center bottom',
    columns: 3,
  },
};

/** Look up a category page config by its resolved top-level slug. */
export function categoryPageFor(slug: string | undefined): CategoryPage | undefined {
  if (!slug) return undefined;
  return CATEGORY_PAGES[slug];
}

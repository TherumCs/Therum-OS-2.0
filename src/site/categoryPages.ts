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
  'city-series': {
    template: 'collection',
    tagline: 'Our exclusive collection, available at Foot Locker.',
    blurbTitle: 'The City Series',
    blurb: 'The City Series is the meeting point between finance, design, and the city itself. It’s how we show that value doesn’t just live in charts or accounts. It lives in people and places.',
    heroImage: '/api/uploads/6f82713f-c59a-4404-aecf-1fd7f8fbae29-FL_Q3_HOMEGROWNBBM_SIDEMONEY_LOOK_0001_1X1.jpg',
    heroPos: 'center',
    intro: {
      title: 'The City Series',
      body: 'The City Series is the meeting point between finance, design, and the city itself. It’s how we show that value doesn’t just live in charts or accounts. It lives in people and places. The collection studies how movement, money, and culture shape what we wear and how we see ourselves. The City Series is for those investing in themselves and the spaces that made them. Available now at sidemoney.co and in select Foot Locker locations (Quartermaster, Parkwest, and 8 Mile) while quantities last.',
    },
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
    // White wordmark logo on transparent, shows on the dark hero panel. Hero
    // BACKGROUND still pending from Bam — drop heroImage here when it lands and
    // the logo sits over the photo (Bird-Season pattern).
    heroLogo: '/api/uploads/4c250f45-8aed-43a6-94bc-027d285de713-a-pas-dores-logo.png',
    tagline: 'With golden steps.',
    blurbTitle: 'À Pas Dorés',
    blurb: 'Sidemoney’s sports imprint. Homage when the moment calls for it, original when we’ve got something new to say.',
    lookbook: '/api/uploads/68e318a6-6677-439c-8ceb-de59718da8d6-lookbook.jpg',
    featuredRail: true,
    sections: [
      {
        type: 'story',
        eyebrow: 'Our approach',
        title: 'Where the game becomes Sidemoney',
        body: 'Sports gave us the first language for hustle. The grind, the come up, the team, the city on your chest. À Pas Dorés is where we translate that language into Sidemoney. We are not chasing licenses or copying a crest. We study what a jersey means, what a color run says, what a season feels like, and then we build our own version of it. Homage when the moment calls for it. Original when we’ve got something new to say. Golden steps either way.',
      },
      {
        type: 'split',
        media: 'right',
        image: '/api/uploads/3422b31e-3172-4374-a402-ef14f4533d4b-sixers-season-hero.webp',
        eyebrow: 'The collection',
        title: 'Sixers Season',
        body: 'Our homage to Philadelphia basketball, built as a series of jerseys marked by year: the ’96, the ’01, the ’04, the ’25, the ’27. Each one reads like a season of its own, wrapped in the money language that runs through everything we do. Around the jerseys sits a full kit: hoodies, joggers, mesh shorts, pins, and the Money Ball.',
        ctaLabel: 'Shop Sixers Season',
        ctaHref: '/c/sixers-season',
      },
      {
        type: 'split',
        media: 'left',
        image: '/api/uploads/a6e078f9-f596-407a-b3d6-6276c04f5e83-hero.jpg',
        eyebrow: 'The collection',
        title: 'Bird Season',
        body: 'Our homage to Philadelphia football. Practice jerseys in the greens you know and a couple you don’t, snapbacks, joggers, and the pieces you live in on game day. Built for the walk to the stadium and everything after.',
        ctaLabel: 'Shop Bird Season',
        ctaHref: '/c/bird-season',
      },
      {
        type: 'story',
        eyebrow: 'The league',
        title: 'Play the season with us',
        body: 'À Pas Dorés isn’t only what you wear. Every year we run Sidemoney fantasy leagues under the same label, a way to play the season with the community instead of just dressing for it. Draft, talk trash, compete, win. Same golden steps, new field.',
      },
    ],
  },
  // Bird Season — the seasonal capsule. A GRID page like Men's (hero + text +
  // image, then the product grid). MUST be keyed to the real category slug
  // ('bird-season'); it was keyed 'seasonal', which no category matches, so the
  // page rendered bare with no hero at all — "Bird Season lost its header".
  'bird-season': {
    template: 'grid',
    tagline: 'The city’s colors, worn loud.',
    blurbTitle: 'Bird Season',
    blurb: 'Our Bird Season capsule — a limited run, for the ones who claim it.',
    heroImage: '/api/uploads/a6e078f9-f596-407a-b3d6-6276c04f5e83-hero.jpg',
    heroLogo: '/api/uploads/baac0255-468d-48c3-9cb3-984ef6d3d6ec-logo.webp',
    heroPos: 'center bottom',
  },
  // Sixers Season — the next seasonal capsule, same GRID template as Bird Season.
  // Being built out; NO heroImage yet on purpose, so the hero renders as the dark
  // titled placeholder panel until the real header art is dropped in here
  // (heroImage / heroLogo). No products are attached yet → the grid shows the
  // "no products here yet" empty state. Whatever is refined here backports to
  // bird-season by mirroring the same keys.
  'sixers-season': {
    template: 'grid',
    tagline: 'Trust the process.',
    blurbTitle: 'Sixers Season',
    blurb: 'Our Sixers Season capsule — a limited run, for the ones who claim it.',
    // Self-contained header art: the arena billboard already reads "$IXERS SEASON"
    // and carries the Sidemoney signature, so heroBare renders it alone (no scrim,
    // no doubled-up title/logo overlay). The billboard's measured horizontal centre
    // is ~40% (left of image centre); on desktop the crop is vertical-only so X is
    // moot, but on phones cover crops horizontally — 40% keeps the whole wordmark in
    // frame where 'center' would clip its left edge.
    heroImage: '/api/uploads/3422b31e-3172-4374-a402-ef14f4533d4b-sixers-season-hero.webp',
    heroBare: true,
    heroPos: '40% center',
    // Placeholder callouts — the jersey-story layout, ready for real copy + art.
    // Each is one Zappos-style beat: story on one side, the piece on the other.
    // Drop an `image` (and real specs/body) per jersey; sides auto-alternate.
    // The five preorder jerseys, in Bam's order: red · black · split-76 · blue ·
    // white. Buyable now (members), ships after the Oct 10 drop. Front shots +
    // per-piece PDP links. The carousel's "01 / 05 … 05 / 05" counter IS the
    // timeline. Copy is a first pass — refine per piece anytime.
    callouts: [
      {
        eyebrow: 'Preorder · Ships after Oct 10',
        title: "'96 Series",
        body: 'Rookie-era red with No. 77, the last look before the black and gold. Where it started.',
        image: '/api/uploads/00b26d18-9318-480b-8db3-a4ff46172f69-ixers-jersey-9.jpg',
        specs: [{ label: 'Price', value: '$120' }, { label: 'Drop', value: 'Oct 10' }],
        ctaLabel: 'Shop the piece',
        ctaHref: '/product/ixers-season-jersey-red',
      },
      {
        eyebrow: 'Preorder · Ships after Oct 10',
        title: "'01 Series",
        body: 'The MVP year in black with No. 0. The one everybody remembers.',
        image: '/api/uploads/83aecba3-36a3-47f8-96bc-49ec650d17a6-ixers-jersey-1.jpg',
        specs: [{ label: 'Price', value: '$120' }, { label: 'Drop', value: 'Oct 10' }],
        ctaLabel: 'Shop the piece',
        ctaHref: '/product/ixers-season-jersey-black',
      },
      {
        eyebrow: 'Preorder · Ships after Oct 10',
        title: "'04 Series",
        body: 'The swingman era, split 76. On the court a rebuild, off it a takeover.',
        image: '/api/uploads/26bad879-8ed6-40c0-946b-af4926d103a8-ixers-jersey-7.jpg',
        specs: [{ label: 'Price', value: '$120' }, { label: 'Drop', value: 'Oct 10' }],
        ctaLabel: 'Shop the piece',
        ctaHref: '/product/ixers-season-jersey-split-76',
      },
      {
        eyebrow: 'Preorder · Ships after Oct 10',
        title: "'25 Series",
        body: 'Royal blue, SMNYCO, No. 21. For the ones who stayed through the down year.',
        image: '/api/uploads/9b91fc70-5352-48be-ac95-8ad034841dd2-ixers-jersey-3.jpg',
        specs: [{ label: 'Price', value: '$120' }, { label: 'Drop', value: 'Oct 10' }],
        ctaLabel: 'Shop the piece',
        ctaHref: '/product/ixers-season-jersey-blue',
      },
      {
        eyebrow: 'Preorder · Ships after Oct 10',
        title: "'27 Series",
        body: "What's next, in white with No. 23. The biggest signing this city has dreamed up.",
        image: '/api/uploads/6109c461-78ec-41f3-9201-276e93f68ff1-ixers-jersey-5.jpg',
        specs: [{ label: 'Price', value: '$120' }, { label: 'Drop', value: 'Oct 10' }],
        ctaLabel: 'Shop the piece',
        ctaHref: '/product/ixers-season-jersey-white',
      },
    ],
    // Story beats above the jersey carousel — the collection narrative. Real copy
    // + art drop in per block; a blank image shows a labelled placeholder.
    sections: [
      {
        type: 'story',
        eyebrow: 'Welcome to Sixer Season',
        title: '$Trust The Process.',
        body: 'A collection we’ve wanted to make for a long time. An ode not just to the city of Philadelphia, but to the hometown teams that raised us. It’s the next tribute in the series: we already gave you <a href="/c/bird-season/" style="text-decoration:underline;text-underline-offset:3px">Bird Season</a>, and this one’s for the hardwood. And with a lot of new energy in the city, LeBron signing with the Sixers and Jaylen Brown right beside him, we wanted to celebrate the moment and get you ready for the season ahead.',
      },
    ],
    // A horizontal "featured / in the collection" product rail under the jersey
    // carousel, above the full grid. Pulls this category's products; shows
    // placeholder cards until the collection has product.
    featuredRail: true,
  },
};

/** Look up a category page config by its resolved top-level slug. */
export function categoryPageFor(slug: string | undefined): CategoryPage | undefined {
  if (!slug) return undefined;
  return CATEGORY_PAGES[slug];
}

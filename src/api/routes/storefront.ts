import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { db } from '../../lib/db.js';
import { capabilityService } from '../../services/capability.service.js';
import { layout, closedPage, esc, money, type StoreChrome, type SeoMeta } from '../../site/storefrontHtml.js';
import { SITE_WIDTHS } from '../../site/siteHtml.js';
import { cached } from '../../lib/cache.js';
import { buildNav } from './site.js';
import { resolveCategoryPath, resolveCategoryFilter, categoryAndDescendantIds, categoryFacets } from '../../counter/categoryTree.js';
import { settingsService } from '../../services/settings.service.js';
import { productGrid, CARD_EVOLVE_RUNTIME, CARD_REVEAL_RUNTIME, type CardPreset } from '../../site/productGrid.js';
import { resolveCustomer } from '../../counter/customerSession.js';
import { milieuService } from '../../services/milieu.service.js';

// Only these presets render a rating, so only they pay for the query.
const PRESET_NEEDS_RATING = new Set<CardPreset>(['sneaker', 'data']);

// `product.meta` is free-form JSON — an import, a bridge or an API caller can
// write anything into it. A per-product card override is read back through
// this rather than cast, so a junk value renders the store default instead of
// a class name straight out of someone's payload.
const CARD_MEDIA_VALUES = ['still', 'fade', 'gallery', 'motion'] as const;
const CARD_PRESET_VALUES = ['editorial', 'retail', 'detailed', 'sneaker', 'data'] as const;
function pickEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}
import { checkoutFlowMarkup, quickBuySheetMarkup, CHECKOUT_FLOW_RUNTIME } from '../../site/checkoutFlow.js';
import { shopToolbar, SHOP_TOOLBAR_RUNTIME } from '../../site/shopToolbar.js';
import { accountMarkup, ACCOUNT_RUNTIME } from '../../site/accountPage.js';
import { wishlistMarkup } from '../../site/wishlist.js';
import { orderTrackingMarkup, ORDER_TRACKING_CSS, ORDER_TRACKING_RUNTIME } from '../../site/orderTracking.js';

// Counter C4 — the five public storefront surfaces, server-rendered from the
// same Fastify process as the API (same origin, so the client runtime's
// fetch('/api/…') needs no CORS). Catalog reads go straight to the DB with
// status:'active' pinned — the storefront can never leak drafts. Cart state
// stays client-fetched (the cart token lives in localStorage, never in a URL
// — C2 audit M-3 applies to pages too).

// Helmet's default CSP (script-src 'self') would strip the storefront's
// inline runtime; these pages carry their own explicit policy instead —
// still same-origin-only for fetch/img, inline allowed for the page's own
// script+style, nothing external loadable.
// img/media allow https: — product galleries reference media-library or CDN
// URLs, and hover-preview videos stream from wherever the merchant hosts.
const PAGE_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; media-src 'self' https:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'";

const html = (reply: { header: (k: string, v: string) => unknown; type: (t: string) => { send: (b: string) => void } }, body: string): void => {
  reply.header('content-security-policy', PAGE_CSP);
  reply.type('text/html; charset=utf-8').send(body);
};

// Normalize a product's media into one ordered list. type is explicit or
// inferred from the extension; a video's card-still is its poster (or the
// product's primary image as fallback).
export interface GalleryItem {
  url: string;
  alt: string;
  type: 'image' | 'video';
  poster: string | null;
}

function normalizeGallery(p: { name: string; image: string | null; images: unknown }): GalleryItem[] {
  const raw = [
    ...(p.image ? [{ url: p.image, alt: p.name }] : []),
    ...((Array.isArray(p.images) ? p.images : []) as { url?: string; alt?: string; type?: string; poster?: string }[]),
  ];
  return raw
    .filter((i): i is { url: string; alt?: string; type?: string; poster?: string } => typeof i.url === 'string' && i.url.length > 0)
    .map((i) => ({
      url: i.url,
      alt: i.alt ?? p.name,
      type: i.type === 'video' || /\.(mp4|webm|mov)(\?|$)/i.test(i.url) ? 'video' as const : 'image' as const,
      poster: i.poster ?? null,
    }));
}

async function commerceOn(): Promise<boolean> {
  return capabilityService.isEnabled('commerce');
}


/**
 * The site's own header/footer for store pages.
 *
 * Loaded per request rather than baked in, because the chrome is editable
 * content (Settings > Site > chrome slugs). Failing soft is deliberate: if the
 * chrome page is unpublished, the store still renders with Counter's plain
 * frame instead of 500ing a checkout.
 */
async function page(title: string, body: string, extraScript = '', seo?: SeoMeta): Promise<string> {
  // Content width comes from the same setting the rest of the site reads, so
  // the shop is not the one page that stays narrow when everything else widens.
  const site = await settingsService.getSite().catch(() => null);
  const siteMax = SITE_WIDTHS[site?.contentWidth ?? 'wide'] ?? SITE_WIDTHS.wide;
  return layout(title, body, extraScript, await storeChrome(), seo, siteMax);
}

/**
 * The public origin of THIS request, so canonical and og:url can be absolute —
 * relative og:url is ignored by most scrapers. Read from the forwarded headers
 * because in production this sits behind nginx, so req.protocol alone says http
 * even when the shopper is on https.
 */
function originOf(req: { headers: Record<string, unknown>; protocol: string }): string {
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '');
  const proto = String(req.headers['x-forwarded-proto'] ?? req.protocol ?? 'http').split(',')[0];
  return host ? `${proto}://${host}` : '';
}

/** Pages that must never be indexed: per-shopper, transactional, or tokened. */
const PRIVATE_PAGE: SeoMeta = { noindex: true };

/**
 * Sort options.
 *
 * Price sorting is deliberately absent: a product's price lives on its
 * VARIANTS, so "cheapest first" is a min-over-variants that Prisma cannot
 * order by directly. Offering it and sorting by something else would be worse
 * than not offering it — it needs a real aggregate, which is its own change.
 */
const SORTS = [
  { id: 'new', label: 'Newest' },
  { id: 'oldest', label: 'Oldest' },
  { id: 'name', label: 'A–Z' },
  { id: 'name-desc', label: 'Z–A' },
  { id: 'price-asc', label: 'Price: low to high' },
  { id: 'price-desc', label: 'Price: high to low' },
  { id: 'best-selling', label: 'Best selling' },
] as const;

// Price and best-selling cannot be an `orderBy`: price lives on VARIANTS, so
// "cheapest first" is a min-over-variants, and best-selling is a count over
// order items. Both are applied in memory over the page that was fetched —
// correct while the grid loads one page at a time (toolbarPageSize, capped at
// 120). If this ever paginates, they need a real aggregate query, and sorting
// a page at a time would silently be wrong.
const IN_MEMORY_SORTS = new Set(['price-asc', 'price-desc', 'best-selling']);

/**
 * Section heading for a store page, honouring Settings > Site > Page titles.
 *
 * Scoped to SECTION headings — "Shop", "Cart", "Checkout". Error and
 * confirmation headings ("Product not found", "Thanks — order confirmed") are
 * deliberately NOT covered: those headings are the entire message, and hiding
 * them would leave a blank page instead of a tidier one.
 */
async function heading(text: string): Promise<string> {
  const site = await settingsService.getSite();
  return site.showPageTitles === false ? '' : `<h1 class="page-title">${esc(text)}</h1>`;
}

async function storeChrome(): Promise<StoreChrome> {
  try {
    const ctx = await buildNav('/shop');
    return {
      header: ctx.chrome.chromeHeader,
      footer: ctx.chrome.chromeFooter,
      cssUrl: ctx.chrome.chromeCssUrl,
      headerIcons: ctx.chrome.headerIcons,
    };
  } catch {
    return {};
  }
}

export async function storefrontRoutes(app: FastifyInstance): Promise<void> {
  // A themed 404 for store URLs, so an unknown category looks like the site
  // rather than dropping to the API's JSON not-found.
  const notFoundStore = async (reply: FastifyReply, heading: string): Promise<void> => {
    reply.status(404);
    html(reply, await page(`${heading} — Therum Store`,
      `<div class="empty-state"><div class="big">🔍</div><h1 class="page-title">${esc(heading)}</h1>` +
      `<p class="page-sub">It may have been renamed or removed.</p>` +
      `<p style="margin-top:12px"><a class="btn ghost sm" href="/shop">Back to the shop</a></p></div>`, '', PRIVATE_PAGE));
  };

  // ── The shop, and every category and tag view of it ──
  //
  // WooCommerce ships a shop page AND a separate product-category archive,
  // rendered by a different template, so a "Mens" link in the header lands
  // somewhere that looks related to the shop but is not it — different
  // layout, different controls, its own quirks.
  //
  // There is ONE page here. /c/mens and /t/sale render the same grid, the
  // same toolbar and the same cards as /shop, with that filter already
  // applied and its pill showing as chosen. Assign a product to a category,
  // link to the category, and the shopper is in the shop with the category
  // selected — they can widen it from there without a page that behaves
  // differently.
  //
  // Filters otherwise ride the query string, so every combination is a
  // shareable, crawlable URL. /c/:slug is just the pretty, canonical form of
  // the one filter that gets linked from menus.
  const shopPage = async (
    req: FastifyRequest,
    reply: FastifyReply,
    preset: { category?: string; tag?: string; title?: string; canonical?: string } = {},
  ): Promise<void> => {
    if (!(await commerceOn())) return html(reply, closedPage());
    const query = req.query as { q?: string; category?: string; tag?: string; color?: string; size?: string; sort?: string; brand?: string; stock?: string; price?: string };
    const q = (query.q ?? '').trim().slice(0, 100);
    // A path preset PRESELECTS its filter rather than locking it. On /c/mens
    // the Category pill starts on Mens; turning it off leaves you on the same
    // URL viewing everything, and turning it back on matches the link again.
    // 'all' is the explicit off — distinct from "not specified", which is what
    // an absent param means and would just re-apply the preset.
    const ALL = 'all';
    const catParam = (query.category ?? '').trim().slice(0, 80);
    const tagParam = (query.tag ?? '').trim().slice(0, 80);
    const presetCatOff = preset.category !== undefined && catParam === ALL;
    const presetTagOff = preset.tag !== undefined && tagParam === ALL;
    const category = presetCatOff ? '' : (catParam && catParam !== ALL ? catParam : preset.category ?? '');
    const tag = presetTagOff ? '' : (tagParam && tagParam !== ALL ? tagParam : preset.tag ?? '');
    // `category` is a PATH now ("mens" or "mens/accessories/hats"), resolved to
    // the category plus everything under it. An unresolvable path filters to
    // nothing rather than falling back to "no filter" — a typo in the URL must
    // not quietly return the entire catalogue as if it matched.
    const catNode = category ? await resolveCategoryFilter(category) : null;
    const categoryIds = category ? (catNode ? await categoryAndDescendantIds(catNode.id) : []) : null;
    const color = (query.color ?? '').trim().slice(0, 40);
    const size = (query.size ?? '').trim().slice(0, 40);
    // Sort is validated against the known set rather than passed through — an
    // arbitrary string here would reach Prisma's orderBy.
    // Storefront presentation is one settings read (Settings > Counter), used
    // by the card, the toolbar and the grid alike so they cannot disagree.
    const counter = await settingsService.getCounter();

    // Member pricing, from the SESSION only. The same rule as the cart: a
    // typed email must never unlock another customer's membership. A page
    // priced for a member is per-shopper and therefore not shared-cacheable,
    // which is the real cost of showing it here rather than at checkout.
    const shopper = counter.memberPricing === 'off' ? null : await resolveCustomer(req);
    const memberPct = shopper && (await capabilityService.isEnabled('memberships'))
      ? (await milieuService.discountFor(shopper.id))?.pct ?? 0
      : 0;
    const offeredSorts = SORTS.filter((sp) => counter.toolbarSorts.includes(sp.id));
    // A shopper cannot pick a sort the merchant switched off, even by URL.
    const sort = offeredSorts.some((sp) => sp.id === query.sort) ? (query.sort as string) : counter.toolbarDefaultSort;
    const brand = (query.brand ?? '').trim().slice(0, 80);
    const inStock = query.stock === '1';
    const priceBand = (query.price ?? '').trim().slice(0, 20);
    const filterOn = (f: string): boolean => counter.toolbarFilterFields.includes(f as never);

    const orderBy =
      sort === 'name' ? { name: 'asc' as const }
      : sort === 'name-desc' ? { name: 'desc' as const }
      : sort === 'oldest' ? { createdAt: 'asc' as const }
      : { createdAt: 'desc' as const };

    // The catalog read, cached per distinct filter combination. This is the
    // heaviest query on the busiest page — it joins vendor, variants and
    // categories — and every visitor to /shop with the same filters gets a
    // byte-identical answer.
    //
    // The key is built from the PARSED inputs, not the raw query string, so
    // ?tag=x&q=y and ?q=y&tag=x share one entry. Getting a cache key wrong is
    // how one shopper is served another's filtered page, so it lists every
    // value that can change the result.
    //
    // JSON.parse on the way out also means each request gets its own array,
    // which matters because the in-memory sorts below mutate it.
    const catalogKey = JSON.stringify({
      q, tag, color, size, brand, sort,
      cats: categoryIds ?? null,
      take: counter.toolbarPageSize,
    });
    const products = await cached('catalog', catalogKey, () => db.product.findMany({
      where: {
        status: 'active',
        ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } }] } : {}),
        // Resolved to ids, not matched on slug: a slug is only unique within
        // its parent now, so `slug: 't-shirts'` would pull Mens AND Womens.
        // The set includes descendants, so /c/mens lists what is filed under
        // Mens > T-Shirts too.
        ...(categoryIds ? { categories: { some: { id: { in: categoryIds } } } } : {}),
        ...(tag ? { tags: { some: { slug: tag } } } : {}),
        ...(color ? { variants: { some: { color: { equals: color, mode: 'insensitive' } } } } : {}),
        ...(size ? { variants: { some: { size: { equals: size, mode: 'insensitive' } } } } : {}),
        ...(brand ? { vendor: { is: { name: { equals: brand, mode: 'insensitive' } } } } : {}),
        // "In stock" means a variant a shopper can actually buy right now —
        // inventory minus what is already reserved, not the raw column.
        ...(inStock ? { variants: { some: { inventory: { gt: 0 } } } } : {}),
      },
      include: { vendor: { select: { name: true } }, variants: true, categories: { select: { name: true, slug: true } } },
      orderBy,
      // One page at a time. See IN_MEMORY_SORTS for why that bound matters.
      take: counter.toolbarPageSize,
    }));

    // Price and best-selling are resolved here, over the page just fetched.
    if (IN_MEMORY_SORTS.has(sort)) {
      const minPrice = (p: (typeof products)[number]): number => {
        const prices = p.variants.map((v) => v.price);
        return prices.length ? Math.min(...prices) : Number.MAX_SAFE_INTEGER;
      };
      if (sort === 'price-asc') products.sort((a, b) => minPrice(a) - minPrice(b));
      else if (sort === 'price-desc') products.sort((a, b) => minPrice(b) - minPrice(a));
      else {
        const sold = await db.orderItem.groupBy({
          by: ['variantId'],
          where: { variantId: { in: products.flatMap((p) => p.variants.map((v) => v.id)) } },
          _sum: { quantity: true },
        });
        const byVariant = new Map(sold.map((r) => [r.variantId, r._sum.quantity ?? 0]));
        const units = (p: (typeof products)[number]): number =>
          p.variants.reduce((n, v) => n + (byVariant.get(v.id) ?? 0), 0);
        products.sort((a, b) => units(b) - units(a));
      }
    }

    // Filter rails: categories/tags with live products; colors/sizes from
    // active variants (derived attributes — the Woo attribute-filter role).
    // The rails describe WHAT IS IN VIEW. On /c/mens they list the tags,
    // colours and sizes that Mens products actually have — a Colour pill full
    // of shades that exist only in Womens is a filter that returns nothing.
    //
    // Scoped to the CATEGORY, deliberately not to the other active filters:
    // collapsing the colour list because a size is selected makes the filters
    // feel broken rather than helpful.
    const scope = { status: 'active' as const, ...(categoryIds ? { categories: { some: { id: { in: categoryIds } } } } : {}), ...(tag ? { tags: { some: { slug: tag } } } : {}) };
    const [cats, tags, variantAttrs] = await Promise.all([
      categoryFacets(),
      db.productTag.findMany({ where: { products: { some: scope } }, select: { name: true, slug: true }, orderBy: { name: 'asc' } }),
      db.productVariant.findMany({ where: { product: scope }, select: { color: true, size: true } }),
    ]);
    const variantPrices = filterOn('price')
      ? await db.productVariant.findMany({ where: { product: scope }, select: { price: true } })
      : [];
    const colors = [...new Set(variantAttrs.map((v) => v.color).filter((c): c is string => !!c))].sort();
    const sizes = [...new Set(variantAttrs.map((v) => v.size).filter((s): s is string => !!s))].sort();
    const brands = filterOn('brand')
      ? (await db.vendor.findMany({ where: { products: { some: scope } }, select: { name: true }, orderBy: { name: 'asc' } })).map((v) => v.name)
      : [];
    // Bands from the live price spread: the median splits the catalogue in
    // roughly half, so both bands always have something in them.
    const priceBands = ((): { id: string; label: string }[] => {
      if (!filterOn('price')) return [];
      const all = variantPrices.map((v) => v.price).sort((a, b) => a - b);
      if (all.length < 2) return [];
      const mid = all[Math.floor(all.length / 2)]!;
      const round = Math.max(500, Math.round(mid / 500) * 500);
      return [
        { id: `under-${round}`, label: `Under ${money(round)}` },
        { id: `over-${round}`, label: `${money(round)} and up` },
      ];
    })();

    // Links built from here stay on the pretty URL when one is in play, and
    // never repeat the preset as a query param. Clearing the preset filter
    // itself walks back to /shop, which is the one page it is a view of.
    // Every link stays on the pretty URL. The preset filter is carried as
    // either nothing (on, matching the link) or the ALL sentinel (off).
    const base = preset.canonical ?? '/shop';
    const qs = (over: Record<string, string>): string => {
      const params = new URLSearchParams();
      const next = { q, category, tag, color, size, sort, brand, price: priceBand, stock: inStock ? '1' : '', ...over };
      for (const [k, v] of Object.entries(next)) {
        if (k === 'category' && preset.category !== undefined) {
          // On /c/mens the category IS the URL when it matches; only a
          // DIFFERENT category, or none at all, needs saying.
          if (v === preset.category) continue;
          params.set('category', v || ALL);
          continue;
        }
        if (k === 'tag' && preset.tag !== undefined) {
          if (v === preset.tag) continue;
          params.set('tag', v || ALL);
          continue;
        }
        // Sort always has a value now that it falls back to the store
        // default, so writing it unconditionally put ?sort=new on every link.
        if (k === 'sort' && v === counter.toolbarDefaultSort) continue;
        if (v) params.set(k, v);
      }
      const qsStr = params.toString();
      return qsStr ? `${base}?${qsStr}` : base;
    };
    const chip = (label: string, href: string, active: boolean): string =>
      `<a class="filter-chip${active ? ' active' : ''}" href="${esc(href)}">${esc(label)}</a>`;

    // Ratings for the presets that show them, in ONE grouped query rather than
    // one per card — approved reviews only, same rule as the PDP.
    // Any card action other than 'none' can add to the cart, and adding from a
    // card opens the quick-buy sheet — so the sheet's markup and runtime have
    // to be on THIS page, not only on /cart and /checkout.
    const quickBuyOnCards = counter.cardAction !== 'none';

    const ratingRows = PRESET_NEEDS_RATING.has(counter.cardPreset)
      ? await db.productReview.groupBy({
          by: ['productId'],
          where: { productId: { in: products.map((p) => p.id) }, status: 'approved' },
          _avg: { rating: true },
          _count: { _all: true },
        })
      : [];
    const ratings = new Map(ratingRows.map((r) => [r.productId, { average: r._avg.rating ?? 0, count: r._count._all }]));

    // Theme-shaped grid: the ported stylesheet targets .c-product-grid__*,
    // so emitting Counter's generic .card markup left the shop unstyled no
    // matter how much site chrome wrapped it. See src/site/productGrid.ts.
    const cards = productGrid(
      products.map((p) => {
        const prices = p.variants.map((v) => v.price);
        const gallery = normalizeGallery(p);
        return {
          id: p.id,
          slug: p.slug,
          name: p.name,
          priceFrom: prices.length ? Math.min(...prices) : 0,
          priceRange: prices.length > 0 && Math.min(...prices) !== Math.max(...prices),
          media: gallery.map((g) => ({ type: g.type, url: g.url, poster: g.poster })),
          subtitle: p.categories.length ? p.categories.map((c) => c.name).join(' · ') : (p.vendor?.name ?? null),
          // More than one variant means there is a choice to make, so the card
          // sends the shopper to the PDP rather than guessing for them.
          hasOptions: p.variants.length > 1,
          quickVariantId: p.variants.length === 1 ? (p.variants[0]?.id ?? null) : null,
          stock: p.variants.reduce((n, v) => n + Math.max(0, v.inventory - v.reserved), 0),
          brand: p.vendor?.name ?? null,
          colors: [...new Set(p.variants.map((v) => v.color).filter((c): c is string => !!c))],
          sizes: [...new Set(p.variants.map((v) => v.size).filter((z): z is string => !!z))],
          variants: p.variants.map((v) => ({
            id: v.id, color: v.color, size: v.size, price: v.price,
            available: Math.max(0, v.inventory - v.reserved),
          })),
          rating: ratings.get(p.id) ?? null,
          memberPct,
          memberLabel: counter.memberPriceLabel,
          memberDisplay: counter.memberPricing,
          // Per-product overrides live in meta, validated on the way out
          // rather than trusted — meta is free-form JSON that an import or an
          // API caller can put anything into.
          mediaOverride: pickEnum((p.meta as Record<string, unknown> | null)?.cardMedia, CARD_MEDIA_VALUES),
          presetOverride: pickEnum((p.meta as Record<string, unknown> | null)?.cardPreset, CARD_PRESET_VALUES),
          // No column for a was-price; a store that has never set one simply
          // never shows a discount, rather than a faked strike-through.
          compareAt: typeof (p.meta as { compareAtPrice?: unknown } | null)?.compareAtPrice === 'number'
            ? (p.meta as { compareAtPrice: number }).compareAtPrice
            : null,
        };
      }),
      counter.toolbarColumns,
      {
        shell: counter.cardShell,
        media: counter.cardMedia,
        mediaSecondary: counter.cardMediaSecondary,
        action: counter.cardAction,
        evolve: counter.cardEvolve,
        align: counter.cardAlign,
        radius: counter.cardRadius,
        ratio: counter.cardRatio,
        fit: counter.cardFit,
        shadow: counter.cardShadow,
        hover: counter.cardHover,
        gap: counter.cardGap,
        reveal: counter.cardReveal,
        preset: counter.cardPreset,
        subtitle: counter.cardSubtitle,
        badges: counter.cardBadges,
        wishlist: counter.wishlistEnabled && counter.wishlistOnCards,
      },
    );

    const keep = [
      ...(category ? [{ name: 'category', value: esc(category) }] : []),
      ...(tag ? [{ name: 'tag', value: esc(tag) }] : []),
      ...(color ? [{ name: 'color', value: esc(color) }] : []),
      ...(size ? [{ name: 'size', value: esc(size) }] : []),
      ...(sort ? [{ name: 'sort', value: esc(sort) }] : []),
    ];
    const opt = (label: string, href: string, active: boolean): { label: string; href: string; active: boolean } =>
      ({ label: esc(label), href: esc(href), active });

    const toolbar = counter.toolbarEnabled ? shopToolbar({
      q: esc(q),
      keep,
      columns: counter.toolbarColumns,
      style: counter.toolbarStyle,
      show: {
        search: counter.toolbarSearch,
        filters: counter.toolbarFilters,
        sort: counter.toolbarSort,
        view: counter.toolbarView,
        count: counter.toolbarCount,
      },
      resultCount: products.length,
      // Only count sort as "applied" when it DIFFERS from the store default —
      // sort is always set now that it falls back to the setting, so testing
      // it for truthiness put a Clear link on an untouched shop.
      // Clear means "show me everything", including dropping the category the
      // link arrived with — the shopper stays on /c/mens and can toggle Mens
      // back on from the Category pill to match the link again.
      clearHref: q || color || size || brand || priceBand || inStock || category || tag || sort !== counter.toolbarDefaultSort
        ? qs({ q: '', category: '', tag: '', color: '', size: '', brand: '', price: '', stock: '', sort: '' })
        : null,
      // Only the filters the merchant switched on, in the declared order.
      groups: [
        // Breadcrumb label and full PATH, not the bare name and slug. Two
        // categories can now legitimately both be called "T-Shirts", so a flat
        // name list shows the same word twice with no way to tell them apart,
        // and a bare slug no longer identifies which one was clicked.
        filterOn('category') ? { label: 'Category', options: cats.map((c) => opt(c.label, qs({ category: category === c.path ? '' : c.path }), category === c.path)) } : null,
        filterOn('tags') ? { label: 'Tags', options: tags.map((t) => opt(t.name, qs({ tag: tag === t.slug ? '' : t.slug }), tag === t.slug)) } : null,
        filterOn('color') ? { label: 'Color', options: colors.length > 1 ? colors.map((c) => opt(c, qs({ color: color.toLowerCase() === c.toLowerCase() ? '' : c }), color.toLowerCase() === c.toLowerCase())) : [] } : null,
        // Sizes render as a chip grid — a set to scan, not a list to read.
        filterOn('size') ? { label: 'Size', grid: true, options: sizes.length > 1 ? sizes.map((z) => opt(z, qs({ size: size.toLowerCase() === z.toLowerCase() ? '' : z }), size.toLowerCase() === z.toLowerCase())) : [] } : null,
        filterOn('brand') ? { label: 'Brand', options: brands.length > 1 ? brands.map((b) => opt(b, qs({ brand: brand.toLowerCase() === b.toLowerCase() ? '' : b }), brand.toLowerCase() === b.toLowerCase())) : [] } : null,
        // Bands are computed from the store's OWN price spread, not invented
        // round numbers — "Under $25" on a store whose cheapest item is $80 is
        // a filter that only ever returns nothing.
        filterOn('price') ? { label: 'Price', options: priceBands.map((b) => opt(b.label, qs({ price: priceBand === b.id ? '' : b.id }), priceBand === b.id)) } : null,
        filterOn('availability') ? { label: 'Availability', options: [opt('In stock only', qs({ stock: inStock ? '' : '1' }), inStock)] } : null,
      ].filter((g): g is NonNullable<typeof g> => g !== null),
      sort: offeredSorts.map((sp) => opt(sp.label, qs({ sort: sp.id === counter.toolbarDefaultSort ? '' : sp.id }), sort === sp.id)),
      searchPlaceholder: counter.toolbarSearchPlaceholder || undefined,
    }) : '';

    const pageTitle = preset.title ?? 'Shop';
    html(reply, await page(`${pageTitle} — Therum Store`, `
      ${await heading(pageTitle)}
      ${toolbar}
      ${quickBuyOnCards ? quickBuySheetMarkup() : ''}
      ${products.length ? cards : `<div class="empty-state"><div class="big">🛍️</div><p>No products${q || category || tag || color || size ? ' match those filters' : ' here yet'}.</p>${q || category || tag || color || size ? '<p style="margin-top:12px"><a class="btn ghost sm" href="/shop">Clear filters</a></p>' : ''}</div>`}
    `, `${SHOP_TOOLBAR_RUNTIME}${quickBuyOnCards ? CHECKOUT_FLOW_RUNTIME : ''}${counter.cardEvolve && counter.cardAction !== 'none' ? CARD_EVOLVE_RUNTIME : ''}${counter.cardReveal === 'none' ? '' : CARD_REVEAL_RUNTIME}`, {
      description: preset.title
        ? `Shop ${preset.title} at The Sidemoney Company.`
        : 'Shop every drop from The Sidemoney Company.',
      // The canonical is the clean category or shop path, WITHOUT the filter
      // query — otherwise every filter combination is its own indexable URL
      // competing with the others.
      canonical: preset.canonical ?? '/shop',
      origin: originOf(req),
      type: 'website',
      siteName: 'The Sidemoney Company',
    }));
  };

  app.get('/shop', async (req, reply) => shopPage(req, reply));

  // /c/* — a category at ANY depth, resolved as a path.
  //
  // One wildcard rather than a route per level. Two levels is the common case
  // (Mens > T-Shirts) and Accessories goes three (Mens > Accessories > Hats);
  // this counts nothing, so a fourth costs no code.
  //
  // Every segment is checked against its parent, so /c/womens/t-shirts cannot
  // serve the Mens t-shirts page — without that, two URLs return identical
  // content and compete with each other. A path nobody has used 404s rather
  // than quietly rendering the whole catalogue, which would turn every typo
  // into a soft-200 duplicate of /shop.
  app.get('/c/*', async (req, reply) => {
    if (!(await commerceOn())) return html(reply, closedPage());
    const raw = (req.params as { '*': string })['*'] ?? '';
    // A trailing slash leaves an empty last segment; the ported header links
    // every category that way, so this is the common shape, not the edge one.
    const segments = raw.split('/').filter(Boolean);
    if (!segments.length) return notFoundStore(reply, 'Category not found');

    const cat = await resolveCategoryPath(segments);
    if (!cat) return notFoundStore(reply, 'Category not found');

    const path = segments.join('/');
    return shopPage(req, reply, { category: path, title: cat.name, canonical: `/c/${path}` });
  });

  app.get('/t/:slug', async (req, reply) => {
    if (!(await commerceOn())) return html(reply, closedPage());
    const { slug } = req.params as { slug: string };
    const t = await db.productTag.findUnique({ where: { slug }, select: { name: true, slug: true } });
    if (!t) return notFoundStore(reply, 'Tag not found');
    return shopPage(req, reply, { tag: t.slug, title: t.name, canonical: `/t/${t.slug}` });
  });

  // ── /product/:slug — detail + variant picker ──
  app.get('/product/:slug', async (req, reply) => {
    if (!(await commerceOn())) return html(reply, closedPage());
    const { slug } = req.params as { slug: string };
    const p = await db.product.findUnique({
      where: { slug },
      include: {
        vendor: { select: { name: true } },
        variants: { orderBy: { price: 'asc' } },
        categories: { select: { name: true, slug: true } },
        tags: { select: { name: true, slug: true } },
      },
    });
    if (!p || p.status !== 'active') {
      reply.status(404);
      return html(reply, await page('Not found', '<div class="empty-state"><div class="big">🔍</div><h1 class="page-title">Product not found</h1><p class="page-sub"><a href="/shop" style="color:var(--ac-btn)">Back to the shop</a></p></div>', '', PRIVATE_PAGE));
    }

    const variants = p.variants.map((v) => ({
      id: v.id,
      label: [v.color, v.size].filter(Boolean).join(' / ') || v.sku || 'Default',
      price: v.price,
      available: v.inventory - v.reserved,
    }));

    const picker = variants.map((v, i) => `
      <button type="button" data-variant="${esc(v.id)}" data-price="${v.price}" ${v.available <= 0 ? 'disabled' : ''} class="${i === 0 && v.available > 0 ? 'sel' : ''}">${esc(v.label)}</button>`).join('');

    const firstAvailable = variants.find((v) => v.available > 0);

    // Gallery: stills + video, one strip. Selecting a video thumb plays it
    // (muted, controls) in the main slot; stills swap the image back in.
    const gallery = normalizeGallery(p);
    const galleryHtml = gallery.length
      ? `<div class="gallery">
          <div class="thumb gallery-main" id="gallery-main">${gallery[0]?.type === 'video'
            ? `<video controls muted playsinline src="${esc(gallery[0].url)}"${gallery[0].poster ? ` poster="${esc(gallery[0].poster)}"` : ''}></video>`
            : `<img src="${esc(gallery[0]?.url ?? '')}" alt="${esc(gallery[0]?.alt ?? p.name)}">`}</div>
          ${gallery.length > 1 ? `<div class="gallery-strip">${gallery.map((g, i) => `
            <button type="button" class="gallery-thumb${i === 0 ? ' sel' : ''}" data-src="${esc(g.url)}" data-type="${g.type}"${g.poster ? ` data-poster="${esc(g.poster)}"` : ''} aria-label="${esc(g.type === 'video' ? 'Play video' : g.alt)}">
              <img src="${esc(g.type === 'video' ? (g.poster ?? gallery.find((x) => x.type === 'image')?.url ?? '') : g.url)}" alt="${esc(g.alt)}" loading="lazy">
              ${g.type === 'video' ? '<span class="play-badge">▶</span>' : ''}
            </button>`).join('')}</div>` : ''}
        </div>`
      : `<div class="thumb">${esc(p.name)}</div>`;

    const taxonomyPills = [
      ...p.categories.map((c) => `<a class="pill" href="/shop?category=${esc(c.slug)}">${esc(c.name)}</a>`),
      ...p.tags.map((t) => `<a class="pill" href="/shop?tag=${esc(t.slug)}">#${esc(t.name)}</a>`),
    ].join(' ');

    html(reply, await page(`${p.name} — Therum Store`, `
      <div class="product-hero">
        ${galleryHtml}
        <div>
          ${p.vendor ? `<span class="pill">${esc(p.vendor.name)}</span>` : ''}
          <h1 class="page-title" style="margin-top:10px">${esc(p.name)}</h1>
          <div class="price-big" id="price">${money(firstAvailable?.price ?? variants[0]?.price ?? 0)}</div>
          <div class="stock-note" id="stock">${firstAvailable ? `${firstAvailable.available} in stock` : 'Out of stock'}</div>
          ${variants.length > 1 ? `<label>Options</label><div class="variant-picker" id="picker">${picker}</div>` : ''}
          <button class="btn" id="add" ${firstAvailable ? '' : 'disabled'}>Add to cart</button>
          ${p.description ? `<div class="product-desc">${esc(p.description).replace(/\n/g, '<br>')}</div>` : ''}
          ${taxonomyPills ? `<div class="taxonomy-row">${taxonomyPills}</div>` : ''}
        </div>
      </div>`, `
document.querySelectorAll('.gallery-thumb').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('.gallery-thumb').forEach(x=>x.classList.remove('sel'));
  b.classList.add('sel');
  const main=document.getElementById('gallery-main');
  if(b.dataset.type==='video'){
    main.innerHTML='<video controls muted playsinline autoplay src="'+b.dataset.src+'"'+(b.dataset.poster?' poster="'+b.dataset.poster+'"':'')+'></video>';
  }else{
    main.innerHTML='<img src="'+b.dataset.src+'" alt="">';
  }
}));
const VARIANTS=${JSON.stringify(variants)};
let sel=VARIANTS.find(v=>v.available>0)||VARIANTS[0];
const picker=document.getElementById('picker');
if(picker)picker.addEventListener('click',(e)=>{
  const b=e.target.closest('button[data-variant]');if(!b||b.disabled)return;
  picker.querySelectorAll('button').forEach(x=>x.classList.remove('sel'));
  b.classList.add('sel');
  sel=VARIANTS.find(v=>v.id===b.dataset.variant);
  document.getElementById('price').textContent=(sel.price/100).toLocaleString('en-US',{style:'currency',currency:'USD'});
  document.getElementById('stock').textContent=sel.available>0?sel.available+' in stock':'Out of stock';
  document.getElementById('add').disabled=sel.available<=0;
});
document.getElementById('add').addEventListener('click',(e)=>{if(sel)addToCart(sel.id,1,e.target)});
`, {
      description: (p.description ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300)
        || `${p.name} from The Sidemoney Company.`,
      canonical: `/product/${p.slug}`,
      image: p.image ?? undefined,
      origin: originOf(req),
      type: 'product',
      siteName: 'The Sidemoney Company',
      // Variants come back ordered by price asc, so the first is the 'from'
      // price the page already shows.
      priceMinor: variants[0]?.price,
      currency: 'USD',
    }));
  });

  // ── /cart — session review, coupon, line edits (all client-rendered from
  //     /api/cart since the token is client-held) ──
  // ── /cart and /checkout are ONE page in two modes ──
  //
  // Both routes serve the same document; the runtime decides which step opens
  // and swaps between them in place. Keeping /checkout as a real URL means the
  // step is linkable and the back button behaves — a mode held only in memory
  // strands anyone who reloads mid-payment.
  // Cart and checkout are per-shopper and carry nothing a search engine should
  // hold, so they are noindex rather than canonicalised.
  const flowPage = async (title: string, section: string): Promise<string> =>
    page(title, `${await heading(section)}${checkoutFlowMarkup()}`, CHECKOUT_FLOW_RUNTIME, PRIVATE_PAGE);

  app.get('/cart', async (_req, reply) => {
    if (!(await commerceOn())) return html(reply, closedPage());
    html(reply, await flowPage('Cart — Therum Store', 'Cart'));
  });

  app.get('/checkout', async (_req, reply) => {
    if (!(await commerceOn())) return html(reply, closedPage());
    html(reply, await flowPage('Checkout — Therum Store', 'Checkout'));
  });

  // ── The other two header icons ────────────────────────────────────────
  // Both are ordinary store pages so they inherit the site chrome, the cart
  // drawer and the wishlist runtime without any of it being repeated here.
  app.get('/account', async (_req, reply) => {
    if (!(await commerceOn())) return html(reply, closedPage());
    // The wishlist tab embeds the real wishlist markup so wishlist.ts's runtime
    // — already on every store page for the hearts — hydrates it. One list,
    // one implementation.
    html(reply, await page('Account — Therum Store', `${await heading('Account')}${accountMarkup(wishlistMarkup())}`, ACCOUNT_RUNTIME, PRIVATE_PAGE));
  });

  app.get('/wishlist', async (_req, reply) => {
    if (!(await commerceOn())) return html(reply, closedPage());
    // Turned off in Settings > Counter, the page goes away rather than
    // rendering an empty list a shopper can never fill.
    if (!(await settingsService.getCounter()).wishlistEnabled) {
      reply.status(404);
      return html(reply, await page('Wishlist — Therum Store', '<div class="empty-state"><div class="big">🔍</div><h1 class="page-title">Not found</h1></div>', '', PRIVATE_PAGE));
    }
    // No runtime argument: WISHLIST_RUNTIME ships on every store page already,
    // because the heart on a product card needs it too.
    html(reply, await page('Wishlist — Therum Store', `${await heading('Wishlist')}${wishlistMarkup()}`, '', PRIVATE_PAGE));
  });

  // Order tracking. Linked from the footer and previously a 404 — the page
  // existed on the reference site and was never ported.
  app.get('/order-tracking', async (req, reply) => {
    if (!(await commerceOn())) return html(reply, closedPage());
    html(reply, await page(
      'Track your order — Therum Store',
      `<style>${ORDER_TRACKING_CSS}</style>${orderTrackingMarkup()}`,
      ORDER_TRACKING_RUNTIME,
      {
        // Indexable on purpose: people search "<brand> track order". What the
        // form RETURNS is private, but the form itself should rank.
        description: 'Track your Sidemoney order — enter your order number and the email on the order to see carrier and delivery status.',
        canonical: '/order-tracking',
        origin: originOf(req),
        siteName: 'The Sidemoney Company',
      },
    ));
  });

  // The ported header was authored against WordPress, where this is the account
  // page's permalink. Redirecting is cheaper than rewriting every link in
  // editable chrome content, and keeps any bookmark from that era working.
  app.get('/my-account', async (_req, reply) => reply.redirect('/account', 301));

  app.get('/order-received/', async (req, reply) => {
    if (!(await commerceOn())) return html(reply, closedPage());
    const { order: number, token } = req.query as { order?: string; token?: string };
    const notFound = async (): Promise<void> => {
      reply.status(404);
      html(reply, await page('Order — Therum Store', '<div class="empty-state"><div class="big">🔍</div><h1 class="page-title">Order not found</h1><p class="page-sub">Check the link from your receipt email.</p></div>', '', PRIVATE_PAGE));
    };
    if (!number || !token) return await notFound();
    const order = await db.order.findUnique({
      where: { number },
      include: { items: { include: { variant: { include: { product: { select: { name: true } } } } } }, payment: true },
    });
    if (!order?.accessToken) return await notFound();
    const a = Buffer.from(order.accessToken);
    const b = Buffer.from(token);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return await notFound();

    const paid = order.status !== 'pending';
    // What the items alone come to, so the breakdown can show a Subtotal that
    // the item rows visibly add up to.
    const itemsSubtotal = order.items.reduce((sum, i) => sum + i.priceAtTime * i.quantity, 0);
    const rows = order.items.map((i) => `
      <div class="row muted"><span>${i.quantity} × ${esc(i.variant?.product?.name ?? 'Item')}${i.variant?.sku ? ` (${esc(i.variant.sku)})` : ''}</span><span class="num">${money(i.priceAtTime * i.quantity, order.currency)}</span></div>`).join('');

    html(reply, await page(`Order ${esc(order.number)} — Therum Store`, `
      <div style="max-width:560px;margin:0 auto">
        <div class="panel" style="text-align:center;margin-bottom:20px">
          <div style="font-size:40px;margin-bottom:8px">${paid ? '✅' : '🕒'}</div>
          <h1 class="page-title">${paid ? 'Thanks — order confirmed' : 'Order received'}</h1>
          <p class="page-sub" style="margin-bottom:0">Order <strong>${esc(order.number)}</strong>${order.guestEmail ? ` · receipt to ${esc(order.guestEmail)}` : ''}</p>
          ${paid ? '' : '<p class="pill" style="margin-top:10px">Awaiting payment confirmation</p>'}
        </div>
        <div class="panel">
          <div class="totals">
            ${rows}
            <!-- Every component of the charge, itemised. A confirmation that
                 shows only a Total leaves the shopper unable to check what
                 they were actually billed for — and once shipping and tax are
                 on the order, the item rows and the Total no longer add up
                 without these lines. -->
            ${itemsSubtotal !== order.total ? `<div class="row muted"><span>Subtotal</span><span class="num">${money(itemsSubtotal, order.currency)}</span></div>` : ''}
            ${order.discountAmount > 0 ? `<div class="row muted"><span>${esc(order.discountLabel ?? 'Discount')}</span><span class="num">−${money(order.discountAmount, order.currency)}</span></div>` : ''}
            ${order.shippingTotal > 0 ? `<div class="row muted"><span>Shipping${order.shippingMethod ? ` · ${esc(order.shippingMethod)}` : ''}</span><span class="num">${money(order.shippingTotal, order.currency)}</span></div>` : `<div class="row muted"><span>Shipping</span><span class="num">Free</span></div>`}
            ${order.taxTotal > 0 ? `<div class="row muted"><span>Tax</span><span class="num">${money(order.taxTotal, order.currency)}</span></div>` : ''}
            <div class="row grand"><span>Total</span><span class="num">${money(order.total, order.currency)}</span></div>
          </div>
        </div>
        <p style="text-align:center;margin-top:24px"><a href="/shop" style="color:var(--ac-btn);font-weight:600;font-size:14px">Continue shopping →</a></p>
      </div>`, '', PRIVATE_PAGE));
  });

  // Bare / belongs to the Base Theme site renderer (site.ts) — the shop is
  // one section of the public site, not its root.
}

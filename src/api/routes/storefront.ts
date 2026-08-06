import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { PAGE_CSP, ACCOUNT_PAGE_CSP } from '../../site/pageCsp.js';
import { googleApp } from '../../counter/adminGoogleSignIn.js';
import { timingSafeEqual } from 'node:crypto';
import { db } from '../../lib/db.js';
import { capabilityService } from '../../services/capability.service.js';
import { layout, closedPage, CSS, type StoreChrome, type SeoMeta } from '../../site/storefrontHtml.js';
import { esc, money } from '../../site/html.js';
import { SITE_WIDTHS } from '../../site/siteHtml.js';
import { cached } from '../../lib/cache.js';
import { buildNav } from './site.js';
import { resolveCategoryPath, resolveCategoryFilter, categoryAndDescendantIds, categoryFacets } from '../../counter/categoryTree.js';
import { settingsService } from '../../services/settings.service.js';
import { productGrid, PRODUCT_GRID_FALLBACK_CSS, CARD_EVOLVE_RUNTIME, CARD_REVEAL_RUNTIME, type CardPreset } from '../../site/productGrid.js';
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
import { templateHtml, type TemplateSlot } from '../../counter/storefrontTemplates.js';
import { wishlistMarkup } from '../../site/wishlist.js';
import { orderTrackingMarkup, ORDER_TRACKING_CSS, ORDER_TRACKING_RUNTIME } from '../../site/orderTracking.js';
import { availableOf, stockLabel } from '../../counter/availability.js';
import { ROLES, roleBySlug, rolePage, CAREERS_CSS, CAREERS_RUNTIME, CAREERS_INBOX, CV_MAX_BYTES, CV_TYPES } from '../../site/careers.js';
import { viewerFor, visibleWhere, canOpenDirectly, GATE_INCLUDE } from '../../counter/visibility.js';

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


// `csp` overrides the default for the rare page that needs more — currently
// only /account, which offers Google sign-in. Setting the header BEFORE calling
// html() does not work: this function sets it unconditionally and would
// overwrite it, which is exactly how the account page shipped with a policy
// that silently blocked the button it had just rendered.
const html = (
  reply: { header: (k: string, v: string) => unknown; type: (t: string) => { send: (b: string) => void } },
  body: string,
  csp: string = PAGE_CSP,
): void => {
  reply.header('content-security-policy', csp);
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
  /** Colourway this shot belongs to, when the gallery records one. */
  color: string | null;
}

function normalizeGallery(p: { name: string; image: string | null; images: unknown }): GalleryItem[] {
  const raw = [
    ...(p.image ? [{ url: p.image, alt: p.name }] : []),
    ...((Array.isArray(p.images) ? p.images : []) as { url?: string; alt?: string; type?: string; poster?: string }[]),
  ];
  const seen = new Set<string>();
  return raw
    .filter((i): i is { url: string; alt?: string; type?: string; poster?: string; color?: string } => typeof i.url === 'string' && i.url.length > 0)
    // DE-DUPLICATE. The main image is prepended above, and a product whose
    // main image is also its first gallery shot — the normal case once a
    // gallery is set — ended up with the same file twice at the front. The
    // first arrow click then "did nothing", which reads as a broken carousel.
    .filter((i) => { if (seen.has(i.url)) return false; seen.add(i.url); return true; })
    .map((i) => ({
      url: i.url,
      alt: i.alt ?? p.name,
      type: i.type === 'video' || /\.(mp4|webm|mov)(\?|$)/i.test(i.url) ? 'video' as const : 'image' as const,
      poster: i.poster ?? null,
      // Which colourway this shot belongs to, when the gallery records it.
      // Drives the swatch following the carousel.
      color: i.color ?? null,
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
  // Button corner radius is a Counter customization, injected once as a CSS var
  // so every .btn across the store (Add to cart, checkout) honours one setting.
  const counter = await settingsService.getCounter().catch(() => null);
  const btnRadius = ({ sharp: '0', soft: '8px', round: '14px', pill: '999px' } as Record<string, string>)[counter?.buttonShape ?? 'sharp'] ?? '0';
  return layout(title, body, extraScript, await storeChrome(), seo, siteMax, btnRadius);
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
    /**
     * Who is browsing, for VISIBILITY. Resolved from the session independently
     * of member pricing: switching member pricing off must not hand the
     * restricted catalogue to everyone.
     */
    const gateViewer = await viewerFor((await resolveCustomer(req))?.id ?? null);
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
    /**
     * THE VIEWER IS PART OF THE CACHE KEY.
     *
     * This page is cached, and the moment it can contain restricted products a
     * key without the audience in it serves one shopper's private catalogue to
     * the next visitor. Everyone with no grants at all — every signed-out
     * visitor, which is most traffic — shares the single 'public' key, so the
     * common case still gets one cache entry.
     */
    const audienceKey = gateViewer.milieuIds.length || gateViewer.customerId
      ? `${gateViewer.customerId ?? ''}|${[...gateViewer.milieuIds].sort().join(',')}`
      : 'public';
    const catalogKey = JSON.stringify({
      q, tag, color, size, brand, sort,
      cats: categoryIds ?? null,
      take: counter.toolbarPageSize,
      aud: audienceKey,
    });
    const products = await cached('catalog', catalogKey, () => db.product.findMany({
      where: {
        status: 'active',
        // Applied in the QUERY, not by filtering the page afterwards, or the
        // product count and pagination quietly stop matching what is shown.
        AND: [visibleWhere(gateViewer)],
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
    // Facets are gated too: a colour or size that exists only on a restricted
    // product would otherwise advertise it, and clicking the filter would
    // return nothing — which tells the shopper something is being hidden.
    const scope = { status: 'active' as const, AND: [visibleWhere(gateViewer)], ...(categoryIds ? { categories: { some: { id: { in: categoryIds } } } } : {}), ...(tag ? { tags: { some: { slug: tag } } } : {}) };
    const [cats, tags, variantAttrs] = await Promise.all([
      categoryFacets(),
      db.productTag.findMany({ where: { products: { some: scope } }, select: { name: true, slug: true }, orderBy: { name: 'asc' } }),
      db.productVariant.findMany({ where: { product: scope }, select: { color: true, size: true, colorCodes: true } }),
    ]);
    const variantPrices = filterOn('price')
      ? await db.productVariant.findMany({ where: { product: scope }, select: { price: true } })
      : [];
    const colors = [...new Set(variantAttrs.map((v) => v.color).filter((c): c is string => !!c))].sort();
    // colour name -> the provider's hex codes, first row that has them.
    // Guessing paint from the NAME fails on exactly the colourways that most
    // need a swatch: "Black/Natural" is two words, only one of which is a CSS
    // colour, so the whole gradient was invalid and the dot rendered empty.
    const colorHex = new Map<string, string[]>();
    for (const v of variantAttrs) {
      if (!v.color || colorHex.has(v.color)) continue;
      const codes = Array.isArray(v.colorCodes)
        ? (v.colorCodes as unknown[]).filter((c): c is string => typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c))
        : [];
      if (codes.length) colorHex.set(v.color, codes);
    }
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
          media: gallery.map((g) => ({ type: g.type, url: g.url, poster: g.poster, color: g.color })),
          // The category is its own field on the card now, so the subtitle no
          // longer doubles as one — printing both put the same words twice.
          // No brand/vendor subtitle on cards — this store IS the brand, so a
          // "House Brand" line under every title is noise.
          subtitle: null,
          // ALL categories — the card shows a small pill per category on hover,
          // not a single eyebrow. A product can sit in several.
          categories: p.categories.map((c) => ({ name: c.name, slug: c.slug })),
          // More than one variant means there is a choice to make, so the card
          // sends the shopper to the PDP rather than guessing for them.
          hasOptions: p.variants.length > 1,
          quickVariantId: p.variants.length === 1 ? (p.variants[0]?.id ?? null) : null,
          // availableOf, NOT raw inventory. A print-on-demand line carries
          // inventory 0 and stockStatus 'in_stock', so counting the column
          // made every POD product read as SOLD OUT on its card — which also
          // collapsed the two-button action to a single "Sold out" chip.
          stock: p.variants.reduce((n, v) => n + availableOf(v), 0),
          brand: p.vendor?.name ?? null,
          colors: [...new Set(p.variants.map((v) => v.color).filter((c): c is string => !!c))],
          // Same hex the product page paints, keyed by colour name, so a card
          // and the page it links to never show different swatches.
          colorCodes: Object.fromEntries(
            p.variants
              .filter((v) => v.color && Array.isArray(v.colorCodes) && (v.colorCodes as unknown[]).length)
              .map((v) => [v.color as string, (v.colorCodes as unknown[]).filter((c): c is string => typeof c === 'string')]),
          ),
          sizes: [...new Set(p.variants.map((v) => v.size).filter((z): z is string => !!z))],
          variants: p.variants.map((v) => ({
            id: v.id, color: v.color, size: v.size, price: v.price,
            available: availableOf(v),
            // The colourway's own photo, so choosing a swatch on the card can
            // swap the picture the way the product page does.
            image: v.image ?? null,
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

    /**
     * BARE CARD PREVIEW — `?preview=card`.
     *
     * The admin's card preview used to be a hand-built mock, so it could not
     * honour the sixteen card settings and silently disagreed with the shop.
     * This returns the REAL card, built by the same code path with the same
     * settings, and nothing else: no toolbar, no filters, no chrome.
     *
     * noindex, and it renders only what /shop would already render for the
     * same visitor — so it exposes nothing the shop does not.
     */
    if ((req.query as { preview?: string }).preview === 'card') {
      reply.header('content-security-policy', PAGE_CSP);
      reply.header('x-robots-tag', 'noindex');
      return reply.type('text/html; charset=utf-8').send(
        `<!doctype html><html><head><meta charset="utf-8">
         <meta name="viewport" content="width=device-width,initial-scale=1">
         <meta name="robots" content="noindex">
         <style>:root{--th-site-max:100%}${CSS}${PRODUCT_GRID_FALLBACK_CSS}
           body{margin:0;padding:18px;background:var(--bg,#fff);display:flex;justify-content:center}
           .c-product-grid__list{max-width:340px}
           /* INERT. This is a picture of a card, not a card: a preview inside
              the admin must not be able to add to the operator's cart or
              navigate the frame away to the product page. Hover still works,
              because hover behaviour is part of what is being previewed. */
           .card-btn,.card-icon,.c-product-card a,[data-quick-buy],[data-evolve-open]{pointer-events:none}
           </style>
         </head><body>${cards}</body></html>`,
      );
    }


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
        filterOn('color') ? { label: 'Color', swatches: true, options: colors.length > 1 ? colors.map((c) => ({ ...opt(c, qs({ color: color.toLowerCase() === c.toLowerCase() ? '' : c }), color.toLowerCase() === c.toLowerCase()), swatch: c, swatchCodes: colorHex.get(c) ?? [] })) : [] } : null,
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
    // No "Shop" heading on the shop page — the word restates the nav item that
    // got you here and pushes the products down for nothing. A CATEGORY page
    // keeps its heading, because there the title is the only thing telling you
    // which subset of the catalogue you are looking at.
    // The <title> is unaffected: the browser tab and search results still need
    // the word.
    html(reply, await page(`${pageTitle} — Therum Store`, `
      ${preset.title ? await heading(pageTitle) : ''}
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
        ...GATE_INCLUDE,
      },
    });
    // A restricted product 404s for anyone not in its audience — the SAME
    // response as a product that does not exist, because a distinct "members
    // only" page would confirm it exists to someone who should not know.
    // 'private' passes here on purpose: unlisted means the link still works.
    if (p && !canOpenDirectly(p, await viewerFor((await resolveCustomer(req))?.id ?? null))) {
      reply.status(404);
      return html(reply, await page('Not found', '<div class="empty-state"><div class="big">🔍</div><h1 class="page-title">Product not found</h1><p class="page-sub"><a href="/shop" style="color:var(--ac-btn)">Back to the shop</a></p></div>', '', PRIVATE_PAGE));
    }
    if (!p || p.status !== 'active') {
      reply.status(404);
      return html(reply, await page('Not found', '<div class="empty-state"><div class="big">🔍</div><h1 class="page-title">Product not found</h1><p class="page-sub"><a href="/shop" style="color:var(--ac-btn)">Back to the shop</a></p></div>', '', PRIVATE_PAGE));
    }

    const variants = p.variants.map((v) => {
      const shots = Array.isArray(v.images) ? (v.images as { url?: string; alt?: string }[]) : [];
      return {
        id: v.id,
        label: [v.color, v.size].filter(Boolean).join(' / ') || v.sku || 'Default',
        price: v.price,
        // A BOOLEAN, not the count. An untracked variant's availability is a
        // sentinel (a billion), and serialising it into the page leaves that
        // number sitting in the HTML waiting to be rendered by the next person
        // who reaches for it.
        sellable: availableOf(v) > 0,
        // The most one can take in a single order: the real count, capped at 10
        // so a print-on-demand line's sentinel billion never becomes the max,
        // and a one-of-one caps at 1 — exactly the "buy one only" case.
        max: Math.max(1, Math.min(availableOf(v), 10)),
        // What the shopper is TOLD. The raw number cannot be shown any more:
        // an untracked line is a billion, and "1000000000 in stock" is worse
        // than saying nothing.
        stock: stockLabel(v).label,
        color: v.color,
        size: v.size,
        // A colourway is a different photograph. Without these the gallery has
        // nothing to change to when the shopper picks one.
        image: v.image ?? null,
        colorCodes: Array.isArray(v.colorCodes) ? (v.colorCodes as unknown[]).filter((c): c is string => typeof c === 'string') : [],
        images: shots.filter((g) => g.url).map((g) => ({ url: g.url!, alt: g.alt ?? '' })),
      };
    });

    /**
     * Colour and size are SEPARATE choices, not one combined label.
     *
     * Every variant used to render as its own chip reading "Dark Green/Natural
     * / One size" — which repeats the size on every option when there is only
     * one of them, and makes the shopper read six near-identical strings to
     * find a colour.
     *
     * A size with one value is a FACT about the product, so it is stated once
     * as text. Colours become swatches, and the swatch is the variant's own
     * mockup rather than a colour dot: "Dark Green/Natural" is two colours and
     * no single dot is honest about it, whereas the photo always is.
     */
    const uniq = <T,>(xs: T[]) => [...new Set(xs)];
    const colors = uniq(variants.map((v) => v.color).filter((c): c is string => !!c));
    const sizes = uniq(variants.map((v) => v.size).filter((z): z is string => !!z));
    const firstOf = (color: string) => variants.find((v) => v.color === color);

    /**
     * The swatch shows the COLOUR, from the provider's own hex codes.
     *
     * One code is a solid fill. Two is a hard 50/50 split rather than a blend:
     * "Red/Natural" is a red cap with a natural panel, and a gradient between
     * them invents a colour that is on neither. Only when the provider gives no
     * code at all does this fall back to the variant photograph — a swatch that
     * shows the whole product is a worse swatch, but it beats a grey box.
     */
    const fill = (codes: string[]): string | null => {
      const safe = codes.filter((c) => /^#[0-9a-f]{3,8}$/i.test(c));
      if (!safe.length) return null;
      if (safe.length === 1) return `background:${safe[0]}`;
      return `background:linear-gradient(135deg, ${safe[0]} 0 50%, ${safe[1]} 50% 100%)`;
    };

    // A box you tap open (like the shop's filter pills). It starts UNSET —
    // "Pick colour" — and BECOMES the chosen swatch + name once you choose;
    // nothing is pre-selected.
    const colorBox = colors.length > 1
      ? `<div class="pdp-box" data-box="color" data-box-toggle="color" role="button" tabindex="0" aria-expanded="false">
           <span class="pdp-box__k">Colour</span>
           <span class="pdp-box__v"><span class="pdp-box__dot" data-color-dot hidden></span><span id="color-value">Pick colour</span></span>
           <div class="pdp-box__pop" data-box-panel="color" hidden>
             <div class="swatches" id="swatches">
               ${/* "All" shows every shot across every colourway — a gallery view,
                    not a colour, so it never changes the variant being bought. */''}
               <button type="button" class="swatch swatch--all" data-all="1" title="All colours" aria-label="Show every image"><span class="swatch-all-mark">ALL</span></button>
               ${colors.map((c) => {
                const v = firstOf(c)!;
                const paint = fill(v.colorCodes);
                const inner = paint
                  ? `<span class="swatch-fill" style="${paint}"></span>`
                  : v.image ? `<img src="${esc(v.image)}" alt="" loading="lazy">` : `<span class="swatch-blank"></span>`;
                const dot = paint || (v.image ? `background-image:url('${esc(v.image)}');background-size:cover` : 'background:#cfcfcf');
                return `<button type="button" class="swatch" data-color="${esc(c)}" data-dot="${esc(dot)}" title="${esc(c)}" aria-label="${esc(c)}"${v.sellable ? '' : ' disabled'}>${inner}</button>`;
              }).join('')}
             </div>
           </div>
         </div>`
      : '';

    const sizeBox = sizes.length > 1
      ? `<div class="pdp-box" data-box="size" data-box-toggle="size" role="button" tabindex="0" aria-expanded="false">
           <span class="pdp-box__k">Size</span>
           <span class="pdp-box__v"><span id="size-value">Pick size</span></span>
           <div class="pdp-box__pop" data-box-panel="size" hidden>
             <div class="variant-picker" id="sizes">${sizes.map((z) => `<button type="button" data-size="${esc(z)}">${esc(z)}</button>`).join('')}</div>
           </div>
         </div>`
      // One size is not a choice — state it once as a static box.
      : sizes.length === 1 ? `<div class="pdp-box pdp-box--static"><span class="pdp-box__k">Size</span><span class="pdp-box__v">${esc(sizes[0]!)}</span></div>` : '';

    // Fallback for products whose variants carry neither colour nor size (a
    // plain SKU list) — those still need something to pick from.
    const plainPicker = !colors.length && !sizes.length && variants.length > 1
      ? `<label>Options</label><div class="variant-picker" id="picker">${variants.map((v, i) => `
          <button type="button" data-variant="${esc(v.id)}" data-price="${v.price}" ${v.sellable ? '' : 'disabled'} class="${i === 0 && v.sellable ? 'sel' : ''}">${esc(v.label)}</button>`).join('')}</div>`
      : '';

    const picker = `${colorBox}${sizeBox}${plainPicker}`;

    const firstAvailable = variants.find((v) => v.sellable);
    // With colour or size to pick, nothing is pre-selected — Add waits until the
    // shopper has chosen; a single-variant product has no choice, so it is ready.
    const hasChoice = colors.length > 1 || sizes.length > 1;

    // Gallery: stills + video, one strip. Selecting a video thumb plays it
    // (muted, controls) in the main slot; stills swap the image back in.
    const gallery = normalizeGallery(p);
    const galleryHtml = gallery.length
      ? `<div class="gallery">
          <div class="thumb gallery-main" id="gallery-main">${gallery[0]?.type === 'video'
            ? `<video controls muted playsinline src="${esc(gallery[0].url)}"${gallery[0].poster ? ` poster="${esc(gallery[0].poster)}"` : ''}></video>`
            : `<img src="${esc(gallery[0]?.url ?? '')}" alt="${esc(gallery[0]?.alt ?? p.name)}">`}</div>
          ${/*
              The strip is rendered whenever the product has more than one shot
              OR any variant carries its own — a synced print-on-demand product
              has ONE product image and all its photography on the variants, so
              gating the container on the product gallery alone left the script
              with nothing to fill and no thumbnails at all.
            */''}
          ${gallery.length > 1 || variants.some((v) => v.image) ? `<div class="gallery-striprail">
            <button type="button" class="gallery-arrow gallery-arrow--prev" data-strip-dir="-1" aria-label="Previous images">‹</button>
            <div class="gallery-strip">${gallery.map((g, i) => `
            <button type="button" class="gallery-thumb${i === 0 ? ' sel' : ''}" data-src="${esc(g.url)}" data-type="${g.type}"${g.poster ? ` data-poster="${esc(g.poster)}"` : ''} aria-label="${esc(g.type === 'video' ? 'Play video' : g.alt)}">
              <img src="${esc(g.type === 'video' ? (g.poster ?? gallery.find((x) => x.type === 'image')?.url ?? '') : g.url)}" alt="${esc(g.alt)}" loading="lazy">
              ${g.type === 'video' ? '<span class="play-badge">▶</span>' : ''}
            </button>`).join('')}</div>
            <button type="button" class="gallery-arrow gallery-arrow--next" data-strip-dir="1" aria-label="More images">›</button>
          </div>` : ''}
        </div>`
      : `<div class="thumb">${esc(p.name)}</div>`;

    const taxonomyPills = [
      ...p.categories.map((c) => `<a class="pill" href="/shop?category=${esc(c.slug)}">${esc(c.name)}</a>`),
      ...p.tags.map((t) => `<a class="pill" href="/shop?tag=${esc(t.slug)}">#${esc(t.name)}</a>`),
    ].join(' ');

    /**
     * The product page LAYOUT, from Settings > Counter.
     *
     * One markup tree, four arrangements — the styles are CSS over the same
     * DOM rather than four templates, because four templates is four places to
     * forget the stock line or the variant picker. Image side and thumbnail
     * position are separate axes on top, so a style is a starting point rather
     * than a cage.
     */
    const counterCfg = await settingsService.getCounter();
    const pdpStyle = counterCfg.pdpStyle ?? 'classic';
    const pdpClasses = [
      'pdp', `pdp--${pdpStyle}`,
      counterCfg.pdpImageSide === 'right' ? 'pdp--imgright' : '',
      counterCfg.pdpThumbs === 'side' ? 'pdp--thumbside' : '',
      counterCfg.pdpThumbs === 'none' ? 'pdp--thumbnone' : '',
    ].filter(Boolean).join(' ');
    const price = money(firstAvailable?.price ?? variants[0]?.price ?? 0);

    html(reply, await page(`${p.name} — Therum Store`, `
      <div class="pdp-topbar">
        <a class="pdp-back" href="/shop" onclick="if(document.referrer.indexOf(location.host)>-1&&history.length>1){history.back();return false;}">‹ Back</a>
        ${/* Save + Share sit opposite the back button, up top. The wishlist
              runtime (already on every store page) drives both. */''}
        <div class="pdp-topbar__actions">
          <button type="button" class="pdp-act" data-wishlist-toggle="${esc(p.id)}" aria-pressed="false" aria-label="Save to favorites">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.4-4.5-9.7-9.1C1 8.6 2.4 5.5 5.3 5c2-.3 3.6.8 4.7 2.4C11.1 5.8 12.7 4.7 14.7 5c2.9.5 4.3 3.6 3 6.9C19.4 16.5 12 21 12 21z"/></svg>
            <span>Save</span>
          </button>
          <button type="button" class="pdp-act" data-share-url="/product/${esc(p.slug)}" data-share-title="${esc(p.name)}" aria-label="Share">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="19" r="2.6"/><path d="M8.4 10.7 15.6 6.5M8.4 13.3l7.2 4.2"/></svg>
            <span>Share</span>
          </button>
        </div>
      </div>
      <div class="${pdpClasses}">
        ${pdpStyle === 'editorial' ? `<div class="pdp__wordmark">${esc(p.name.split(' ')[0] ?? p.name)}</div>` : ''}
        <div class="pdp__media">${galleryHtml}</div>
        <div class="pdp__info">
          ${taxonomyPills ? `<div class="taxonomy-row pdp-cats">${taxonomyPills}</div>` : ''}
          <h1 class="page-title product-title">${esc(p.name)}</h1>
          <div class="price-big price" id="price">${price}</div>
          <div class="stock-note" id="stock">${firstAvailable ? esc(firstAvailable.stock) : 'Sold out'}</div>
          ${/* Three boxes: Colour and Size open filter-style panels and collapse
                to the chosen value; Quantity is an inline stepper. */''}
          <div class="pdp-picker">
            ${picker}
            ${firstAvailable ? `<div class="pdp-box pdp-box--qty" id="qtywrap"><span class="pdp-box__k">Quantity</span><div class="qtybox"><button type="button" class="qbtn" data-q="-1" aria-label="One fewer">−</button><span class="qn" id="qn" aria-live="polite">1</span><button type="button" class="qbtn" data-q="1" aria-label="One more">+</button></div></div>` : ''}
          </div>
          <button class="btn" id="add" ${firstAvailable && !hasChoice ? '' : 'disabled'}>${!firstAvailable ? 'Sold out' : 'Add to cart'}${pdpStyle === 'editorial' && !hasChoice ? ` · <span id="btn-price">${price}</span>` : ''}</button>
          ${p.description ? `<div class="product-desc">${esc(p.description).replace(/\n/g, '<br>')}</div>` : ''}
        </div>
      </div>`, `
/**
 * Match the letterbox to the photograph.
 *
 * A contained image leaves bars either side. Painting them the store's surface
 * colour makes a white-background product shot look like it failed to load, so
 * the frame takes its colour FROM the image: the border ring is sampled and,
 * when that ring is close to uniform, its colour becomes the background.
 *
 * The uniformity check is the important half. A shot that bleeds to its edges
 * has a busy border, and averaging that gives a muddy colour that matches
 * nothing — worse than the neutral it replaced. Those keep the default.
 *
 * Cross-origin images taint the canvas and throw on read; that is caught and
 * the default kept, so a CDN-hosted image degrades instead of breaking.
 */
function frameToImage(img){
  if(!img||!img.complete||!img.naturalWidth) return;
  var box=img.closest('.gallery-main')||img.closest('.gallery-thumb');
  if(!box) return;
  try{
    var N=24,c=document.createElement('canvas');c.width=N;c.height=N;
    var x=c.getContext('2d',{willReadFrequently:true});
    x.drawImage(img,0,0,N,N);
    var d=x.getImageData(0,0,N,N).data,px=[];
    for(var i=0;i<N;i++){
      [[i,0],[i,N-1],[0,i],[N-1,i]].forEach(function(p){
        var o=(p[1]*N+p[0])*4;
        if(d[o+3]>16) px.push([d[o],d[o+1],d[o+2]]);
      });
    }
    if(px.length<8) return;
    var avg=px.reduce(function(a,p){return [a[0]+p[0],a[1]+p[1],a[2]+p[2]];},[0,0,0]).map(function(v){return v/px.length;});
    // Spread across the ring. A busy border means the picture runs to the edge.
    var spread=px.reduce(function(m,p){
      return Math.max(m,Math.abs(p[0]-avg[0])+Math.abs(p[1]-avg[1])+Math.abs(p[2]-avg[2]));
    },0);
    if(spread>110) return;
    box.style.background='rgb('+avg.map(Math.round).join(',')+')';
  }catch(e){ /* tainted canvas — keep the default surface */ }
}
function matchFrames(){
  document.querySelectorAll('.gallery-main img, .gallery-thumb img').forEach(function(img){
    if(img.complete) frameToImage(img);
    else img.addEventListener('load',function(){frameToImage(img);},{once:true});
  });
}
function bindThumbs(){
  document.querySelectorAll('.gallery-thumb').forEach(b=>b.addEventListener('click',()=>{
    document.querySelectorAll('.gallery-thumb').forEach(x=>x.classList.remove('sel'));
    b.classList.add('sel');
    const main=document.getElementById('gallery-main');
    if(b.dataset.type==='video'){
      main.innerHTML='<video controls muted playsinline autoplay src="'+b.dataset.src+'"'+(b.dataset.poster?' poster="'+b.dataset.poster+'"':'')+'></video>';
    }else{
      main.innerHTML='<img src="'+b.dataset.src+'" alt="">';
    }
    matchFrames();
  }));
}
bindThumbs();
matchFrames();
stripArrows();
// The product-level gallery, kept so a variant's shots can be shown in front
// of it instead of throwing the other angles away.
const PRODUCT_SHOTS=${JSON.stringify(gallery.filter((g) => g.type === 'image').map((g) => ({ url: g.url, alt: g.alt })))};
const VARIANTS=${JSON.stringify(variants)};
var HAS_COLOR=${colors.length > 1},HAS_SIZE=${sizes.length > 1};
// Nothing pre-selected when there's a choice to make.
let sel=(HAS_COLOR||HAS_SIZE)?null:(VARIANTS.find(v=>v.sellable)||VARIANTS[0]);
// Quantity — clamped to the selected variant's max (a one-of-one caps at 1,
// which simply disables +). Re-clamped whenever the chosen variant changes.
let qty=1;
const qw=document.getElementById('qtywrap');
function clampQty(){
  var max=(sel&&sel.max)||1;
  if(qty>max)qty=max; if(qty<1)qty=1;
  var qn=document.getElementById('qn'); if(qn)qn.textContent=qty;
  if(qw){
    var minus=qw.querySelector('[data-q="-1"]'),plus=qw.querySelector('[data-q="1"]');
    if(minus)minus.disabled=qty<=1; if(plus)plus.disabled=qty>=max;
  }
}
if(qw)qw.addEventListener('click',function(e){
  var b=e.target.closest('[data-q]'); if(!b||b.disabled)return;
  qty+=Number(b.getAttribute('data-q')); clampQty();
});
clampQty();
// Two independent choices resolve to one variant. Tracking the CHOICES rather
// than the variant is what lets a shopper change colour without losing the
// size they already picked.
let pickColor=sel&&sel.color,pickSize=sel&&sel.size;
function resolve(){
  // No pre-selection: resolve to a variant only once every choice the product
  // actually offers has been made.
  if((HAS_COLOR&&pickColor==null)||(HAS_SIZE&&pickSize==null)){sel=null;syncBuy();return;}
  const match=VARIANTS.find(v=>(!HAS_COLOR||v.color===pickColor)&&(!HAS_SIZE||v.size===pickSize));
  if(match){applyVariant(match);} else {sel=null;syncBuy();}
}
function syncBuy(){
  var add=document.getElementById('add');if(!add)return;
  var ok=sel&&sel.sellable;
  add.disabled=!ok;
  // Stays "Add to cart" whether or not a variant is chosen — the empty boxes
  // ("Pick colour", "Pick size") carry the prompt, so the button never nags.
  add.textContent='Add to cart';
}
function applyVariant(v){
  sel=v;
  const fmt=(v.price/100).toLocaleString('en-US',{style:'currency',currency:'USD'});
  document.getElementById('price').textContent=fmt;
  // The editorial layout repeats the price inside the button; a variant change
  // that updated one and not the other would show two different prices.
  const bp=document.getElementById('btn-price'); if(bp) bp.textContent=fmt;
  document.getElementById('stock').textContent=v.stock;
  var cv=document.getElementById('color-value');if(cv&&v.color)cv.textContent=v.color;
  var szv=document.getElementById('size-value');if(szv&&v.size)szv.textContent=v.size;
  showVariantShots(v);
  clampQty();
  syncBuy();
}
const sw=document.getElementById('swatches');
if(sw)sw.addEventListener('click',(e)=>{
  const all=e.target.closest('button[data-all]');
  if(all){
    sw.querySelectorAll('button').forEach(x=>x.classList.remove('sel'));
    all.classList.add('sel');
    // Gallery view only: the selected variant is untouched, so Add to cart
    // still refers to the colour already chosen rather than going ambiguous.
    showAllShots();
    return;
  }
  const b=e.target.closest('button[data-color]');if(!b||b.disabled)return;
  sw.querySelectorAll('button').forEach(x=>x.classList.remove('sel'));
  b.classList.add('sel');
  pickColor=b.dataset.color;
  var cv=document.getElementById('color-value');if(cv)cv.textContent=pickColor;
  var cd=document.querySelector('[data-color-dot]');if(cd&&b.dataset.dot){cd.style.cssText=b.dataset.dot;cd.hidden=false;}
  var cbox=document.querySelector('[data-box="color"]');if(cbox)cbox.classList.add('set');
  resolve();closeBox('color');
});
const sz=document.getElementById('sizes');
if(sz)sz.addEventListener('click',(e)=>{
  const b=e.target.closest('button[data-size]');if(!b||b.disabled)return;
  sz.querySelectorAll('button').forEach(x=>x.classList.remove('sel'));
  b.classList.add('sel');
  pickSize=b.dataset.size;
  var szv=document.getElementById('size-value');if(szv)szv.textContent=pickSize;
  var sbox=document.querySelector('[data-box="size"]');if(sbox)sbox.classList.add('set');
  resolve();closeBox('size');
});
// The 3-box picker opens filter-style: a trigger toggles its own panel and
// closes the others (accordion); choosing a value (above) collapses it back.
function closeBox(name){
  var t=document.querySelector('[data-box-toggle="'+name+'"]'),p=document.querySelector('[data-box-panel="'+name+'"]');
  if(t)t.setAttribute('aria-expanded','false'); if(p)p.hidden=true;
}
document.querySelectorAll('[data-box-toggle]').forEach(function(t){
  t.addEventListener('click',function(e){
    if(e.target.closest('[data-box-panel]'))return;
    var name=t.getAttribute('data-box-toggle');
    var panel=document.querySelector('[data-box-panel="'+name+'"]');
    var wasOpen=t.getAttribute('aria-expanded')==='true';
    document.querySelectorAll('[data-box-toggle]').forEach(function(x){x.setAttribute('aria-expanded','false');});
    document.querySelectorAll('[data-box-panel]').forEach(function(x){x.hidden=true;});
    if(!wasOpen&&panel){t.setAttribute('aria-expanded','true');panel.hidden=false;}
  });
});
document.addEventListener('click',function(e){
  if(e.target.closest&&!e.target.closest('.pdp-box')){
    document.querySelectorAll('[data-box-toggle]').forEach(function(x){x.setAttribute('aria-expanded','false');});
    document.querySelectorAll('[data-box-panel]').forEach(function(x){x.hidden=true;});
  }
});
const picker=document.getElementById('picker');
if(picker)picker.addEventListener('click',(e)=>{
  const b=e.target.closest('button[data-variant]');if(!b||b.disabled)return;
  picker.querySelectorAll('button').forEach(x=>x.classList.remove('sel'));
  b.classList.add('sel');
  sel=VARIANTS.find(v=>v.id===b.dataset.variant);
  document.getElementById('price').textContent=(sel.price/100).toLocaleString('en-US',{style:'currency',currency:'USD'});
  // The label, never the count — an untracked variant's "available" is a
  // sentinel, and printing it reads as a billion hats in a warehouse.
  document.getElementById('stock').textContent=sel.stock;
  document.getElementById('add').disabled=!sel.sellable;
  showVariantShots(sel);
  clampQty();
});
/**
 * Picking a colour changes the picture, which is what a shopper expects and
 * what WooCommerce does. The variant's own shots go in front of the product
 * gallery rather than replacing it, so the other angles stay reachable.
 */
/**
 * The strip's arrows: page by a viewport-width at a time, and go dead at the
 * ends instead of disappearing.
 *
 * Re-evaluated whenever the strip's contents change, because choosing a colour
 * swaps 24 thumbnails for four — and four fit, so the arrows must go away.
 */
function stripArrows(){
  var rail=document.querySelector('.gallery-striprail');
  var strip=rail&&rail.querySelector('.gallery-strip');
  if(!rail||!strip)return;
  var fits=strip.scrollWidth<=strip.clientWidth+1;
  rail.setAttribute('data-fits',fits?'1':'0');
  var sync=function(){
    var max=strip.scrollWidth-strip.clientWidth;
    rail.querySelectorAll('[data-strip-dir]').forEach(function(b){
      var d=Number(b.getAttribute('data-strip-dir'));
      b.disabled=d<0?strip.scrollLeft<=1:strip.scrollLeft>=max-1;
    });
  };
  if(!rail.__bound){
    rail.__bound=true;
    rail.querySelectorAll('[data-strip-dir]').forEach(function(b){
      b.addEventListener('click',function(){
        strip.scrollBy({left:Number(b.getAttribute('data-strip-dir'))*strip.clientWidth*0.85,behavior:'smooth'});
      });
    });
    strip.addEventListener('scroll',sync,{passive:true});
    window.addEventListener('resize',function(){stripArrows();});
  }
  sync();
}
function renderStrip(shots){
  var strip=document.querySelector('.gallery-strip');
  var main=document.getElementById('gallery-main');
  if(!shots.length)return;
  if(main)main.innerHTML='<img src="'+shots[0].url+'" alt="'+(shots[0].alt||'')+'">';
  if(!strip)return;
  strip.innerHTML=shots.map(function(g,i){
    return '<button type="button" class="gallery-thumb'+(i===0?' sel':'')+'" data-src="'+g.url+'" data-type="image" aria-label="'+(g.alt||'')+'">'+
           '<img src="'+g.url+'" alt="'+(g.alt||'')+'" loading="lazy"></button>';
  }).join('');
  bindThumbs();
  matchFrames();
  stripArrows();
}
/**
 * Picking a colour shows ONLY that colourway's photographs.
 *
 * The strip used to lead with the variant's shots and keep every other
 * colour's behind them, so choosing black still left five other hats in the
 * thumbnails. Filtering is the point of choosing.
 */
function showVariantShots(v){
  if(!v||!v.image)return;
  renderStrip([{url:v.image,alt:v.label}].concat(v.images||[]));
}
/** Every shot the product has, in variant order, then the product gallery. */
function showAllShots(){
  var seen={},all=[];
  VARIANTS.forEach(function(v){
    [].concat(v.image?[{url:v.image,alt:v.label}]:[], v.images||[]).forEach(function(g){
      if(g&&g.url&&!seen[g.url]){seen[g.url]=1;all.push(g);}
    });
  });
  PRODUCT_SHOTS.forEach(function(g){ if(!seen[g.url]){seen[g.url]=1;all.push(g);} });
  renderStrip(all);
}
// Seed from the selected variant so the strip matches the colour that is
// already chosen, rather than showing the product image alone.
if(sel)showVariantShots(sel);
document.getElementById('add').addEventListener('click',(e)=>{if(sel)addToCart(sel.id,qty,e.target)});
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
  // Counter templates: a published template for a slot replaces the built-in
  // screen, and anything else — no template, a draft, an empty render — leaves
  // the built-in screen exactly as it was. Templates are additive by design;
  // see src/counter/storefrontTemplates.ts.
  const slotBody = async (slot: TemplateSlot, builtIn: string): Promise<string> =>
    (await templateHtml(slot).catch(() => null)) ?? builtIn;

  // Cart and checkout are per-shopper and carry nothing a search engine should
  // hold, so they are noindex rather than canonicalised.
  const flowPage = async (title: string, section: string, slot: TemplateSlot): Promise<string> =>
    page(title, `${await heading(section)}${await slotBody(slot, checkoutFlowMarkup())}`, CHECKOUT_FLOW_RUNTIME, PRIVATE_PAGE);

  app.get('/cart', async (_req, reply) => {
    if (!(await commerceOn())) return html(reply, closedPage());
    html(reply, await flowPage('Cart — Therum Store', 'Cart', 'cart'));
  });

  app.get('/checkout', async (_req, reply) => {
    if (!(await commerceOn())) return html(reply, closedPage());
    html(reply, await flowPage('Checkout — Therum Store', 'Checkout', 'checkout'));
  });

  // ── The other two header icons ────────────────────────────────────────
  // Both are ordinary store pages so they inherit the site chrome, the cart
  // drawer and the wishlist runtime without any of it being repeated here.
  app.get('/account', async (_req, reply) => {
    if (!(await commerceOn())) return html(reply, closedPage());
    // The account page is the only page that offers social sign-in, so it is
    // the only page whose CSP admits accounts.google.com — see pageCsp.ts.
    // The client id is public by design (it is in every Google sign-in button
    // on the web); the SECRET stays server-side and is never sent here.
    const gApp = await googleApp();
    // The wishlist tab embeds the real wishlist markup so wishlist.ts's runtime
    // — already on every store page for the hearts — hydrates it. One list,
    // one implementation.
    html(
      reply,
      await page('Account — Therum Store', `${await heading('Account')}${await slotBody('account', accountMarkup(wishlistMarkup(), gApp?.clientId ?? ''))}`, ACCOUNT_RUNTIME, PRIVATE_PAGE),
      ACCOUNT_PAGE_CSP,
    );
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
  // ── One page per role ────────────────────────────────────────────────
  //
  // Every Apply on the careers index pointed at the generic contact form, so
  // nothing recorded which role a person wanted and there was nowhere to
  // attach a CV.
  app.get('/careers/:slug', async (req, reply) => {
    const slug = String((req.params as { slug?: string }).slug ?? '').slice(0, 80);
    const role = roleBySlug(slug);
    if (!role) return reply.status(404).send(await page('Role not found — The Sidemoney Company',
      '<div class="empty-state"><div class="big">🔍</div><h1 class="page-title">That role is not open</h1>'
      + '<p class="page-sub"><a href="/careers">See the roles we are hiring for</a></p></div>', '', PRIVATE_PAGE));
    html(reply, await page(`${role.title} — Careers — The Sidemoney Company`,
      `<style>${CAREERS_CSS}</style>${rolePage(role)}`,
      CAREERS_RUNTIME,
      {
        description: `${role.title} at The Sidemoney Company. ${role.terms}. ${role.blurb}`,
        canonical: `/careers/${role.slug}`,
        origin: originOf(req),
        siteName: 'The Sidemoney Company',
      },
    ));
  });

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

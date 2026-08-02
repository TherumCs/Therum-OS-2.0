import { esc, money } from './storefrontHtml.js';
import { wishlistButton } from './wishlist.js';

// Counter's product card, in the SITE THEME's own markup contract.
//
// Read off the live source (:10025) rather than invented: the theme styles
// .c-product-grid__*, and the ported stylesheet is already loaded on store
// pages. Emitting Counter's generic .card markup meant none of that CSS
// applied, so the shop looked nothing like the rest of the site.
//
// ── THREE INDEPENDENT AXES (Settings > Counter) ───────────────────────────
//
// They are separate settings because they are separate questions, and any
// combination is legitimate — an editorial card can still play a hover video,
// a boxed card can still be action-free.
//
//   SHELL    does the card have a container, or is it just the image on the
//            page? Bam's words: "actual cards or just the images on the page."
//              bare      no box. Image sits on the page. The &Kin look.
//              boxed     a surface with a hairline and a radius.
//              elevated  a soft raised surface, inset image tile.
//
//   MEDIA    what the image DOES. One behaviour per card, never a pile of
//            them — a hover video AND hover arrows AND a floating button
//            competing over one image is exactly what was broken:
//              * .card:hover .card-nav never matched, because the
//                theme-shaped card is .c-product-grid__item; the arrows were
//                permanently opacity:0.
//              * the runtime did m.closest('.card').addEventListener(...),
//                which threw on null — killing the hover-video binding AND
//                every card after it in the loop.
//              * the overlay button sat on top of the product either way.
//            A card that asks for a behaviour its product cannot support
//            (motion with no video, gallery with one photo) falls back down
//            the list rather than rendering something dead.
//
//   PRESET   which rows of information the card carries, modelled on the five
//            references Bam sent:
//              editorial  name, price, colour swatches. Nothing else.
//              retail     name + price on one line, subtitle, swatches, and
//                         an outlined action.
//              detailed   spec line, price beside swatches, two actions.
//              sneaker    brand pill, rating, size chips, buy + bag.
//              data       info tiles (rating, variants), icon actions, and a
//                         was-price when the product carries one.
//
// and where the buy button goes is its own setting again, because "which
// information" and "which action" are not the same choice.

export interface GridMedia {
  type: 'image' | 'video';
  url: string;
  poster?: string | null;
}

export interface GridProduct {
  /** Needed by the wishlist heart, which stores product ids. */
  id: string;
  slug: string;
  name: string;
  priceFrom: number;
  priceRange: boolean;
  media: GridMedia[];
  subtitle?: string | null;
  /** Variable products send the shopper to the PDP to choose; simple ones add directly. */
  hasOptions: boolean;
  /** Single-variant products can be bought without a trip to the PDP. */
  quickVariantId?: string | null;
  /** Total sellable across variants — drives the sold-out / low-stock mark. */
  stock?: number;
  /** Vendor name, shown as a brand pill by the presets that use one. */
  brand?: string | null;
  /** Distinct variant colours, in variant order. Drives the swatch row. */
  colors?: string[];
  /**
   * The provider's real hex per colour name, so the card paints the same
   * swatch the product page does. Without it the card can only GUESS from the
   * name via CSS named colours — which works for "navy" and fails for
   * "Dark Green/Natural", the exact colours a print-on-demand catalogue is
   * full of.
   */
  colorCodes?: Record<string, string[]>;
  /** Distinct variant sizes. Drives the size-chip row. */
  sizes?: string[];
  /**
   * The full variant list, needed by the 'evolve' action — the in-card picker
   * has to resolve a colour+size choice back to a real variant id, and it can
   * only do that from the variants themselves.
   */
  variants?: { id: string; color: string | null; size: string | null; price: number; available: number }[];
  /**
   * Per-product overrides from `product.meta` — one product can ask for a
   * different media behaviour or information layout without the store-wide
   * setting changing for everything else.
   */
  mediaOverride?: CardMedia | null;
  presetOverride?: CardPreset | null;
  /**
   * The signed-in shopper's milieu discount, as a percentage. Applied to the
   * displayed price rather than shown as a saving: a membership is a standing
   * relationship, not a sale, and a permanent strike-through only makes the
   * list price look like the lie. See `memberPricing` in settings.
   */
  memberPct?: number;
  memberLabel?: string;
  memberDisplay?: 'off' | 'net' | 'was-now';
  /** Approved-review average + count, when the store has any. */
  rating?: { average: number; count: number } | null;
  /**
   * A was-price, from `product.meta.compareAtPrice` (minor units). There is
   * no column for it, so a store that has never set one simply never shows a
   * discount — which is the honest outcome, not a faked strike-through.
   */
  compareAt?: number | null;
}

export type CardShell = 'bare' | 'boxed' | 'elevated';
export type CardMedia = 'still' | 'fade' | 'gallery' | 'motion';
/**
 * What a merchant can PICK. 'auto' is not a behaviour a card renders — it is
 * "read the product and decide", and it is the shipped default.
 */
export type CardMediaSetting = CardMedia | 'auto';
export type CardAction = 'none' | 'below' | 'overlay' | 'dual' | 'icons';
export type CardAlign = 'start' | 'center' | 'end';
export type CardRadius = 'sharp' | 'soft' | 'round' | 'pill' | 'squircle';
export type CardRatio = 'square' | 'portrait' | 'tall' | 'landscape' | 'natural';
export type CardReveal = 'none' | 'fade' | 'rise' | 'stagger';
export type CardPreset = 'editorial' | 'retail' | 'detailed' | 'sneaker' | 'data';

export interface CardConfig {
  shell: CardShell;
  /** The behaviour a product gets when it can support it. */
  media: CardMediaSetting;
  /** What it falls back to when it cannot. A merchant's choice, not a chain. */
  mediaSecondary: CardMediaSetting;
  action: CardAction;
  /**
   * Evolve is a MODIFIER, not an action: any card that can add to the cart can
   * flip into an in-place variant picker first. Only 'none' is exempt — a card
   * with no add-to-cart has nothing to evolve.
   */
  evolve: boolean;
  align: CardAlign;
  radius: CardRadius;
  ratio: CardRatio;
  fit: 'cover' | 'contain';
  shadow: 'none' | 'soft' | 'strong';
  hover: 'none' | 'lift' | 'zoom' | 'both';
  gap: 'tight' | 'normal' | 'roomy';
  reveal: CardReveal;
  preset: CardPreset;
  subtitle: boolean;
  badges: boolean;
  wishlist: boolean;
}

export const CARD_DEFAULTS: CardConfig = {
  shell: 'bare', media: 'auto', mediaSecondary: 'still', action: 'none', evolve: true,
  align: 'start', radius: 'sharp', ratio: 'square', fit: 'cover', shadow: 'soft',
  hover: 'none', gap: 'normal', reveal: 'none', preset: 'editorial',
  subtitle: true, badges: true, wishlist: true,
};

/** Can this product actually do this? */
function supports(style: CardMediaSetting, stills: number, hasVideo: boolean): boolean {
  if (style === 'auto') return false; // never a behaviour, only an instruction
  if (style === 'motion') return hasVideo;
  if (style === 'gallery') return stills >= 2;
  if (style === 'fade') return stills >= 2;
  return true; // 'still' always works — that is why it is the last resort
}

/** What the product's own media says it wants to be, richest first. */
function fromProduct(stills: number, hasVideo: boolean): CardMedia {
  if (hasVideo) return 'motion';
  if (stills >= 2) return 'gallery';
  return 'still';
}

/**
 * Primary, else secondary, else still.
 *
 * A per-product override (`product.meta.cardMedia`) takes the primary slot,
 * so "customize a random product" means exactly that: that one card asks for
 * something different, and still falls back the same way if its own media
 * cannot carry it.
 *
 * 'auto' — the shipped default — means the PRODUCT decides: one with a video
 * is a motion card, one with several photos is a gallery card. The old default
 * was a hard 'fade' with 'still' behind it, so a product carrying a video still
 * rendered a static image and neither the hover-video nor the arrows card could
 * ever appear. A style a merchant actually picked is still obeyed — 'auto' is
 * the absence of a choice, not an override of one.
 */
export function resolveMedia(cfg: CardConfig, override: CardMedia | null, stills: number, hasVideo: boolean): CardMedia {
  // The per-product override takes the primary slot; it is never 'auto',
  // because "no override" already means exactly that.
  const first = override ?? cfg.media;
  if (first === 'auto') return fromProduct(stills, hasVideo);
  if (supports(first, stills, hasVideo)) return first;

  const second = cfg.mediaSecondary;
  if (second === 'auto') return fromProduct(stills, hasVideo);
  if (supports(second, stills, hasVideo)) return second;
  return 'still';
}

/** Which rows each preset carries. The preset IS this table. */
const PRESET_ROWS: Record<CardPreset, {
  brandPill: boolean;
  rating: boolean;
  swatches: boolean;
  sizeChips: boolean;
  infoTiles: boolean;
  /** Price sits on the same line as the name rather than beneath it. */
  priceInline: boolean;
}> = {
  editorial: { brandPill: false, rating: false, swatches: true,  sizeChips: false, infoTiles: false, priceInline: false },
  retail:    { brandPill: false, rating: false, swatches: true,  sizeChips: false, infoTiles: false, priceInline: true  },
  detailed:  { brandPill: false, rating: false, swatches: true,  sizeChips: false, infoTiles: false, priceInline: false },
  sneaker:   { brandPill: true,  rating: true,  swatches: false, sizeChips: true,  infoTiles: false, priceInline: false },
  data:      { brandPill: true,  rating: false, swatches: false, sizeChips: false, infoTiles: true,  priceInline: false },
};

/**
 * A colour name to a swatch. Named CSS colours cover most of what a merchant
 * types ("olive", "navy"); anything else falls back to a labelled chip rather
 * than a mystery grey circle that says nothing.
 */
function swatch(color: string, codes: string[] = []): string {
  // The provider's own hex wins over any guess. Two codes is a hard split,
  // not a blend: "Red/Natural" is a red cap with a natural panel, and a
  // gradient between them invents a colour that is on neither.
  const safe = codes.filter((c) => /^#[0-9a-f]{3,8}$/i.test(c));
  if (safe.length) {
    const paint = safe.length === 1
      ? `background:${safe[0]}`
      : `background:linear-gradient(135deg, ${safe[0]} 0 50%, ${safe[1]} 50% 100%)`;
    return `<span class="card-swatch" style="${paint}" title="${esc(color)}" aria-label="${esc(color)}"></span>`;
  }
  const named = /^[a-z]+$/i.test(color.trim());
  return named
    ? `<span class="card-swatch" style="background:${esc(color.toLowerCase())}" title="${esc(color)}" aria-label="${esc(color)}"></span>`
    : `<span class="card-swatch card-swatch--named" title="${esc(color)}">${esc(color.slice(0, 3))}</span>`;
}

function stars(r: { average: number; count: number }): string {
  return `<span class="card-rating" aria-label="${r.average.toFixed(1)} out of 5">★ ${r.average.toFixed(2)}<span class="card-rating__n">(${r.count})</span></span>`;
}

/**
 * `perRow` is not decoration on the item — the ported theme sizes cards with
 * `width: calc(100% / N)` keyed off `.c-product-grid__item--N-per-row`, so this
 * class IS the column width. It used to be hardcoded to 4, which is why moving
 * the Columns setting changed the class on the LIST and nothing about the cards.
 */
export function productCard(p: GridProduct, cfg: CardConfig = CARD_DEFAULTS, perRow = 4): string {
  // Per-product overrides beat the store-wide setting. Everything else about
  // the card still comes from settings, so one odd product does not become a
  // second card implementation.
  const rows = PRESET_ROWS[p.presetOverride ?? cfg.preset];
  const stills = p.media.filter((m) => m.type === 'image');
  const video = p.media.find((m) => m.type === 'video') ?? null;
  const href = `/product/${esc(p.slug)}`;

  const media = resolveMedia(cfg, p.mediaOverride ?? null, stills.length, Boolean(video));

  const base = stills[0]?.url ?? video?.poster ?? null;
  const hover = stills[1]?.url ?? null;

  const img = (url: string, cls: string, alt = '') =>
    `<img class="c-product-grid__thumb c-product-grid__thumb--contain ${cls}" src="${esc(url)}" alt="${esc(alt)}" loading="lazy" decoding="async"${alt ? '' : ' aria-hidden="true"'}>`;

  const thumb = !base && !video
    ? `<div class="c-product-grid__thumb c-product-grid__thumb--base" aria-hidden="true"></div>`
    : [
        base ? img(base, 'c-product-grid__thumb--base card-still', p.name) : '',
        // The hover still is only emitted for the styles that use it. An
        // invisible second image on every card of a 'still' grid is bytes and
        // requests spent on nothing.
        (media === 'fade' || media === 'motion') && hover ? img(hover, 'c-product-grid__thumb--hover') : '',
        media === 'motion' && video
          ? `<video class="card-video" muted loop playsinline preload="none" src="${esc(video.url)}"${video.poster ? ` poster="${esc(video.poster)}"` : ''}></video>`
          : '',
      ].join('');

  const galleryNav = media === 'gallery'
    ? `<button class="card-nav prev" data-dir="-1" aria-label="Previous image" type="button">‹</button>
       <button class="card-nav next" data-dir="1" aria-label="Next image" type="button">›</button>
       <div class="card-dots">${stills.map((_, i) => `<span class="dot${i === 0 ? ' on' : ''}"></span>`).join('')}</div>`
    : '';

  const soldOut = typeof p.stock === 'number' && p.stock <= 0;
  const lowStock = typeof p.stock === 'number' && p.stock > 0 && p.stock <= 3;
  const discountPct = p.compareAt && p.compareAt > p.priceFrom
    ? Math.round(((p.compareAt - p.priceFrom) / p.compareAt) * 100)
    : 0;

  const marks = cfg.badges
    ? [
        discountPct ? `<span class="card-badge card-badge--deal">-${discountPct}%</span>` : '',
        soldOut ? `<span class="card-badge card-badge--out">Sold out</span>`
          : lowStock ? `<span class="card-badge">Low stock</span>` : '',
      ].filter(Boolean).join('')
    : '';
  const markStrip = marks ? `<div class="card-marks">${marks}</div>` : '';

  // ── Actions ─────────────────────────────────────────────────────────────
  // A product with choices to make cannot be quick-bought — guessing a size
  // for someone is worse than one extra click.
  const canQuickBuy = !p.hasOptions && !!p.quickVariantId && !soldOut;
  const buyAttrs = canQuickBuy
    ? `type="button" data-quick-buy="${esc(p.quickVariantId!)}"`
    : '';
  // Without evolve, a product with choices has to go to the PDP to make them,
  // so the label says so rather than promising an add that cannot happen here.
  const primaryLabel = canQuickBuy ? 'Add to cart' : 'Select options';
  const primary = soldOut
    ? `<span class="card-btn card-btn--out">Sold out</span>`
    : canQuickBuy
      ? `<button ${buyAttrs} class="card-btn card-btn--solid">Add to cart</button>`
      : `<a href="${href}" class="card-btn card-btn--solid">Select options</a>`;
  // Evolve only means anything when there is a choice to make AND the card
  // actually offers an add-to-cart. A single-variant product adds in one tap
  // either way; asking someone to "choose" from one option is a step that
  // exists only to be dismissed.
  const needsChoice = cfg.evolve && cfg.action !== 'none' && !soldOut && !canQuickBuy && (p.variants?.length ?? 0) > 0;

  const evolveOpen = (label: string): string =>
    `<button class="card-btn card-btn--solid" type="button" data-evolve-open>${esc(label)}</button>`;
  const secondary = soldOut ? '' : `<a href="${href}" class="card-btn card-btn--ghost">Explore</a>`;

  const iconRow = `
    <div class="card-icons">
      ${cfg.wishlist ? `<button class="card-icon" type="button" data-wishlist-toggle="${esc(p.id)}" aria-label="Add to wishlist" aria-pressed="false"><span class="card-icon__heart"></span></button>` : ''}
      ${soldOut
        ? `<span class="card-icon card-icon--off" aria-hidden="true">⌫</span>`
        : needsChoice
          ? `<button class="card-icon card-icon--solid" type="button" data-evolve-open aria-label="Choose options">⌂</button>`
          : canQuickBuy
            ? `<button class="card-icon card-icon--solid" type="button" ${buyAttrs} aria-label="Add to cart">⌂</button>`
            : `<a class="card-icon card-icon--solid" href="${href}" aria-label="Select options">⌂</a>`}
    </div>`;

  // ── 'evolve': two CTAs, and the card itself becomes the picker ──────────
  //
  // Explore stays a real <a href> so middle-click, open-in-new-tab and
  // crawlers all still work; only Add to cart is JavaScript. Tapping it flips
  // this face to the picker below rather than opening a modal, so the shopper
  // never loses their place in the grid.
  //
  // A single-variant product skips the picker entirely — asking someone to
  // "choose" from one option is a step that exists only to be dismissed. Its
  // button is a plain data-quick-buy, exactly like every other card.
  // The resting face is whatever the chosen action renders; the picker is the
  // same second face regardless, so Below, Dual, Icons and Overlay all evolve.
  const restFace =
    cfg.action === 'below' ? `<div class="card-actions">${needsChoice ? evolveOpen(primaryLabel) : primary}</div>`
    : cfg.action === 'dual' ? `<div class="card-actions card-actions--dual">${needsChoice ? evolveOpen(primaryLabel) : primary}${secondary}</div>`
    : cfg.action === 'icons' ? iconRow
    : '';

  const pickFace = needsChoice ? `
      <div class="card-picker" data-evolve-face="pick" hidden
           data-variants='${esc(JSON.stringify(p.variants!.map((v) => ({ i: v.id, c: v.color, s: v.size, p: v.price, a: v.available }))))}'>
        <button class="card-picker__back" type="button" data-evolve-close aria-label="Back">‹</button>
        <div class="card-picker__rows"></div>
        <button class="card-btn card-btn--solid" type="button" data-evolve-confirm disabled>Choose an option</button>
      </div>
      <div class="card-pay" data-evolve-face="pay" hidden>
        <button class="card-picker__back" type="button" data-pay-back aria-label="Back">‹</button>
        <div class="card-pay__sum" data-pay-sum></div>
        <!-- Quick checkout completes HERE. The shopper never leaves the card,
             which is the whole point: the previous flow ended by handing the
             variant to checkoutFlow.ts, which opened the cart drawer. -->
        <!-- Wallets first: Apple/Google Pay return the payer's contact and
             shipping address themselves, so the fast path needs no form at
             all. The card path below is the fallback. -->
        <!-- TWO STEPS, in the order a shopper thinks in: where it goes, then
             how it is paid for. The first build put the method strip above the
             address, which asked "how are you paying" before "where are we
             sending it" — and showed a wall of disabled payment pills as the
             first thing in the card.

             Wallets are the exception and sit on top: Apple and Google Pay
             return the payer's contact AND shipping address themselves, so
             that path skips the form rather than filling it in. -->
        <div class="card-pay__step" data-pay-step="details">
          <div class="card-pay__wallets" data-pay-wallets hidden></div>
          <div class="card-pay__or" data-pay-or hidden>or enter your details</div>
          <input class="card-pay__in" data-pay-email type="email" placeholder="Email for your receipt" autocomplete="email">
          <input class="card-pay__in" data-pay-name placeholder="Full name" autocomplete="shipping name">
          <input class="card-pay__in" data-pay-line1 placeholder="Street address" autocomplete="shipping address-line1">
          <div class="card-pay__row">
            <input class="card-pay__in" data-pay-city placeholder="City" autocomplete="shipping address-level2">
            <input class="card-pay__in" data-pay-region placeholder="State" autocomplete="shipping address-level1">
          </div>
          <div class="card-pay__row">
            <input class="card-pay__in" data-pay-postal placeholder="ZIP" autocomplete="shipping postal-code">
            <input class="card-pay__in" data-pay-country placeholder="US" maxlength="2" autocomplete="shipping country">
          </div>
          <button class="card-btn card-btn--solid" type="button" data-pay-next>Continue to payment</button>
        </div>

        <div class="card-pay__step" data-pay-step="payment" hidden>
          <!-- Where it is going, echoed back. Changing it is one tap, so the
               shopper never has to guess whether the address took. -->
          <div class="card-pay__shipto" data-pay-shipto></div>
          <div class="card-pay__methodwrap" data-pay-methodwrap></div>
          <!-- The gateway's own hosted card field mounts here. Raw card numbers
               are never collected by our inputs — that is what keeps this out of
               PCI scope, and it is why there is no card-number input above. -->
          <div class="card-pay__cardfield" data-pay-cardfield hidden></div>
          <button class="card-btn card-btn--solid" type="button" data-pay-go>Pay</button>
        </div>
        <p class="card-pay__msg" data-pay-msg></p>
      </div>` : '';

  const actionBlock = cfg.action === 'none' || cfg.action === 'overlay'
    ? ''
    : needsChoice
      ? `<div class="card-evolve" data-evolve><div data-evolve-face="rest">${restFace}</div>${pickFace}</div>`
      : restFace;

  const overlayAction = cfg.action === 'overlay'
    ? `<div class="c-product-grid__atc-block">${
        needsChoice
          ? `<div class="card-evolve" data-evolve><div data-evolve-face="rest">${evolveOpen(primaryLabel)}</div>${pickFace}</div>`
          : primary
      }</div>`
    : '';

  // ── Content rows ────────────────────────────────────────────────────────
  const brandPill = rows.brandPill && p.brand ? `<span class="card-pill">${esc(p.brand)}</span>` : '';
  const ratingEl = rows.rating && p.rating?.count ? stars(p.rating) : '';
  const metaRow = brandPill || ratingEl ? `<div class="card-meta">${brandPill}${ratingEl}</div>` : '';

  // Two different reductions, shown two different ways on purpose.
  //   SALE (compareAt) keeps the strike-through — it is temporary, and the
  //        old price is the point.
  //   MEMBER pricing replaces the number outright under 'net'. The list price
  //        is not a claim being made to this shopper at all.
  const memberPct = p.memberDisplay && p.memberDisplay !== 'off' ? (p.memberPct ?? 0) : 0;
  const memberPrice = memberPct > 0 ? Math.round(p.priceFrom * (1 - memberPct / 100)) : p.priceFrom;
  const showMemberWas = memberPct > 0 && p.memberDisplay === 'was-now';

  const priceEl = `<span class="price">`
    + `<span class="woocommerce-Price-amount amount">${p.priceRange ? 'From ' : ''}${money(memberPrice)}</span>`
    + (showMemberWas ? `<del class="card-was">${money(p.priceFrom)}</del>` : '')
    // A sale strike-through is suppressed while member pricing is active —
    // two struck-out numbers beside one price is noise, not information.
    + (discountPct && memberPct === 0 ? `<del class="card-was">${money(p.compareAt!)}</del>` : '')
    + `</span>`
    // Quiet, not a badge. A member who cannot tell WHY their prices differ
    // from a friend's has been given a discount and a mystery.
    + (memberPct > 0 && p.memberLabel ? `<span class="card-member">${esc(p.memberLabel)}</span>` : '');

  const swatches = rows.swatches && p.colors?.length
    ? `<div class="card-swatches">${p.colors.slice(0, 6).map((c) => swatch(c, p.colorCodes?.[c] ?? [])).join('')}${p.colors.length > 6 ? `<span class="card-swatch card-swatch--more">+${p.colors.length - 6}</span>` : ''}</div>`
    : '';

  // Size chips LINK to the PDP with the size preselected — they are not a
  // picker. Choosing a size on a grid tile and having it silently not carry
  // through to the product page is worse than not offering it.
  const sizeChips = rows.sizeChips && p.sizes?.length
    ? `<div class="card-sizes"><span class="card-sizes__label">Size</span>${
        p.sizes.slice(0, 5).map((s) => `<a class="card-size" href="${href}?size=${encodeURIComponent(s)}">${esc(s)}</a>`).join('')
      }</div>`
    : '';

  const infoTiles = rows.infoTiles
    ? `<div class="card-tiles">
         ${p.rating?.count ? `<span class="card-tile"><b>★ ${p.rating.average.toFixed(1)}</b><i>${p.rating.count} reviews</i></span>` : ''}
         ${p.colors?.length ? `<span class="card-tile"><b>${p.colors.length}</b><i>colour${p.colors.length === 1 ? '' : 's'}</i></span>` : ''}
         ${p.sizes?.length ? `<span class="card-tile"><b>${p.sizes.length}</b><i>size${p.sizes.length === 1 ? '' : 's'}</i></span>` : ''}
       </div>`
    : '';

  const titleBlock = rows.priceInline
    ? `<div class="card-title-row">
         <a href="${href}" class="woocommerce-LoopProduct-link woocommerce-loop-product__link">
           <h2 class="woocommerce-loop-product__title"><span class="c-product-grid__title">${esc(p.name)}</span></h2>
         </a>
         <div class="c-product-grid__price-wrap">${priceEl}</div>
       </div>
       ${cfg.subtitle && p.subtitle ? `<div class="c-product-grid__short-desc">${esc(p.subtitle)}</div>` : ''}`
    : `<a href="${href}" class="woocommerce-LoopProduct-link woocommerce-loop-product__link">
         <h2 class="woocommerce-loop-product__title woocommerce-loop-product__title--left"><span class="c-product-grid__title">${esc(p.name)}</span></h2>
       </a>
       ${cfg.subtitle && p.subtitle ? `<div class="c-product-grid__short-desc">${esc(p.subtitle)}</div>` : ''}
       <div class="c-product-grid__price-wrap">${priceEl}</div>`;

  return `
<div class="c-product-grid__item c-product-grid__item--${perRow}-per-row c-product-grid__item--1-per-row-mobile product counter-product card-shell-${cfg.shell} card-preset-${p.presetOverride ?? cfg.preset} card-media-${media} card-align-${cfg.align} card-radius-${cfg.radius} card-ratio-${cfg.ratio} card-fit-${cfg.fit} card-shadow-${cfg.shadow}${cfg.hover === 'none' ? '' : ` card-hover-${cfg.hover}`}${cfg.reveal === 'none' ? '' : ` card-reveal card-reveal--${cfg.reveal}`}${soldOut ? ' is-sold-out' : ''}">
  <div class="c-product-grid__thumb-wrap c-product-grid__thumb-wrap--buttons card-media" data-stills='${esc(JSON.stringify(stills.map((s) => s.url)))}'>
    <a href="${href}" class="woocommerce-LoopProduct-link woocommerce-loop-product__link">${thumb}</a>
    ${markStrip}
    ${cfg.wishlist && cfg.action !== 'icons' ? wishlistButton(p.id) : ''}
    ${galleryNav}
    ${overlayAction}
  </div>
  <div class="c-product-grid__details">
    ${metaRow}
    <div class="c-product-grid__title-wrap">${titleBlock}</div>
    ${swatches}
    ${sizeChips}
    ${infoTiles}
    ${actionBlock}
  </div>
</div>`;
}

/**
 * The grid wrapper. `data-count` and the layout data-attributes are part of
 * the theme's contract — its own CSS and scripts read them to decide column
 * counts, so omitting them leaves the grid unstyled even with correct items.
 */
export function productGrid(products: GridProduct[], perRow = 4, cfg: CardConfig = CARD_DEFAULTS): string {
  return `
<div class="c-product-grid">
  <div class="c-product-grid__wrap c-product-grid__wrap--${perRow}-per-row c-product-grid__wrap--1-per-row-mobile c-product-grid__wrap--boxed c-product-grid__wrap--cnt-${products.length}">
    <div class="c-product-grid__list c-product-grid__list--${perRow}-per-row c-product-grid__list--boxed c-product-grid__list--1-per-row-mobile card-gap-${cfg.gap}"
         data-cols="${perRow}" data-count="${products.length}" data-layout="${perRow}-per-row" data-layout-width="boxed" data-layout-mobile="1-per-row-mobile">
      ${products.map((p) => productCard(p, cfg, perRow)).join('')}
    </div>
  </div>
</div>`;
}

/**
 * Reveal-on-scroll.
 *
 * Only shipped when the reveal setting is not 'none'. IntersectionObserver
 * rather than a load-time animation: a card the shopper has already scrolled
 * past should be there, not arriving. `unobserve` after the first reveal, so
 * scrolling back up does not replay it.
 *
 * If the browser has no IntersectionObserver, everything is shown immediately
 * — a decorative animation must never be the reason a product is invisible.
 */
export const CARD_REVEAL_RUNTIME = `
(function(){
  var cards = document.querySelectorAll('.card-reveal');
  if (!cards.length) return;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || !('IntersectionObserver' in window)) {
    cards.forEach(function(c){ c.classList.add('is-shown'); });
    return;
  }
  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if (!e.isIntersecting) return;
      e.target.classList.add('is-shown');
      io.unobserve(e.target);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  cards.forEach(function(c){ io.observe(c); });
})();
`;

/**
 * The 'evolve' card's runtime.
 *
 * Only shipped when the action is 'evolve' — every other card is pure HTML and
 * costs nothing. The picker resolves a colour+size choice back to a real
 * variant id from the card's own data, then hands that id to the EXISTING
 * quick-buy sheet (checkoutFlow.ts, data-quick-buy). It deliberately does not
 * contain a checkout of its own: a second payment flow is a second thing to
 * keep in step with the first, and that is how they drift.
 */
export const CARD_EVOLVE_RUNTIME = `
(function(){
  function money(m){ return (m/100).toLocaleString('en-US',{ style:'currency', currency:'USD' }); }
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]; }); }
  function uniq(a){ return a.filter(function(v, i){ return v != null && a.indexOf(v) === i; }); }

  document.querySelectorAll('[data-evolve]').forEach(function(root){
    var rest = root.querySelector('[data-evolve-face="rest"]');
    var pick = root.querySelector('[data-evolve-face="pick"]');
    if (!pick) return;   // single-variant card: nothing to choose

    var variants = [];
    try { variants = JSON.parse(pick.getAttribute('data-variants') || '[]'); } catch (e) { return; }
    var rowsEl = pick.querySelector('.card-picker__rows');
    var confirm = pick.querySelector('[data-evolve-confirm]');
    var priceEl = root.closest('.c-product-grid__item').querySelector('.woocommerce-Price-amount');
    var priceWas = priceEl ? priceEl.textContent : '';

    var colors = uniq(variants.map(function(v){ return v.c; }));
    var sizes = uniq(variants.map(function(v){ return v.s; }));
    var chosen = { c: colors.length === 1 ? colors[0] : null, s: sizes.length === 1 ? sizes[0] : null };

    // Which variant the current choice resolves to. Null while the shopper
    // still has something to pick, or if the combination does not exist.
    function match(){
      return variants.filter(function(v){
        return (chosen.c === null || v.c === chosen.c) && (chosen.s === null || v.s === chosen.s);
      })[0] || null;
    }
    // Is any in-stock variant reachable if they pick this value next?
    function reachable(key, value){
      return variants.some(function(v){
        var other = key === 'c' ? 's' : 'c';
        return v[key] === value && (chosen[other] === null || v[other] === chosen[other]) && v.a > 0;
      });
    }

    function row(key, label, values){
      if (values.length < 2) return '';
      return '<div class="card-opt-row"><span class="card-opt-row__label">' + esc(label) + '</span>'
        + values.map(function(v){
            var live = reachable(key, v);
            var on = chosen[key] === v;
            var isColor = key === 'c' && /^[a-z]+$/i.test(String(v).trim());
            return '<button type="button" class="card-opt' + (isColor ? ' card-opt-swatch' : '') + (on ? ' on' : '') + '"'
              + (live ? '' : ' disabled')
              + ' data-opt-key="' + key + '" data-opt-value="' + esc(v) + '"'
              + (isColor ? ' style="background:' + esc(String(v).toLowerCase()) + '" title="' + esc(v) + '" aria-label="' + esc(v) + '"' : '')
              + '>' + (isColor ? '' : esc(v)) + '</button>';
          }).join('')
        + '</div>';
    }

    function draw(){
      rowsEl.innerHTML = row('c', 'Colour', colors) + row('s', 'Size', sizes);
      var v = match();
      var ready = !!v && v.a > 0
        && (colors.length < 2 || chosen.c !== null)
        && (sizes.length < 2 || chosen.s !== null);
      confirm.disabled = !ready;
      confirm.textContent = ready ? 'Buy now'
        : (v && v.a <= 0) ? 'Out of stock'
        : 'Choose an option';
      // The price follows the choice, so a variant that costs more is not a
      // surprise at the sheet.
      if (priceEl) priceEl.textContent = v ? money(v.p) : priceWas;
      // Deliberately NOT data-quick-buy: that attribute is what checkoutFlow
      // picks up to open the cart drawer, and quick checkout must finish in
      // the card. The chosen variant is held here instead.
      chosenVariant = ready ? v : null;
    }

    rowsEl.addEventListener('click', function(e){
      var b = e.target.closest('[data-opt-key]');
      if (!b || b.disabled) return;
      var k = b.getAttribute('data-opt-key');
      var val = b.getAttribute('data-opt-value');
      chosen[k] = chosen[k] === val ? null : val;   // tapping the choice again clears it
      draw();
    });

    function face(which){
      rest.hidden = which !== 'rest';
      pick.hidden = which !== 'pick';
      var payFace = root.querySelector('[data-evolve-face=\"pay\"]');
      if (payFace) payFace.hidden = which !== 'pay';
      if (which === 'rest' && priceEl) priceEl.textContent = priceWas;
    }
    root.querySelector('[data-evolve-open]').addEventListener('click', function(){ draw(); face('pick'); });
    pick.querySelector('[data-evolve-close]').addEventListener('click', function(){ face('rest'); });
    // Escape returns to the resting face rather than doing nothing — the card
    // is a mode, and every mode needs a way out that is not a click target.
    root.addEventListener('keydown', function(e){ if (e.key === 'Escape') face('rest'); });

    // ── Quick checkout: it completes here ────────────────────────────────
    var payEl = root.querySelector('[data-evolve-face=\"pay\"]');
    var chosenVariant = null;
    var payProvider = null;

    function payQ(sel){ return payEl ? payEl.querySelector(sel) : null; }
    function say(msg, bad){
      var m = payQ('[data-pay-msg]');
      if (m) { m.textContent = msg || ''; m.className = 'card-pay__msg' + (bad ? ' is-bad' : ''); }
    }

    function addr(){
      function v(sel){ var n = payQ(sel); return n && n.value ? n.value.trim() : ''; }
      var a = { name: v('[data-pay-name]'), line1: v('[data-pay-line1]'), city: v('[data-pay-city]'),
                country: v('[data-pay-country]').toUpperCase() };
      var r = v('[data-pay-region]'); if (r) a.region = r;
      var pc = v('[data-pay-postal]'); if (pc) a.postalCode = pc;
      return a;
    }

    async function api(path, body){
      var res = await fetch('/api' + path, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
      });
      var data = await res.json().catch(function(){ return {}; });
      if (!res.ok) throw new Error((data.error && data.error.message) || ('Request failed (' + res.status + ')'));
      return data;
    }

    async function pay(){
      if (!chosenVariant) return;
      var email = (payQ('[data-pay-email]') || {}).value || '';
      var a = addr();
      if (!email) return say('Add your email so we can send the receipt.', true);
      if (!a.name || !a.line1 || !a.city || a.country.length !== 2) return say('Add your name, address, city and 2-letter country.', true);

      var go = payQ('[data-pay-go]');
      if (go) { go.disabled = true; go.textContent = 'Working…'; }
      say('');
      try {
        // A cart of exactly this variant, so quick checkout never drags in
        // whatever else was already in the bag.
        var cart = await api('/cart/items', { variantId: chosenVariant.i, quantity: 1 });
        await api('/cart/shipping', { cartToken: cart.token, shipAddress: a });
        var order = await api('/cart/checkout', { cartToken: cart.token, email: email, shipAddress: a });

        // Wallets first — Apple/Google Pay is the fast path when the provider
        // supports it. A not-ready session comes back WITH a reason, which is
        // worth showing rather than presenting a button that cannot work.
        var w = await api('/shop/checkout/wallet-session', {
          orderNumber: order.orderNumber, accessToken: order.accessToken, provider: payProvider || 'square'
        }).catch(function(){ return { ready: false, reason: 'Wallet payments are not set up yet.' }; });

        // Settle in place. The token comes from the provider's own field or
        // wallet sheet; only the token reaches us.
        var token = null;
        try { token = await tokenize(); } catch (e) { throw e; }

        if (token && payReady) {
          var paid = await api('/shop/checkout/pay-token', {
            orderNumber: order.orderNumber, accessToken: order.accessToken,
            provider: payReady.provider, token: token
          });
          say('Paid — order ' + paid.orderNumber + ' confirmed. Receipt on its way.');
          if (go) go.textContent = 'Done';
          return;
        }

        // No card field mounted means no connected provider. The order still
        // exists, so say so with the reason rather than failing silently.
        say('Order ' + order.orderNumber + ' placed. ' + ((w && w.reason) || 'Payment is not connected yet.'));
        if (go) go.textContent = 'Done';
      } catch (e) {
        say(e.message || String(e), true);
        if (go) { go.disabled = false; go.textContent = 'Pay'; }
      }
    }

    var walletsLoaded = false;
    var payReady = null;      // the first ready provider + its client config
    var sqCard = null;        // Square Web Payments card instance, once mounted

    // Load a provider's browser SDK once. Which SDK, and the keys it needs,
    // both come from whatever is connected in Nexus — nothing here is
    // hardcoded to one processor.
    function loadSdk(src){
      return new Promise(function(resolve, reject){
        if (document.querySelector('script[data-pay-sdk=\"' + src + '\"]')) return resolve();
        var el = document.createElement('script');
        el.src = src; el.async = true;
        el.setAttribute('data-pay-sdk', src);
        el.onload = function(){ resolve(); };
        el.onerror = function(){ reject(new Error('Could not load the payment SDK.')); };
        document.head.appendChild(el);
      });
    }

    // The gateway's own hosted card field. Card numbers are entered into the
    // provider's iframe, never our inputs, so no PAN reaches this system.
    async function mountCardField(){
      var host = payQ('[data-pay-cardfield]');
      if (!host || !payReady || sqCard) return;
      var c = payReady.client || {};
      try {
        if (payReady.provider === 'square' && c.publishableKey && c.locationId) {
          await loadSdk(c.environment === 'live'
            ? 'https://web.squarecdn.com/v1/square.js'
            : 'https://sandbox.web.squarecdn.com/v1/square.js');
          var payments = window.Square.payments(c.publishableKey, c.locationId);
          sqCard = await payments.card();
          host.hidden = false;
          await sqCard.attach(host);
        } else if (payReady.provider === 'stripe' && c.publishableKey) {
          await loadSdk('https://js.stripe.com/v3/');
          var stripe = window.Stripe(c.publishableKey);
          var elements = stripe.elements();
          sqCard = elements.create('card');
          host.hidden = false;
          sqCard.mount(host);
          sqCard._stripe = stripe;
        }
      } catch (e) {
        say('Card payments could not start: ' + (e.message || e), true);
      }
    }

    /** Ask the mounted field for a token. Null means "no card path available". */
    async function tokenize(){
      if (!sqCard || !payReady) return null;
      if (payReady.provider === 'square') {
        var r = await sqCard.tokenize();
        if (r.status !== 'OK') throw new Error((r.errors && r.errors[0] && r.errors[0].message) || 'Card was not accepted.');
        return r.token;
      }
      var out = await sqCard._stripe.createPaymentMethod({ type: 'card', card: sqCard });
      if (out.error) throw new Error(out.error.message);
      return out.paymentMethod.id;
    }
    // The SAME method strip the full checkout renders, from the same endpoint.
    // Quick checkout is not a reduced payment surface: every method Nexus
    // exposes (card, wallets, pay later, bank, crypto, P2P) appears here too,
    // grouped, with unconnected ones disabled rather than hidden so the
    // shopper can see what the store supports.
    var chosenMethod = null;
    var methodsLoaded = false;
    async function loadMethods(){
      if (methodsLoaded) return;
      methodsLoaded = true;
      var box = payQ('[data-pay-methodwrap]');
      if (!box) return;
      try {
        var res = await fetch('/api/checkout/methods');
        var data = await res.json();
        var groups = data.groups || [];
        var methods = data.methods || [];
        box.hidden = false;
        box.innerHTML =
          '<div class="card-pay__tabs">' + groups.map(function(g){
            var any = methods.some(function(m){ return m.group === g.id && m.available; });
            return '<button type="button" class="card-pay__tab" data-mgroup="' + g.id + '"'
              + (any ? '' : ' disabled title="No provider connected for this yet"')
              + '>' + g.ico + ' ' + g.label + '</button>';
          }).join('') + '</div><div class="card-pay__methods" data-pay-methods></div>';

        box.addEventListener('click', function(e){
          var t = e.target.closest('[data-mgroup]');
          if (t && !t.disabled) return showGroup(t.getAttribute('data-mgroup'), methods);
          var b = e.target.closest('[data-method]');
          if (b && !b.disabled) {
            chosenMethod = { id: b.getAttribute('data-method'), provider: b.getAttribute('data-provider') };
            box.querySelectorAll('[data-method]').forEach(function(x){ x.classList.toggle('on', x === b); });
          }
        });

        var first = groups.filter(function(g){
          return methods.some(function(m){ return m.group === g.id && m.available; });
        })[0];
        if (first) showGroup(first.id, methods);
        else {
          var host = payQ('[data-pay-methods]');
          if (host) host.innerHTML = '<p class="card-pay__msg">No payment provider is connected yet.</p>';
        }
      } catch (e) {
        box.hidden = false;
        box.innerHTML = '<p class="card-pay__msg">Could not load payment methods.</p>';
      }
    }

    function showGroup(groupId, methods){
      var host = payQ('[data-pay-methods]');
      if (!host) return;
      payEl.querySelectorAll('[data-mgroup]').forEach(function(t){
        t.classList.toggle('on', t.getAttribute('data-mgroup') === groupId);
      });
      host.innerHTML = methods.filter(function(m){ return m.group === groupId; }).map(function(m){
        return '<button type="button" class="card-pay__method" data-method="' + m.id + '"'
          + ' data-provider="' + (m.provider || '') + '"' + (m.available ? '' : ' disabled') + '>'
          + '<span>' + m.label + (m.sub ? '<em>' + m.sub + '</em>' : '') + '</span>'
          + (m.available ? '' : '<span class="card-pay__na">setup required</span>') + '</button>';
      }).join('');
      // Card is the only group with an inline field; the rest tokenise in
      // their own sheet or hand off to the provider.
      var cardField = payQ('[data-pay-cardfield]');
      if (cardField) cardField.hidden = groupId !== 'card';
      if (groupId === 'card') {
        var live = methods.filter(function(m){ return m.group === 'card' && m.available; })[0];
        if (live) { chosenMethod = live; loadClientAndMount(live.provider); }
      }
    }

    // The express path, and the ONLY payment thing shown before the form.
    // Apple and Google Pay hand back the payer's contact and shipping address
    // from the sheet, so taking this route skips the details step rather than
    // pre-filling it. When nothing is connected this renders nothing at all,
    // and the flow is simply options -> details -> payment.
    var walletLabels = { apple_pay: ' Apple Pay', google_pay: 'G Pay', link: 'Link', shop_pay: 'Shop Pay' };
    async function loadWallets(){
      if (walletsLoaded) return;
      walletsLoaded = true;
      var box = payQ('[data-pay-wallets]');
      if (!box) return;
      try {
        var res = await fetch('/api/shop/wallets');
        var data = await res.json();
        var ready = (data.providers || []).filter(function(p){ return p.ready; });
        var buttons = [];
        ready.forEach(function(p){
          (p.wallets || []).forEach(function(w){
            if (!walletLabels[w]) return;
            buttons.push('<button type="button" class="card-pay__wallet" data-wallet="' + w
              + '" data-wallet-provider="' + p.provider + '">' + walletLabels[w] + '</button>');
          });
        });
        if (buttons.length === 0) return;   // stays hidden; no empty express row
        box.innerHTML = buttons.join('');
        box.hidden = false;
        var or = payQ('[data-pay-or]');
        if (or) or.hidden = false;
      } catch (e) { /* express is a shortcut; losing it costs nothing */ }
    }

    async function loadClientAndMount(provider){
      try {
        var res = await fetch('/api/shop/wallets');
        var data = await res.json();
        var p = (data.providers || []).filter(function(x){ return x.provider === provider; })[0];
        if (p) { payReady = p; await mountCardField(); }
      } catch (e) { /* the strip still works; only the inline field is lost */ }
    }

    confirm.addEventListener('click', function(){
      if (confirm.disabled || !chosenVariant) return;
      var sum = payQ('[data-pay-sum]');
      if (sum) {
        sum.textContent = [chosenVariant.c, chosenVariant.s].filter(Boolean).join(' · ')
          + (chosenVariant.c || chosenVariant.s ? ' — ' : '') + money(chosenVariant.p);
      }
      face('pay');
      payStep('details');
      // Wallets only — the express path needs to be visible before the form,
      // because taking it means never filling the form in. The method strip
      // waits for the payment step.
      loadWallets();
    });

    /** Which half of the pay face is showing. */
    function payStep(name){
      if (!payEl) return;
      payEl.querySelectorAll('[data-pay-step]').forEach(function(el){
        el.hidden = el.getAttribute('data-pay-step') !== name;
      });
      payEl.setAttribute('data-step', name);
    }

    if (payEl) {
      // Back walks the steps rather than leaving: payment → details → options.
      // Dropping straight out of payment would throw away a typed address.
      var back = payQ('[data-pay-back]');
      if (back) back.addEventListener('click', function(){
        if (payEl.getAttribute('data-step') === 'payment') return payStep('details');
        face('pick');
      });

      var next = payQ('[data-pay-next]');
      if (next) next.addEventListener('click', function(){
        var email = (payQ('[data-pay-email]') || {}).value || '';
        var a = addr();
        // Validated HERE, before the payment step, so a missing ZIP is caught
        // while the field is still on screen instead of after a method is
        // chosen.
        if (!email) return say('Add your email so we can send the receipt.', true);
        if (!a.name || !a.line1 || !a.city || a.country.length !== 2) {
          return say('Add your name, address, city and 2-letter country.', true);
        }
        say('');
        var to = payQ('[data-pay-shipto]');
        if (to) to.textContent = 'Shipping to ' + [a.name, a.line1, a.city, a.region, a.postal].filter(Boolean).join(', ');
        payStep('payment');
        // Fetched only now: a shopper who never reaches this step never pays
        // for the request.
        loadMethods();
      });

      var goBtn = payQ('[data-pay-go]');
      if (goBtn) goBtn.addEventListener('click', function(){ pay(); });
      payEl.addEventListener('click', function(e){
        var w = e.target.closest('[data-wallet]');
        if (!w) return;
        // The wallet sheet supplies contact and address itself, so the form is
        // not required on this path — that is what makes it the fast one.
        payProvider = w.getAttribute('data-wallet-provider');
        pay();
      });
    }
  });
})();
`;

/** Fallback styling, so the grid is usable even before the theme CSS loads. */
export const PRODUCT_GRID_FALLBACK_CSS = `
/* Columns live in ONE place: the data-cols attribute, styled in
   shopToolbar.ts. This file used to carry a second, competing system —
   a hardcoded repeat(4,1fr) plus media queries — which the toolbar's rules
   overrode anyway because they load later. Two systems meant the visible
   column count came from whichever happened to win, not from the setting. */
.c-product-grid__list{display:grid;gap:24px}
.c-product-grid__thumb-wrap{position:relative;overflow:hidden;aspect-ratio:1/1;background:var(--background-color-dark,#f2f2f2)}
.c-product-grid__thumb{width:100%;height:100%;object-fit:cover;display:block}
.c-product-grid__details{padding:12px 0;display:flex;flex-direction:column;gap:8px}
.c-product-grid__title{font-size:14px;font-weight:500;line-height:1.35}
.c-product-grid__short-desc{font-size:12px;color:var(--text-color-light,#888);margin-top:2px}
.c-product-grid__price-wrap{font-size:14px;font-weight:600}
.c-product-grid__title-wrap{display:flex;flex-direction:column;gap:4px}

/* ── SHAPE ──────────────────────────────────────────────────────────────
   One --card-r drives the card, its image and its shell, so a radius change
   cannot leave the photo square inside a rounded frame. */
.card-radius-sharp{--card-r:0}
.card-radius-soft{--card-r:6px}
.card-radius-round{--card-r:16px}
.card-radius-pill{--card-r:28px}
.card-radius-squircle{--card-r:24px}
.c-product-grid__item,.c-product-grid__thumb-wrap,.c-product-grid__thumb{border-radius:var(--card-r,0)}
/* A squircle is a superellipse, not an arc — corner-shape is the only thing
   that actually draws one. Everywhere else keeps the round radius above,
   which is the nearest real shape rather than a broken approximation. */
@supports (corner-shape: superellipse(4)){
  .card-radius-squircle .c-product-grid__thumb-wrap,
  .card-radius-squircle.c-product-grid__item{corner-shape:superellipse(4)}
}

.card-ratio-square .c-product-grid__thumb-wrap{aspect-ratio:1/1}
.card-ratio-portrait .c-product-grid__thumb-wrap{aspect-ratio:4/5}
.card-ratio-tall .c-product-grid__thumb-wrap{aspect-ratio:2/3}
.card-ratio-landscape .c-product-grid__thumb-wrap{aspect-ratio:4/3}
/* 'natural' means the photo decides — so the frame must NOT impose a ratio,
   and the image cannot be cropped to fill one either. */
.card-ratio-natural .c-product-grid__thumb-wrap{aspect-ratio:auto}
.card-ratio-natural .c-product-grid__thumb{height:auto}
.card-fit-contain .c-product-grid__thumb{object-fit:contain}
.card-fit-cover .c-product-grid__thumb{object-fit:cover}

.card-shadow-none.card-shell-boxed,.card-shadow-none.card-shell-elevated{box-shadow:none}
.card-shadow-soft.card-shell-elevated{box-shadow:0 2px 4px rgba(0,0,0,.04),0 12px 28px rgba(0,0,0,.07)}
.card-shadow-strong.card-shell-elevated{box-shadow:0 4px 8px rgba(0,0,0,.07),0 20px 44px rgba(0,0,0,.13)}
.card-shadow-strong.card-shell-boxed{box-shadow:0 8px 24px rgba(0,0,0,.09)}

/* Hover. The lift is on the CARD, the zoom on the image inside its frame —
   the frame itself never moves, so a grid does not ripple. */
.card-hover-lift,.card-hover-both{transition:transform .28s cubic-bezier(.2,.7,.3,1),box-shadow .28s ease}
.card-hover-lift:hover,.card-hover-both:hover{transform:translateY(-5px)}
.card-hover-zoom .c-product-grid__thumb,.card-hover-both .c-product-grid__thumb{
  transition:transform .5s cubic-bezier(.2,.7,.3,1)}
.card-hover-zoom:hover .c-product-grid__thumb,.card-hover-both:hover .c-product-grid__thumb{transform:scale(1.05)}
@media(prefers-reduced-motion:reduce){
  .card-hover-lift,.card-hover-both,.card-hover-zoom .c-product-grid__thumb{transition:none}
  .card-hover-lift:hover,.card-hover-both:hover{transform:none}
  .card-hover-zoom:hover .c-product-grid__thumb,.card-hover-both:hover .c-product-grid__thumb{transform:none}
}

.card-gap-tight{gap:10px}
.card-gap-normal{gap:24px}
.card-gap-roomy{gap:44px}

/* ── ALIGNMENT ──────────────────────────────────────────────────────────
   The text block only. The image is always full-bleed within its shell —
   aligning that would leave dead space beside the product. */
.card-align-center .c-product-grid__details{align-items:center;text-align:center}
.card-align-center .card-meta,.card-align-center .card-swatches,.card-align-center .card-sizes,
.card-align-center .card-tiles,.card-align-center .card-icons{justify-content:center}
.card-align-center .card-title-row{justify-content:center}
.card-align-end .c-product-grid__details{align-items:flex-end;text-align:right}
.card-align-end .card-meta,.card-align-end .card-swatches,.card-align-end .card-sizes,
.card-align-end .card-tiles,.card-align-end .card-icons{justify-content:flex-end}
/* Buttons stay full-width whatever the text does — a centred 40%-wide button
   in a grid of them reads as a mistake. */
.card-align-center .card-actions,.card-align-end .card-actions{align-self:stretch}

/* ── REVEAL ─────────────────────────────────────────────────────────────
   Driven by IntersectionObserver (CARD_REVEAL_RUNTIME) rather than firing on
   load: a grid that animates rows the shopper has already scrolled past is
   motion for its own sake. No-JS and reduced-motion both land on 'shown'. */
.card-reveal{opacity:0}
.card-reveal--rise{transform:translateY(14px)}
.card-reveal.is-shown{opacity:1;transform:none;
  transition:opacity .45s ease,transform .45s cubic-bezier(.2,.7,.3,1)}
.card-reveal--stagger .c-product-grid__details>*{opacity:0;transform:translateY(8px)}
.card-reveal--stagger.is-shown .c-product-grid__details>*{opacity:1;transform:none;
  transition:opacity .4s ease,transform .4s cubic-bezier(.2,.7,.3,1)}
.card-reveal--stagger.is-shown .c-product-grid__details>*:nth-child(1){transition-delay:.05s}
.card-reveal--stagger.is-shown .c-product-grid__details>*:nth-child(2){transition-delay:.11s}
.card-reveal--stagger.is-shown .c-product-grid__details>*:nth-child(3){transition-delay:.17s}
.card-reveal--stagger.is-shown .c-product-grid__details>*:nth-child(4){transition-delay:.23s}
.card-reveal--stagger.is-shown .c-product-grid__details>*:nth-child(5){transition-delay:.29s}
@media(prefers-reduced-motion:reduce){
  .card-reveal,.card-reveal--rise,.card-reveal--stagger .c-product-grid__details>*{
    opacity:1!important;transform:none!important;transition:none!important}
}

/* ── SHELL ──────────────────────────────────────────────────────────────
   'bare' is the default and adds nothing at all: image on the page, text
   under it. The other two wrap the card in a surface. */
.card-shell-boxed,.card-shell-elevated{background:var(--white-color,#fff);border-radius:var(--card-r,14px);overflow:hidden;
  display:flex;flex-direction:column}
.card-shell-boxed{border:solid 1px var(--border-color-light,rgba(0,0,0,.10))}
.card-shell-elevated{box-shadow:0 2px 4px rgba(0,0,0,.04),0 12px 28px rgba(0,0,0,.07);border:0}
.card-shell-boxed .c-product-grid__details,.card-shell-elevated .c-product-grid__details{padding:14px 16px 16px;flex:1}
/* Elevated insets its image, so the photo reads as a tile inside the card
   rather than as the card's own top edge. */
/* The radius comes from --card-r like everywhere else — hardcoding it here
   meant the Corners setting silently did nothing on an elevated card. */
.card-shell-elevated .c-product-grid__thumb-wrap{margin:12px 12px 0;border-radius:var(--card-r,10px);
  background:var(--background-color-dark,#f4f4f5)}

/* ── MEDIA ──────────────────────────────────────────────────────────────── */
.c-product-grid__thumb--hover{position:absolute;inset:0;opacity:0;transition:opacity .3s ease}
.card-media-fade:hover .c-product-grid__thumb--hover,
.card-media-motion:hover .c-product-grid__thumb--hover{opacity:1}
/* A hover VIDEO outranks the hover still: it is the richer motion, and showing
   both at once would cross-fade two different things. */
.card-media.playing .c-product-grid__thumb--hover{opacity:0}
.card-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;
  transition:opacity .25s ease;pointer-events:none}
.card-media.playing .card-video{opacity:1}
/* These used to hang off .card:hover, a class the theme-shaped card does not
   have — which is why the arrows never appeared. */
.card-nav{position:absolute;top:50%;transform:translateY(-50%);width:32px;height:32px;border-radius:50%;border:0;
  background:rgba(255,255,255,.92);color:#111;font-size:18px;line-height:1;cursor:pointer;display:flex;
  align-items:center;justify-content:center;box-shadow:0 1px 5px rgba(0,0,0,.18);opacity:0;
  transition:opacity .15s ease;z-index:3}
.card-nav.prev{left:8px}.card-nav.next{right:8px}
.c-product-grid__item:hover .card-nav{opacity:1}
@media(hover:none){.card-nav{opacity:.92}}
.card-dots{position:absolute;bottom:10px;left:50%;transform:translateX(-50%);display:flex;gap:5px;z-index:3}
.card-dots .dot{width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,.65);box-shadow:0 0 2px rgba(0,0,0,.35)}
.card-dots .dot.on{background:#fff}
.card-media.playing .card-nav,.card-media.playing .card-dots{opacity:0;pointer-events:none}

/* ── MARKS ──────────────────────────────────────────────────────────────── */
.card-marks{position:absolute;top:10px;left:10px;right:10px;z-index:3;display:flex;gap:6px;flex-wrap:wrap}
.card-badge{background:var(--white-color,#fff);color:var(--text-color,#111);font-size:9px;font-weight:700;
  letter-spacing:.08em;text-transform:uppercase;padding:5px 9px;border-radius:999px;line-height:1}
.card-badge--out{background:var(--text-color,#111);color:var(--white-color,#fff);margin-left:auto}
.card-badge--deal{background:var(--text-color,#111);color:var(--white-color,#fff)}
.is-sold-out .c-product-grid__thumb--base{opacity:.55}

/* ── CONTENT ROWS ───────────────────────────────────────────────────────── */
.card-meta{display:flex;align-items:center;gap:10px}
.card-pill{border:solid 1px var(--border-color-light,rgba(0,0,0,.15));border-radius:999px;padding:3px 10px;
  font-size:10px;font-weight:600;letter-spacing:.04em}
.card-rating{margin-left:auto;font-size:11px;font-weight:600;display:inline-flex;gap:4px;align-items:baseline}
.card-rating__n{color:var(--text-color-light,#888);font-weight:400;font-size:10px}
.card-title-row{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.card-title-row .c-product-grid__price-wrap{flex:0 0 auto}
.card-was{margin-left:8px;color:var(--text-color-light,#999);font-weight:400;font-size:12px}
.card-member{display:block;font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
  color:var(--text-color-light,#888);margin-top:3px}

.card-swatches{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.card-swatch{width:18px;height:18px;border-radius:50%;display:inline-block;
  border:solid 1px var(--border-color-light,rgba(0,0,0,.18));box-shadow:inset 0 0 0 2px var(--white-color,#fff)}
.card-swatch--named,.card-swatch--more{width:auto;height:auto;border-radius:999px;padding:3px 7px;font-size:9px;
  font-weight:600;text-transform:uppercase;box-shadow:none;color:var(--text-color-light,#888)}

.card-sizes{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.card-sizes__label{font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
  color:var(--text-color-light,#888);margin-right:2px}
.card-size{min-width:30px;text-align:center;padding:5px 7px;border:solid 1px var(--border-color-light,rgba(0,0,0,.15));
  border-radius:6px;font-size:11px;font-weight:600;text-decoration:none;color:inherit}
.card-size:hover{background:var(--text-color,#111);color:var(--white-color,#fff);border-color:var(--text-color,#111)}

.card-tiles{display:flex;gap:6px;flex-wrap:wrap}
.card-tile{display:inline-flex;flex-direction:column;gap:1px;padding:7px 11px;border-radius:9px;
  background:var(--background-color-dark,#f4f4f5);line-height:1.2}
.card-tile b{font-size:12px;font-weight:700}
.card-tile i{font-style:normal;font-size:9px;letter-spacing:.04em;text-transform:uppercase;color:var(--text-color-light,#888)}

/* ── ACTIONS ────────────────────────────────────────────────────────────── */
.card-actions{display:flex;flex-direction:column;gap:8px;margin-top:2px}
.card-actions--dual{flex-direction:column}
/* The SAME button language as the rest of the site.
   Cards shipped pill-shaped buttons while every other button on the store is
   square, uppercase and ink — so a card looked like it came from a different
   product. This matches the ported theme's .c-button spec (12px/600, .06em
   tracking, uppercase, square, 1px border) at card scale, and every preset
   uses it, so one button and two buttons read the same everywhere. */
.card-btn{display:block;text-align:center;padding:12px 14px;border-radius:0;text-decoration:none;line-height:1;
  font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;
  border:solid 1px var(--button-color,#070707);transition:background .15s linear,color .15s linear,border-color .15s linear}
.card-btn--solid{background:var(--button-color,#070707);color:var(--white-color,#fff)!important;border-color:var(--button-color,#070707)}
.card-btn--solid:hover{background:#252525;border-color:#252525}
/* The second of the two buttons: outlined, and it FILLS on hover, so the pair
   reads as one control set rather than a button beside a link. */
.card-btn--ghost{background:transparent;color:inherit}
.card-btn--ghost:hover{background:var(--button-color,#070707);color:var(--white-color,#fff)!important;border-color:var(--button-color,#070707)}
.card-btn--out{background:transparent;color:var(--text-color-light,#999);border-color:currentColor;cursor:default}
.card-icons{display:flex;gap:8px;margin-top:2px}
.card-icon{flex:1;display:inline-flex;align-items:center;justify-content:center;height:38px;border-radius:10px;
  border:0;background:var(--background-color-dark,#f4f4f5);cursor:pointer;text-decoration:none;color:inherit;font-size:15px}
.card-icon--solid{border-radius:0;background:var(--button-color,#111);color:var(--white-color,#fff)}
.card-icon--off{background:var(--background-color-dark,#f4f4f5);color:var(--text-color-light,#bbb);cursor:default}
.card-icon__heart:before{content:'\\2661';font-size:17px;line-height:1}
.card-icon[aria-pressed="true"] .card-icon__heart:before{content:'\\2665'}
/* ── 'evolve': the card becomes its own picker ──────────────────────────
   Both faces occupy the same block, so the card does not change height when
   it flips — a grid that reflows under the shopper's cursor is worse than
   any picker. */
.card-evolve{position:relative}
/* Quick checkout's pay step. Sits in the card, so it must stay compact —
   anything taller than the card turns the grid into a jumping mess. */
.card-pay{display:flex;flex-direction:column;gap:6px;position:relative;padding-top:4px}
.card-pay__sum{font-size:12px;font-weight:600}
.card-pay__row{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.card-pay__in{width:100%;box-sizing:border-box;padding:8px 10px;font:inherit;font-size:12px;
  border:1px solid var(--ln,#e5e7eb);border-radius:8px}
.card-pay__in:focus{outline:none;border-color:var(--tx,#111)}
.card-pay__wallets{display:flex;flex-direction:column;gap:6px}
.card-pay__wallet{display:block;width:100%;padding:12px;border:0;border-radius:var(--radius-pill,999px);background:#000;color:#fff;font:600 13px var(--f,inherit);cursor:pointer}
.card-pay__step{display:flex;flex-direction:column;gap:8px}
/* Where it is going, echoed on the payment step. Small and quiet — it is a
   confirmation, not a heading. */
.card-pay__shipto{font-size:11px;color:var(--tx3,#6b7280);line-height:1.4;padding-bottom:2px}
.card-pay__methodwrap{display:flex;flex-direction:column;gap:8px}
.card-pay__or{font-size:11px;color:var(--tx3,#6b7280);text-align:center;position:relative}
/* The method strip, same shape as the full checkout's — tabs across the top,
   the group's methods under it. Scrolls horizontally because a card is narrow
   and six groups will not fit; wrapping made the card jump height on change. */
.card-pay__tabs{display:flex;gap:4px;overflow-x:auto;scrollbar-width:none;padding-bottom:2px}
.card-pay__tabs::-webkit-scrollbar{display:none}
.card-pay__tab{flex:0 0 auto;padding:5px 8px;font:inherit;font-size:11px;cursor:pointer;
  border:1px solid var(--ln,#e5e7eb);border-radius:999px;background:transparent;white-space:nowrap}
.card-pay__tab.on{border-color:var(--tx,#111);background:var(--tx,#111);color:#fff}
.card-pay__tab:disabled{opacity:.4;cursor:not-allowed}
.card-pay__methods{display:flex;flex-direction:column;gap:4px;margin-top:6px}
.card-pay__method{display:flex;justify-content:space-between;align-items:center;gap:8px;
  padding:8px 10px;font:inherit;font-size:12px;text-align:left;cursor:pointer;
  border:1px solid var(--ln,#e5e7eb);border-radius:8px;background:transparent}
.card-pay__method.on{border-color:var(--tx,#111);box-shadow:inset 0 0 0 1px var(--tx,#111)}
.card-pay__method:disabled{opacity:.5;cursor:not-allowed}
.card-pay__method em{display:block;font-style:normal;font-size:10px;color:var(--tx3,#6b7280)}
.card-pay__na{font-size:10px;color:var(--tx3,#6b7280);white-space:nowrap}
.card-pay__cardfield:not(:empty){border:1px solid var(--ln,#e5e7eb);border-radius:8px;padding:8px;min-height:38px}
.card-pay__msg{font-size:11px;line-height:1.4;margin:0;color:var(--tx3,#6b7280)}
.card-pay__msg.is-bad{color:#b3261e}
.card-picker{display:flex;flex-direction:column;gap:8px}
/* An explicit display beats the hidden ATTRIBUTE's UA display:none, so the
   picker rendered at rest — its Confirm button sitting under the two CTAs on
   every card. Anything given a display value has to opt back out of hidden. */
.card-picker[hidden],[data-evolve-face][hidden]{display:none}
.card-picker__back{position:absolute;top:-30px;left:0;border:0;background:none;font-size:20px;line-height:1;
  cursor:pointer;color:var(--text-color-light,#888);padding:0}
.card-picker__rows{display:flex;flex-direction:column;gap:8px}
.card-opt-row{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.card-opt-row__label{font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
  color:var(--text-color-light,#888);width:100%}
.card-opt{min-width:32px;text-align:center;padding:6px 9px;border:solid 1px var(--border-color-light,rgba(0,0,0,.15));
  border-radius:6px;font-size:11px;font-weight:600;background:none;cursor:pointer;color:inherit}
.card-opt.on{background:var(--text-color,#111);color:var(--white-color,#fff);border-color:var(--text-color,#111)}
/* Out of stock in THIS combination — struck through and unclickable, rather
   than hidden, so the shopper can see it exists and is simply gone. */
.card-opt[disabled]{opacity:.35;cursor:default;text-decoration:line-through}
.card-opt-swatch{width:22px;height:22px;border-radius:50%;padding:0;min-width:0;
  box-shadow:inset 0 0 0 2px var(--white-color,#fff)}
.card-opt-swatch.on{box-shadow:inset 0 0 0 2px var(--white-color,#fff),0 0 0 2px var(--text-color,#111)}
.card-btn[disabled]{opacity:.45;cursor:default}

/* Overlay: floats on the image, revealed on hover rather than permanently
   covering the product. */
.c-product-grid__atc-block{position:absolute;left:12px;right:12px;bottom:12px;z-index:3;opacity:0;transition:opacity .2s ease}
.c-product-grid__item:hover .c-product-grid__atc-block{opacity:1}
@media(hover:none){.c-product-grid__atc-block{opacity:1}}
`;

import { esc, money } from './html.js';
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
  /**
   * The colourway this shot belongs to. The gallery is ordered colour by
   * colour, so stepping past the last angle of one lands on the next — and
   * the selected swatch follows, rather than contradicting the picture.
   */
  color?: string | null;
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
  /** The product's categories — a small pill per one at the card foot, revealed
   * on hover. A product can sit in several. */
  categories?: { name: string; slug: string }[];
  /**
   * DEPRECATED single-category form, kept so older callers still type-check.
   *
   * Name and href, not just a name: a category on a card that cannot be
   * clicked is a label where a shopper expects a route into the rest of that
   * category. A product in several categories shows the first — a card is not
   * the place to enumerate them.
   */
  category?: { name: string; slug: string } | null;
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
  variants?: { id: string; color: string | null; size: string | null; price: number; available: number; image?: string | null }[];
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
  editorial: { brandPill: false, rating: false, swatches: true,  sizeChips: false, infoTiles: false, priceInline: true  },
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
export function swatchPaint(color: string, codes: string[] = []): string | null {
  const safe = codes.filter((c) => /^#[0-9a-f]{3,8}$/i.test(c));
  if (safe.length === 1) return `background:${safe[0]}`;
  if (safe.length > 1) return `background:linear-gradient(135deg, ${safe[0]} 0 50%, ${safe[1]} 50% 100%)`;
  // A two-part name is a two-tone colourway even without codes.
  const parts = color.split('/').map((x) => x.trim().toLowerCase()).filter(Boolean);
  const cssName = (x: string) => /^[a-z ]+$/i.test(x) ? x.replace(/\s+/g, '') : null;
  if (parts.length > 1) {
    const a = cssName(parts[0]!), b = cssName(parts[1]!);
    if (a && b) return `background:linear-gradient(135deg, ${a} 0 50%, ${b} 50% 100%)`;
  }
  const one = cssName(color.trim());
  return one ? `background:${one}` : null;
}

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

  const base = stills[0]?.url ?? video?.poster ?? null;
  // The hover image is the SECOND shot. A print-on-demand product keeps its
  // alternate shots on the colourways, not as a second product still, so when
  // there is no second product image, borrow a variant's — otherwise a store
  // full of POD products has no hover reveal anywhere.
  const variantHover = (p.variants ?? [])
    .map((v) => v.image)
    .find((u): u is string => !!u && u !== base) ?? null;
  const hover = stills[1]?.url ?? variantHover;

  let media = resolveMedia(cfg, p.mediaOverride ?? null, stills.length, Boolean(video));
  // 'auto' means "be as rich as the media allows". A single product still with
  // a variant shot behind it should reveal on hover, not sit inert as a
  // 'still' — an explicit 'still' choice is still respected.
  if (media === 'still' && hover && (p.mediaOverride ?? cfg.media) === 'auto') media = 'fade';

  // NOT hardcoding the theme's --contain class: it forces object-fit:contain
  // !important, which made the Cover/Contain setting inert. The card-fit-* class
  // (emitted from cfg.fit) owns fit now.
  const img = (url: string, cls: string, alt = '') =>
    `<img class="c-product-grid__thumb ${cls}" src="${esc(url)}" alt="${esc(alt)}" loading="lazy" decoding="async"${alt ? '' : ' aria-hidden="true"'}>`;

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

  // ARROWS ONLY — no dots, asked for directly. The dot strip sat over the
  // bottom of the photograph, which on a grid of tall product shots is exactly
  // where the product is.
  const galleryNav = media === 'gallery'
    ? `<button class="card-nav prev" data-dir="-1" aria-label="Previous image" type="button">‹</button>
       <button class="card-nav next" data-dir="1" aria-label="Next image" type="button">›</button>`
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
  // BUY NOW is the primary, and it always completes ON THE CARD — either a
  // one-tap add for a single-variant product, or the in-card picker for one
  // with choices.
  //
  // The one case that still says "Select options" is a product with choices on
  // a card that CANNOT open the picker (evolve off). There the button is a
  // link to the PDP, and calling a link to another page "Buy now" promises a
  // purchase the click does not make.
  const canBuyOnCard = canQuickBuy || (cfg.evolve && cfg.action !== 'none' && (p.variants?.length ?? 0) > 0);
  const primaryLabel = soldOut ? 'Sold out' : canBuyOnCard ? 'Buy now' : 'Select options';
  const primary = soldOut
    ? `<span class="card-btn card-btn--out">Sold out</span>`
    : canQuickBuy
      ? `<button ${buyAttrs} class="card-btn card-btn--solid">Buy now</button>`
      : `<a href="${href}" class="card-btn card-btn--solid">${primaryLabel}</a>`;
  // Evolve only means anything when there is a choice to make AND the card
  // actually offers an add-to-cart. A single-variant product adds in one tap
  // either way; asking someone to "choose" from one option is a step that
  // exists only to be dismissed.
  // Quick checkout is offered whenever there is anything to buy — INCLUDING
  // single-variant products, which used to be excluded by `!canQuickBuy` and
  // so fell through to `data-quick-buy`, opening the cart drawer and leaving
  // the page. A product with one variant simply has nothing to choose, so the
  // runtime skips the options step rather than the whole flow.
  const needsChoice = cfg.evolve && cfg.action !== 'none' && !soldOut && (p.variants?.length ?? 0) > 0;

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
           data-variants='${esc(JSON.stringify(p.variants!.map((v) => ({ i: v.id, c: v.color, s: v.size, p: v.price, a: v.available, img: v.image ?? null, cc: (v.color && p.colorCodes?.[v.color]) || [] }))))}'>
        <button class="card-picker__back" type="button" data-evolve-close aria-label="Back">‹</button>
        <div class="card-picker__rows"></div>
        <button class="card-btn card-btn--solid" type="button" data-evolve-confirm disabled>Choose an option</button>
      </div>
      <div class="card-pay" data-evolve-face="pay" hidden>
        <button class="card-picker__back" type="button" data-pay-back aria-label="Back">‹</button>
        <!-- CLOSE. There was no way out of the checkout except walking the
             back chevron through every step, and from the receipt that took
             three taps to reach a card you could have left with one.
             It does NOT clear what was typed: reopening picks up where you
             left off, so a mis-tap costs nothing. Only completing an order,
             or Edit selection, starts the receipt over. -->
        <button class="card-pay__close" type="button" data-pay-close aria-label="Close checkout">×</button>
        <!-- THE ORDER LINE. What is being bought, how many, and the way back
             to change it. Once the flow starts the colour swatches are no
             longer the control — this line is — so it carries both the
             quantity and an explicit way to go back and re-choose, rather
             than leaving the shopper to guess that the back chevron unwinds
             that far. -->
        <!-- The order line + its second qty stepper are GONE: the card's own
             picker (colour / size / qty) stays at the top of the open card and
             IS the selection control, so a summary line and a duplicate stepper
             just repeated it. Edit selection stays as the explicit way back. -->
        <button class="card-pay__edit" type="button" data-pay-edit>Edit selection</button>
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
        <!-- TWO OR THREE FIELDS PER STEP, not one long form.
             A card is a narrow column; seven inputs stacked in it on a phone
             is a wall, and the keyboard covers half of them. Split into short
             steps the shopper can answer without scrolling, in the order they
             think in: who you are, where it goes, how you pay. -->
        <!-- ── WAYS IN ────────────────────────────────────────────────────
             TWO KINDS OF THING, DELIBERATELY NOT PEERS.
             A wallet is one tap into somebody else's sheet, which collects
             contact, address and payment and hands it all back. Entering
             details is a process. Showing them as identical stacked buttons
             said they were equivalent, and they are not — so the sheets are a
             row of small icons, and the process is one big button.
             When no wallet renders (most desktop browsers), the big button is
             the only way in and drops its "or", rather than sitting there
             looking secondary under a row of icons that do not apply. -->
        <div class="card-pay__step" data-pay-step="who">
          <div class="card-pay__icons" data-pay-wallets hidden></div>
          <!-- Cross-device: a wallet that is not native on THIS browser reveals
               this QR instead of vanishing. Scan it, land on the product on the
               phone, and pay there with Apple Pay / Google Pay. -->
          <div class="card-pay__qr" data-pay-qr hidden>
            <div class="card-pay__qr-code" data-pay-qr-img></div>
            <p class="card-pay__qr-cap">Scan with your phone to pay with Apple&nbsp;Pay or Google&nbsp;Pay.</p>
            <button class="card-pay__qr-back" type="button" data-pay-qr-back>Back to options</button>
          </div>
          <button class="card-pay__back-to-ways" type="button" data-pay-ways hidden>or pay a different way</button>

          <!-- Sign in is a peer of the payment options, not a form field, so
               it is centred under the row and separated from what follows. -->
          <button class="card-pay__signin" type="button" data-pay-signin>Have an account? Sign in</button>
          <div class="card-pay__signin-box" data-pay-signin-box hidden>
            <input class="card-pay__in" data-pay-password type="password" placeholder="Password" autocomplete="current-password">
            <button class="card-btn card-btn--ghost" type="button" data-pay-signin-go>Sign in</button>
            <!-- Creating an account lives HERE rather than in the buying path.
                 Offered beside the wallets it would ask someone to sign up
                 before they had bought anything, at the exact moment the flow
                 exists to remove friction. Inside the sign-in panel, the
                 person reading it is already thinking about accounts. -->
            <a class="card-pay__mklink" href="/account">Don't have an account? Create one</a>
          </div>

          <!-- THE RECEIPT STARTS HERE. Everything below the perforation is the
               order being assembled line by line, which is why the divider is
               a dotted rule and not a plain one: it marks where somebody
               else's checkout ends and ours begins. -->
          <button class="card-pay__details-btn" type="button" data-pay-open-details>
            <span class="card-pay__details-label">or enter your details</span>
          </button>

          <div class="card-pay__receipt" data-pay-receipt hidden>
            <div class="card-pay__perf" aria-hidden="true"></div>

            <!-- ── ACCORDION, NOT A STEPPER ──────────────────────────────
                 A stepper only goes forwards; an accordion lets someone
                 reopen what they already answered without walking back
                 through everything after it. Each finished section collapses
                 to a summary line, so the card stays short AND you can still
                 read what you entered — which is what makes the receipt
                 metaphor work rather than just decorate. -->
            <section class="card-pay__sec" data-pay-sec="who">
              <button class="card-pay__sec-head" type="button" data-pay-sec-toggle="who" aria-expanded="true">
                <span class="card-pay__sec-title">Ship to</span>
                <span class="card-pay__sec-sum" data-pay-sec-sum="who"></span>
                <span class="card-pay__sec-chev" aria-hidden="true"></span>
              </button>
              <div class="card-pay__sec-body" data-pay-sec-body="who">
                <input class="card-pay__in" data-pay-email type="email" placeholder="Email for your receipt" autocomplete="email">
                <input class="card-pay__in" data-pay-name placeholder="Full name" autocomplete="shipping name">
                <div class="card-pay__autocomplete" data-pay-address hidden></div>
                <input class="card-pay__in" data-pay-line1 placeholder="Street address" autocomplete="shipping address-line1">
                <div class="card-pay__row">
                  <input class="card-pay__in" data-pay-city placeholder="City" autocomplete="shipping address-level2">
                  <input class="card-pay__in" data-pay-region placeholder="State" autocomplete="shipping address-level1">
                </div>
                <div class="card-pay__row">
                  <!-- inputmode gets the numeric keypad on a phone without
                       making it type="number", which strips leading zeros —
                       and a leading zero is most of New England's post codes. -->
                  <input class="card-pay__in" data-pay-postal placeholder="ZIP"
                         inputmode="numeric" autocomplete="shipping postal-code">
                  <!-- Prefilled rather than asked. Nearly every order is US,
                       and it is still editable for the ones that are not. -->
                  <input class="card-pay__in" data-pay-country placeholder="US" maxlength="2" value="US"
                         autocapitalize="characters" autocomplete="shipping country">
                </div>
                <button class="card-btn card-btn--solid" type="button" data-pay-next>Continue</button>
              </div>
            </section>

            <div class="card-pay__perf" aria-hidden="true"></div>

            <section class="card-pay__sec" data-pay-sec="payment">
              <button class="card-pay__sec-head" type="button" data-pay-sec-toggle="payment" aria-expanded="false">
                <span class="card-pay__sec-title">Payment</span>
                <span class="card-pay__sec-sum" data-pay-sec-sum="payment"></span>
                <span class="card-pay__sec-chev" aria-hidden="true"></span>
              </button>
              <div class="card-pay__sec-body" data-pay-sec-body="payment" hidden>
                <div class="card-pay__shipto" data-pay-shipto></div>
                <!-- Cards this shopper already saved, above the method strip:
                     for a returning customer this is the whole payment step,
                     and making them scroll past a tab bar to reach it would
                     undo the point of saving one. -->
                <div class="card-pay__saved" data-pay-saved hidden></div>
                <div class="card-pay__methodwrap" data-pay-methodwrap></div>
                <div class="card-pay__cardfield" data-pay-cardfield hidden></div>
                <!-- Consent, and only shown once signed in — offering to save
                     a card against no account would be a promise we could not
                     keep. Unticked by default: keeping someone's card is
                     something they opt into. -->
                <label class="card-pay__savecard" data-pay-savecard hidden>
                  <input type="checkbox" data-pay-savecard-input>
                  <span>Save this card for next time</span>
                </label>
                <button class="card-btn card-btn--solid" type="button" data-pay-go>Pay</button>
              </div>
            </section>
          </div>
        </div>

        <!-- The end of the journey, ON the card. Previously a paid order only
             produced a line of text under the Pay button, which is a strange
             place for the most important moment in the flow. -->
        <!-- Submitting covers the real gap between tapping Pay and the gateway
             answering. Without it the only feedback was the button reading
             "Working…", which invites a second tap on a live payment. -->
        <div class="card-pay__step card-pay__sending" data-pay-step="sending" hidden aria-live="polite">
          <div class="card-pay__spinner" aria-hidden="true"></div>
          <div class="card-pay__sending-title">Submitting your order…</div>
        </div>

        <div class="card-pay__step card-pay__done" data-pay-step="done" hidden aria-live="polite">
          <div class="card-pay__tick" aria-hidden="true">✓</div>
          <div class="card-pay__done-title">Thanks for your purchase</div>
          <!-- The order review, so the last thing seen is WHAT was bought, not
               just that something was: thumb, what it is, quantity, total. -->
          <div class="card-pay__done-summary" data-pay-done-summary hidden></div>
          <div class="card-pay__done-sub">Saved to your account and sent to your email — screenshot this or open it below.</div>
          <!-- The order number stays in its own line rather than the headline:
               three seconds is enough to read "thanks" and not enough to take
               in a ten-character reference. -->
          <div class="card-pay__done-ref" data-pay-done-sub></div>
          <a class="card-btn card-btn--primary card-pay__done-link" data-pay-done-link target="_blank" rel="noopener" hidden>View your order →</a>
          <button class="card-btn card-btn--ghost" type="button" data-pay-reset>Keep shopping</button>
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

  // The swatches are the COLOUR CONTROL, not decoration: clicking one selects
  // that colourway, swaps the card image, and moves the price. `data-swatch`
  // marks the row so the evolve runtime binds it; each swatch carries its
  // colour so a click resolves to a variant. A single colour is not a choice,
  // so the row is shown but inert.
  const interactiveSwatch = (c: string, codes: string[]): string =>
    swatch(c, codes).replace('<span class="card-swatch', `<button type="button" class="card-swatch card-swatch--btn" data-swatch-color="${esc(c)}"`).replace(/<\/span>$/, '</button>');
  const swatches = rows.swatches && p.colors?.length
    ? `<div class="card-swatches"${(p.colors.length > 1 && (p.variants?.length ?? 0) > 1) ? ' data-swatch' : ''}>${p.colors.slice(0, 6).map((c) => interactiveSwatch(c, p.colorCodes?.[c] ?? [])).join('')}${p.colors.length > 6 ? `<span class="card-swatch card-swatch--more">+${p.colors.length - 6}</span>` : ''}</div>`
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

  // Category pills — a small NEUTRAL pill per category with a colour dot, in a
  // row at the FOOT of the card (below the actions), hidden until the card is
  // hovered so the card stays clean. A product can sit in several; they wrap.
  // The dot's hue comes from the slug so a category is the same colour anywhere.
  const catList = p.categories?.length ? p.categories : p.category ? [p.category] : [];
  const catPills = catList.length
    ? `<div class="card-cat-pills" aria-label="Categories">${catList
        .slice(0, 4)
        .map((c) => `<a class="th-pill th-pill--outline th-pill--sm card-cat-pill" href="/c/${esc(c.slug)}" title="${esc(c.name)}">${esc(c.name)}</a>`)
        .join('')}</div>`
    : '';

  // The HOVER PICKER — colour / size / qty, revealed on hover so the resting
  // card is just title · price · buttons. Colour reuses the swatch row (its
  // handler already drives the selection); size is a SELECTABLE row (not PDP
  // links) so Buy Now can carry it straight to pay; qty is a stepper. Only the
  // rows the product actually needs are rendered.
  const hasColourChoice = (p.colors?.length ?? 0) > 1 && (p.variants?.length ?? 0) > 1;
  const hasSizeChoice = (p.sizes?.length ?? 0) > 1;
  const cardPicker = (hasColourChoice || hasSizeChoice) && !soldOut
    ? `<div class="card-picker-reveal">`
      // Qty first, full-width. Then Color (full-width, scrolls sideways when the
      // colourway count overflows). Then Size.
      + `<div class="card-pk-line card-pk-line--qty"><span class="card-pk-label">Qty</span><div class="card-pk-qty"><button type="button" class="card-pk-qbtn" data-card-qty="-1" aria-label="One fewer">−</button><span class="card-pk-qn" data-card-qty-n aria-live="polite">1</span><button type="button" class="card-pk-qbtn" data-card-qty="1" aria-label="One more">+</button></div></div>`
      + (hasColourChoice ? `<div class="card-pk-line card-pk-line--color"><span class="card-pk-label">Color</span><div class="card-pk-scroll">${swatches}</div></div>` : '')
      + (hasSizeChoice ? `<div class="card-pk-line card-pk-line--size"><span class="card-pk-label">Size</span><div class="card-pk-opts card-pk-scroll" data-card-sizes>${p.sizes!.slice(0, 14).map((s) => `<button type="button" class="card-pk-opt" data-card-size="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>` : '')
      + `<div class="card-pk-stock" data-card-stock hidden></div>`
      + `</div>`
    : '';

  return `
<div class="c-product-grid__item c-product-grid__item--${perRow}-per-row c-product-grid__item--1-per-row-mobile product counter-product card-shell-${cfg.shell} card-preset-${p.presetOverride ?? cfg.preset} card-media-${media} card-align-${cfg.align} card-radius-${cfg.radius} card-ratio-${cfg.ratio} card-fit-${cfg.fit} card-shadow-${cfg.shadow}${cfg.hover === 'none' ? '' : ` card-hover-${cfg.hover}`}${cfg.reveal === 'none' ? '' : ` card-reveal card-reveal--${cfg.reveal}`}${soldOut ? ' is-sold-out' : ''}">
  <div class="c-product-grid__thumb-wrap c-product-grid__thumb-wrap--buttons card-media" data-stills='${esc(JSON.stringify(stills.map((s) => s.url)))}' data-still-colors='${esc(JSON.stringify(stills.map((s) => s.color ?? null)))}'>
    <a href="${href}" class="woocommerce-LoopProduct-link woocommerce-loop-product__link">${thumb}</a>
    ${markStrip}
    ${cfg.wishlist && cfg.action !== 'icons' ? wishlistButton(p.id, { url: href, title: esc(p.name) }) : ''}
    ${galleryNav}
    ${overlayAction}
  </div>
  <div class="c-product-grid__details">
    ${metaRow}
    <div class="c-product-grid__title-wrap">${titleBlock}</div>
    ${cardPicker}
    ${infoTiles}
    ${actionBlock}
    ${catPills}
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
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]; }); }
  function uniq(a){ return a.filter(function(v, i){ return v != null && a.indexOf(v) === i; }); }

  document.querySelectorAll('[data-evolve]').forEach(function(root){
    var rest = root.querySelector('[data-evolve-face="rest"]');
    var pick = root.querySelector('[data-evolve-face="pick"]');
    // The faces' container. Its height is what the grid row measures, so it is
    // pinned while a checkout is open rather than left to follow the content.
    var evolveEl = root.querySelector('.card-evolve') || root;
    // The resting height, measured the first time the card is opened — the
    // only moment the buttons are guaranteed to still be on screen.
    var restHeight = 0;
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

    // The card's main photo, so choosing a colour changes the picture.
    var item = root.closest('.c-product-grid__item');
    var mainImg = item && (item.querySelector('.c-product-grid__thumb--base') || item.querySelector('.c-product-grid__thumb'));
    var imgWas = mainImg ? mainImg.getAttribute('src') : null;
    var mediaWrap = item && item.querySelector('.card-media');
    // AN EXPLICIT COLOUR BEATS THE HOVER PREVIEW.
    //
    // The hover still is a SECOND <img> stacked over the base one and faded in
    // on :hover. swapImage only changes the base, so picking a colour while
    // the pointer was still on the card changed the picture underneath a
    // layer that was covering it — the new colour appeared only once you moved
    // the mouse away, which reads as the swatch not working.
    //
    // Choosing a colour is a decision; a hover is a glance. Once a swatch is
    // picked the card stops offering the preview and shows what was chosen.
    // Clearing the colour hands hover back.
    function lockColour(on){
      if (mediaWrap) mediaWrap.classList.toggle('card-media--picked', !!on);
    }
    function swapImage(v){
      if (!mainImg) return;
      mainImg.setAttribute('src', (v && v.img) ? v.img : imgWas);
      // Keep the hover layer in step for the colours that ship their own
      // second shot, so hover still does something useful after a pick.
      lockColour(chosen.c !== null);
    }

    // The swatch row IS the colour control. Clicking a swatch selects the
    // colourway, swaps the image, moves the price, and marks the swatch —
    // then the picker only ever has size (if any) left to ask.
    var swRow = item && item.querySelector('[data-swatch]');
    function markSwatch(){
      if (!swRow) return;
      swRow.querySelectorAll('[data-swatch-color]').forEach(function(b){
        b.classList.toggle('on', b.getAttribute('data-swatch-color') === chosen.c);
      });
    }
    if (swRow) swRow.addEventListener('click', function(e){
      var b = e.target.closest('[data-swatch-color]');
      if (!b) return;
      e.preventDefault(); e.stopPropagation();
      var c = b.getAttribute('data-swatch-color');
      chosen.c = (chosen.c === c) ? (colors.length === 1 ? colors[0] : null) : c;
      markSwatch();
      var v = match();
      swapImage(v);
      if (priceEl && v) priceEl.textContent = money(v.p);
      // Keep the picker's Buy-now state in step if it is open.
      if (!pick.hidden) draw();
      // In PAY mode the swatch is STILL the control. The old code froze it there,
      // so clicking a colour moved the picture but NOT the order line or the
      // variant actually bought — the "Black/Natural" line never changed and you
      // paid for the first colour. Keep the pay flow live: re-point the variant
      // and redraw the order line.
      var payFace = root.querySelector('[data-evolve-face="pay"]');
      if (payFace && !payFace.hidden && v && v.a > 0) {
        chosenVariant = v;
        drawLine();
      }
      markCardSizes();
    });

    // ── CARD HOVER PICKER: size + qty (the redesign) ────────────────────────
    // The size row selects IN PLACE (not a PDP link), so a complete card-face
    // choice lets Buy Now skip the options step and go straight to pay. Sizes
    // unreachable for the chosen colour are disabled — same rule the pick face
    // uses. markCardSizes is a hoisted declaration so the swatch handler above
    // can call it when the colour changes.
    var cardSizeRow = item && item.querySelector('[data-card-sizes]');
    // "Only N left" under the picker, from the chosen variant's real count.
    // v.a is availableOf: a true count for tracked lines, a huge sentinel for
    // unlimited/POD, so only a genuinely low number trips it. Shown only once
    // the full variant is chosen.
    var cardStockEl = item && item.querySelector('[data-card-stock]');
    function showCardStock(){
      if (!cardStockEl) return;
      var ready = (colors.length < 2 || chosen.c !== null) && (sizes.length < 2 || chosen.s !== null);
      var mv = ready ? match() : null;
      var n = mv ? mv.a : null;
      if (n != null && n > 0 && n <= 5) { cardStockEl.textContent = 'Only ' + n + ' left'; cardStockEl.hidden = false; }
      else if (n != null && n <= 0) { cardStockEl.textContent = 'Sold out'; cardStockEl.hidden = false; }
      else { cardStockEl.hidden = true; cardStockEl.textContent = ''; }
    }
    function markCardSizes(){
      if (!cardSizeRow) return;
      cardSizeRow.querySelectorAll('[data-card-size]').forEach(function(b){
        var val = b.getAttribute('data-card-size');
        b.classList.toggle('on', chosen.s === val);
        b.disabled = !reachable('s', val);
      });
      showCardStock();
    }
    if (cardSizeRow) cardSizeRow.addEventListener('click', function(e){
      var b = e.target.closest('[data-card-size]');
      if (!b || b.disabled) return;
      e.preventDefault(); e.stopPropagation();
      var val = b.getAttribute('data-card-size');
      chosen.s = (chosen.s === val) ? (sizes.length === 1 ? sizes[0] : null) : val;
      markCardSizes();
      var mv = match();
      if (priceEl && mv) priceEl.textContent = money(mv.p);
      if (!pick.hidden) draw();
      var pf = root.querySelector('[data-evolve-face="pay"]');
      if (pf && !pf.hidden && mv && mv.a > 0) { chosenVariant = mv; drawLine(); }
    });
    markCardSizes();

    // Card qty stepper — feeds the SAME qty the pay flow reads, so a bump to 2
    // on the card survives into checkout rather than resetting.
    var cardQtyBox = item && item.querySelector('.card-pk-qty');
    var cardQtyN = item && item.querySelector('[data-card-qty-n]');
    if (cardQtyBox) cardQtyBox.addEventListener('click', function(e){
      var b = e.target.closest('[data-card-qty]'); if (!b) return;
      e.preventDefault(); e.stopPropagation();
      var d = parseInt(b.getAttribute('data-card-qty'), 10) || 0;
      qty = Math.max(1, Math.min(10, qty + d));
      if (cardQtyN) cardQtyN.textContent = String(qty);
    });

    // THE CAROUSEL MOVES THE SWATCH.
    //
    // The gallery is ordered colour by colour, so arrowing past the last angle
    // of one colourway lands on the next. The card would then show a black hat
    // with red still selected — and Buy now would add red.
    //
    // Deliberately does NOT call swapImage: the gallery has already set the
    // picture, and setting it again from the variant would snap back to that
    // colour's FRONT shot, undoing the angle the shopper just stepped to.
    //
    // Colour names are compared loosely because the two sides spell them
    // differently — the gallery records 'dark-green-natural' from the
    // filename, the variant carries 'Dark Green/Natural'.
    var slug = function(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); };
    if (item) item.addEventListener('therum:gallery-color', function(e){
      var want = e.detail && e.detail.color;
      if (!want) return;
      var found = colors.filter(function(c){ return slug(c) === slug(want); })[0];
      if (!found || chosen.c === found) return;
      chosen.c = found;
      markSwatch();
      var v = match();
      if (priceEl && v) priceEl.textContent = money(v.p);
      if (!pick.hidden) draw();
    });

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
      // Size AND colour are chosen ENTIRELY on the card picker now (card-pk,
      // under the title). Rendering a Size row here too was the duplicate "SIZE"
      // row that showed on every Buy Now. The pick face keeps only its confirm
      // button, driven by the same chosen-state the card picker writes.
      rowsEl.innerHTML = '';
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
      swapImage(v);
      markSwatch();
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
      // Hiding the resting buttons leaves an 84px hole where they were, and
      // NOT hiding them leaves the same hole with dead buttons in it. So:
      // hide them, and pin the container to the height it had while they were
      // there. The card keeps its exact layout height — the grid cannot move —
      // and nothing empty is on screen, because the pay panel is out of flow
      // and covers that space from the top of the card down.
      // restHeight is captured on OPEN, while the buttons are still on screen.
      // Measuring here instead gave 45px — the picker's height — because the
      // flow is rest -> pick -> pay, so by the time this runs the resting
      // buttons are long hidden and the card had already shrunk.
      if (which === 'pay' && restHeight) evolveEl.style.minHeight = restHeight + 'px';
      if (which !== 'pay') evolveEl.style.minHeight = '';
      rest.hidden = which !== 'rest';
      pick.hidden = which !== 'pick';
      var payFace = root.querySelector('[data-evolve-face=\"pay\"]');
      if (payFace) payFace.hidden = which !== 'pay';
      if (which === 'rest' && priceEl) priceEl.textContent = priceWas;
      // FREEZE THE GRID while a checkout is live. Re-sorting or filtering
      // rebuilds the list, and a half-finished checkout that vanishes mid-way
      // is worse than any page navigation. Nobody re-sorts on purpose at that
      // moment — this is for the accidental paths: a stray filter tap, a
      // wishlist toggle repainting the grid, the browser's back button.
      var grid = root.closest('.c-product-grid__list') || root.closest('[data-cols]');
      if (grid) grid.classList.toggle('is-checkout-open', which === 'pay');
      // The card in checkout marks ITSELF, so the grid can push everything
      // else back without needing to know which one is live.
      // root is the .card-evolve wrapper, NOT the tile — the class has to go
      // on the item the grid lays out, or the blur rule matches nothing.
      var item = root.closest('.c-product-grid__item') || root;
      item.classList.toggle('is-checking-out', which === 'pay');
      if (which === 'pay') {
        // MEASURED AGAINST THE PANEL'S OWN OFFSET PARENT.
        // top: is resolved against whatever positions the panel, which is
        // .c-product-grid__details — not the card. Measuring from the card
        // and applying it there added the image's height twice: 418px became
        // 708px, and the panel opened a full card-height below where the
        // buttons were.
        var payEl2 = root.querySelector('[data-evolve-face="pay"]');
        var anchor = (payEl2 && payEl2.offsetParent) || item;
        var ar = anchor.getBoundingClientRect();
        var rr = root.getBoundingClientRect();
        item.style.setProperty('--pay-top', Math.round(rr.top - ar.top) + 'px');
      } else {
        item.style.removeProperty('--pay-top');
      }
      document.body.classList.toggle('th-card-checkout', which === 'pay');
    }
    root.querySelector('[data-evolve-open]').addEventListener('click', function(){
      if (!restHeight) restHeight = Math.round(evolveEl.getBoundingClientRect().height);
      // ONE CARD AT A TIME. A second checkout opened while the first is part
      // way through leaves two live carts on screen and, once payment starts,
      // two payment intents for one shopper. Opening this one closes the rest.
      document.dispatchEvent(new CustomEvent('therum:card-open', { detail: { root: root } }));
      draw();
      // draw() resolves chosenVariant from the current choice. If the shopper
      // already completed it on the card's HOVER PICKER (colour + size), or the
      // product has a single variant, there is nothing left to ask — go straight
      // to pay. Only an INCOMPLETE choice falls to the options step.
      if (chosenVariant) return openPay();
      face('pick');
    });
    // Every other card stands down when one opens.
    document.addEventListener('therum:card-open', function(e){
      if (e.detail && e.detail.root === root) return;
      if (rest.hidden) face('rest');
    });
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

    // ══════════════════════════════════════════════════════════════════════
    // LIVE. Pressing Pay charges a real card and writes a real order.
    // Set back to false to walk the flow without money moving.
    // ══════════════════════════════════════════════════════════════════════
    var SUBMIT_ENABLED = true;

    async function pay(){
      if (!chosenVariant) return;
      if (!SUBMIT_ENABLED) {
        say('Test mode — everything up to here works. Submission is switched off, so nothing was charged and no order was created.');
        return;
      }
      var email = (payQ('[data-pay-email]') || {}).value || '';
      var a = addr();
      if (!email) return say('Add your email so we can send the receipt.', true);
      if (!a.name || !a.line1 || !a.city || a.country.length !== 2) return say('Add your name, address, city and 2-letter country.', true);

      var go = payQ('[data-pay-go]');
      if (go) { go.disabled = true; go.textContent = 'Working…'; }
      say('');
      try {
        // ── THE SHEET OPENS FIRST, THE ORDER IS WRITTEN SECOND ────────────
        //
        // This used to run /cart/checkout — which CREATES the order — before
        // the wallet sheet had even appeared. Every shopper who opened Apple
        // Pay to check the total and swiped it away left an unpaid order
        // behind, indistinguishable from a genuine payment failure.
        //
        // Taking the token first means a cancelled sheet costs nothing: no
        // order, no cart, nothing to clean up.
        // NO PAYMENT METHOD, NO ORDER.
        // tokenize() returns null when nothing is mounted — no throw, so the
        // old code sailed past it, wrote a real order and then reported
        // "payment is not connected yet". That is an unpaid order in the
        // store for a button the shopper was allowed to press. Stop here
        // instead, before anything is written.
        if (!sqCard || !payReady) {
          openSec('payment');
          say('Choose a payment method first.', true);
          if (go) { go.disabled = false; go.textContent = 'Pay'; }
          return;
        }
        var token = null;
        try {
          token = await tokenize();
        } catch (e) {
          // THREE OUTCOMES, NOT TWO. Cancelling is not failing — it is the
          // most common way a wallet sheet ends, because people open it just
          // to see the price. Telling them something went wrong when they
          // chose to back out is both wrong and alarming.
          if (cancelled(e)) {
            // Straight back to the row of ways in, with every button restored
            // and nothing said. Dismissing a sheet is not an event worth
            // reporting to the person who did it deliberately.
            var wbox = payQ('[data-pay-wallets]');
            if (wbox) wbox.querySelectorAll('[data-wallet]').forEach(function(b){ b.hidden = false; });
            focusWay(null);
            payStep(payProvider ? 'who' : 'payment');
            if (go) { go.disabled = false; go.textContent = 'Pay'; }
            say('');
            return;
          }
          throw e;
        }

        // Now that a real token exists, commit. A cart of exactly this
        // variant, so quick checkout never drags in whatever else was already
        // in the bag.
        payStep('sending');
        var cart = await api('/cart/items', { variantId: chosenVariant.i, quantity: qty });
        await api('/cart/shipping', { cartToken: cart.token, shipAddress: a });
        var order = await api('/cart/checkout', { cartToken: cart.token, email: email, shipAddress: a });

        // A not-ready wallet session comes back WITH a reason, which is worth
        // showing rather than presenting a button that cannot work.
        var w = await api('/shop/checkout/wallet-session', {
          orderNumber: order.orderNumber, accessToken: order.accessToken, provider: payProvider || 'square'
        }).catch(function(){ return { ready: false, reason: 'Wallet payments are not set up yet.' }; });

        if (token && payReady) {
          var saveEl = payQ('[data-pay-savecard-input]');
          var paid = await api('/shop/checkout/pay-token', {
            orderNumber: order.orderNumber, accessToken: order.accessToken,
            provider: payReady.provider, token: token,
            saveCard: !!(saveEl && saveEl.checked),
            // A chosen saved card replaces the typed one entirely; the server
            // re-checks it belongs to this account before charging it.
            savedMethodId: savedCardId || undefined
          });
          // Land on the success face rather than a line of text under a
          // spent button. The order number is what a shopper screenshots.
          // One renderer for the success face, shared with the wallet path so
          // the two confirmations can never drift.
          fillDone(paid.orderNumber, paid.accessToken || order.accessToken, email);
          say('');
          payStep('done');
          if (go) { go.disabled = false; go.textContent = 'Pay'; }
          // Back to the grid on its own. The order number stays in the
          // message line rather than vanishing with the card, because three
          // seconds is not long enough to memorise one.
          // Longer than before: the review carries an order number and a link,
          // and three seconds is not enough to read it, screenshot it, or tap
          // through. "Keep shopping" resets immediately for anyone who is done.
          if (resetTimer) clearTimeout(resetTimer);
          resetTimer = setTimeout(function(){
            // resetCard first: it walks back to the first step, and payStep()
            // clears the message line on every change. Setting the text
            // before that call would wipe it immediately.
            resetCard(true);
            say('Order ' + paid.orderNumber + ' confirmed — check your email for the details.');
          }, 12000);
          return;
        }

        // Unreachable in normal use — the guard above returns before an order
        // is written when nothing is mounted. Kept as a belt-and-braces net so
        // a future provider that tokenizes to null cannot silently produce an
        // unpaid order.
        openSec('payment');
        say('Order ' + order.orderNumber + ' was created but not paid. ' + ((w && w.reason) || 'Payment is not connected yet.'), true);
        if (go) { go.disabled = false; go.textContent = 'Pay'; }
      } catch (e) {
        // Outcome three: it genuinely failed. Say so plainly and put the
        // payment step back so another method is one tap away — never leave
        // the shopper on the submitting screen with no way out.
        openSec('payment');
        say(e.message || String(e), true);
        if (go) { go.disabled = false; go.textContent = 'Pay'; }
      }
    }

    /**
     * PayPal, in the card.
     *
     * A different shape from the token wallets: PayPal has no browser SDK
     * here that hands back a token. The payer approves in PayPal's own
     * window, and the money only moves when WE capture it afterwards.
     *
     * The window is opened SYNCHRONOUSLY, inside the click, before any
     * awaiting — a popup opened after an await is not user-initiated any
     * more and every browser blocks it. It is opened blank and pointed at
     * the approval URL once the server returns one.
     */
    async function payRedirect(provider){
      if (!chosenVariant) return;
      if (!SUBMIT_ENABLED) {
        say('Test mode — submission is switched off, so nothing was charged.');
        return;
      }
      // NO form required. PayPal collects the email and shipping address in its
      // own window, and the server backfills the order from PayPal's capture. If
      // the shopper happened to type them already, pass them through; otherwise
      // the order is created blank and PayPal fills it in — the same one-tap
      // promise as the other wallets.
      var email = (payQ('[data-pay-email]') || {}).value || '';
      var a = addr();
      var hasAddr = !!(a.name && a.line1 && a.city && a.country.length === 2);
      var win = window.open('', 'therum_pay', 'width=480,height=720');
      payStep('sending');
      try {
        var cart = await api('/cart/items', { variantId: chosenVariant.i, quantity: qty });
        if (hasAddr) await api('/cart/shipping', { cartToken: cart.token, shipAddress: a });
        var checkoutBody = { cartToken: cart.token };
        if (email) checkoutBody.email = email;
        if (hasAddr) checkoutBody.shipAddress = a;
        var order = await api('/cart/checkout', checkoutBody);
        var started = await api('/shop/checkout/redirect-start', {
          orderNumber: order.orderNumber, accessToken: order.accessToken, provider: provider,
        });
        if (!started.redirectUrl) throw new Error('PayPal did not return an approval link.');
        if (win) win.location.href = started.redirectUrl;
        else window.location.href = started.redirectUrl;   // popup blocked: go in place

        // Poll until it is captured or the window goes away. PayPal's own
        // page is cross-origin, so its contents cannot be read — the only
        // honest signals are our own order status and whether the window
        // still exists.
        var tries = 0;
        var done = await new Promise(function(resolve){
          var iv = setInterval(async function(){
            tries++;
            var r = await api('/shop/checkout/redirect-finish', {
              orderNumber: order.orderNumber, accessToken: order.accessToken, provider: provider,
            }).catch(function(){ return { paid: false }; });
            if (r.paid) { clearInterval(iv); resolve('paid'); return; }
            if (win && win.closed) { clearInterval(iv); resolve('closed'); return; }
            // ~4 minutes. Long enough to log in and approve, short enough
            // that an abandoned tab does not poll for ever.
            if (tries > 80) { clearInterval(iv); resolve('timeout'); }
          }, 3000);
        });
        if (win && !win.closed) win.close();

        if (done === 'paid') {
          var sub = payQ('[data-pay-done-sub]');
          if (sub) sub.textContent = 'Order ' + order.orderNumber + ' · ' + email;
          say('');
          payStep('done');
          if (resetTimer) clearTimeout(resetTimer);
          resetTimer = setTimeout(function(){
            resetCard(true);
            say('Order ' + order.orderNumber + ' confirmed — check your email for the details.');
          }, 3000);
          return;
        }
        // Closed or timed out: the order exists and is unpaid. Say so, and
        // leave the row so another method is one tap away.
        focusWay(null);
        payStep('payment');
        say(done === 'closed'
          ? 'PayPal was closed before the payment finished. Order ' + order.orderNumber + ' is saved but not paid.'
          : 'PayPal did not confirm in time. Order ' + order.orderNumber + ' is saved but not paid.', true);
      } catch (e) {
        if (win && !win.closed) win.close();
        focusWay(null);
        payStep('payment');
        say(e.message || String(e), true);
      }
    }

    /**
     * Did the shopper back out of a wallet sheet, rather than the payment
     * failing? Every gateway words this differently and none of them expose a
     * clean flag, so the message is what there is to go on. Erring toward
     * "cancelled" is the safe direction: a silent return costs a shopper one
     * tap, while a false "payment failed" on a deliberate cancel reads as
     * something being broken with the store.
     */
    function cancelled(e){
      var m = String((e && (e.message || e.code)) || '').toLowerCase();
      return m.indexOf('cancel') >= 0
        || m.indexOf('abort') >= 0
        || m.indexOf('dismiss') >= 0
        || m.indexOf('closed') >= 0
        || m.indexOf('user_cancel') >= 0;
    }
    var resetTimer = null;

    /**
     * Pay says whether it can work, before it is pressed.
     *
     * A live-looking button that refuses on click teaches the shopper the
     * store is broken; a disabled one that names what is missing teaches them
     * what to do next. The conditions are the real ones pay() enforces, so the
     * button and the guard cannot drift apart.
     */
    function syncPayBtn(){
      var go = payQ('[data-pay-go]');
      if (!go) return;
      var a = addr();
      var email = (payQ('[data-pay-email]') || {}).value || '';
      var why = !chosenVariant ? 'Choose an option first'
        : !email || email.indexOf('@') < 1 ? 'Add your email'
        : !a.name || !a.line1 || !a.city || a.country.length !== 2 ? 'Add your address'
        : !sqCard || !payReady ? 'Choose a payment method'
        : '';
      go.disabled = !!why;
      go.textContent = why || ('Pay ' + money(chosenVariant.p * qty));
    }
    // Quantity was missing entirely: the card could only ever buy one of
    // anything, and /cart/items was called with a hardcoded 1.
    var qty = 1;
    var QTY_MAX = 10;

    /** The receipt's order line: what, how many, how much in total. */
    function drawLine(){
      if (!chosenVariant) return;
      var sum = payQ('[data-pay-sum]');
      if (sum) {
        var what = [chosenVariant.c, chosenVariant.s].filter(Boolean).join(' · ');
        // The price shown is the LINE total, not the unit price — a receipt
        // that says $45.00 next to a quantity of three is a receipt nobody
        // trusts.
        sum.textContent = what + (what ? ' — ' : '') + money(chosenVariant.p * qty);
      }
      var n = payQ('[data-pay-qty-n]');
      if (n) n.textContent = String(qty);
      syncPayBtn();
      payEl.querySelectorAll('[data-pay-qty]').forEach(function(b){
        var d = parseInt(b.getAttribute('data-pay-qty'), 10);
        b.disabled = (qty + d) < 1 || (qty + d) > QTY_MAX;
      });
    }

    // ══════════════════════════════════════════════════════════════════════
    // FAST CHECKOUT — the browser's own payment sheet (Apple Pay / Google Pay
    // / Link), wired for real.
    //
    // Tapping one opens the native sheet, which hands back a payment method,
    // the payer's email AND a shipping address in a single authorisation — so
    // this path NEVER shows the email-and-address form. That is the whole point
    // of a wallet: no typing.
    //
    // The money settles through the very same /shop/checkout/pay-token the card
    // uses; all that differs is where the payment method and the contact come
    // from. Shipping is free here to match what the store charges today (items
    // only), so the total shown in the sheet equals the total captured — a
    // wallet that shows one price and charges another is fraud.
    // ══════════════════════════════════════════════════════════════════════

    // The product name, used as the sheet's line-item label.
    function productLabel(){
      var pimg = root.querySelector('.c-product-grid__thumb--base') || root.querySelector('.c-product-grid__thumb');
      return (pimg && pimg.getAttribute('alt')) || 'Your order';
    }

    // One renderer for the success face, shared by the card and the wallet so
    // the two confirmations can never drift.
    function fillDone(orderNumber, accessToken, email){
      var sub = payQ('[data-pay-done-sub]');
      if (sub) sub.textContent = 'Order ' + orderNumber + ' · ' + email;
      try {
        var doneSum = payQ('[data-pay-done-summary]');
        if (doneSum) {
          var pimg = root.querySelector('.c-product-grid__thumb--base') || root.querySelector('.c-product-grid__thumb');
          var psrc = pimg ? (pimg.currentSrc || pimg.getAttribute('src') || '') : '';
          var pname = (pimg && pimg.getAttribute('alt')) || 'Your order';
          var totEl = payQ('[data-pay-sum]');
          var totTxt = totEl ? (totEl.textContent || '').replace(/\\s+/g, ' ').trim() : '';
          doneSum.innerHTML =
            (psrc ? '<img class="card-pay__done-thumb" src="' + psrc.replace(/"/g, '&quot;') + '" alt="">' : '')
            + '<div class="card-pay__done-lines">'
            + '<div class="card-pay__done-name">' + esc(pname) + '</div>'
            + '<div class="card-pay__done-meta">Qty ' + qty + (totTxt ? ' &middot; ' + esc(totTxt) : '') + '</div>'
            + '</div>';
          doneSum.hidden = false;
        }
        var doneLink = payQ('[data-pay-done-link]');
        if (doneLink && orderNumber && accessToken) {
          doneLink.href = '/order-received/?order=' + encodeURIComponent(orderNumber) + '&token=' + encodeURIComponent(accessToken);
          doneLink.hidden = false;
        }
      } catch (e) {}
    }

    var stripePR = null;              // Stripe PaymentRequest, built once per card
    var stripeCan = null;             // what the browser can present: {applePay,googlePay,link}|null
    var stripeWalletsReady = null;    // the init promise, so a fast tap can await it
    var WALLET_PR_KEY = { apple_pay: 'applePay', google_pay: 'googlePay', link: 'link' };

    // Build the PaymentRequest, ask the browser what it can actually present,
    // and hide any wallet button it cannot. Called once, after the row renders.
    async function initStripeWallets(providers, box){
      var sp = (providers || []).filter(function(p){ return p.provider === 'stripe' && p.ready; })[0];
      var key = sp && sp.client && sp.client.publishableKey;
      if (!key || !chosenVariant || !box) return;
      try {
        await loadSdk('https://js.stripe.com/v3/');
        var stripe = window.Stripe(key);
        var freeShip = [{ id: 'standard', label: 'Standard shipping', detail: 'Ships in a few days', amount: 0 }];
        stripePR = stripe.paymentRequest({
          country: 'US', currency: 'usd',
          total: { label: productLabel(), amount: Math.max(1, chosenVariant.p * qty) },
          requestPayerName: true, requestPayerEmail: true, requestShipping: true,
          shippingOptions: freeShip,
        });
        stripeCan = await stripePR.canMakePayment();

        // US only. An address we do not ship to is refused in the sheet, before
        // any money moves, with the total left untouched.
        stripePR.on('shippingaddresschange', function(ev){
          if (((ev.shippingAddress && ev.shippingAddress.country) || '').toUpperCase() !== 'US') {
            return ev.updateWith({ status: 'invalid_shipping_address' });
          }
          ev.updateWith({ status: 'success', shippingOptions: freeShip });
        });
        stripePR.on('paymentmethod', onWalletPaymentMethod);

        // NOTHING is hidden. Every wallet stays visible; canMakePayment above
        // only decides ROUTING at click time — the native sheet where this
        // browser supports the wallet, the QR ("pay on your phone") where it
        // does not. A desktop that cannot present Apple Pay still shows the
        // button, and tapping it offers the phone hand-off instead of vanishing.
        void box;
      } catch (e) { /* wallets are a shortcut; the card form still sells */ }
    }

    // The sheet came back authorised. Build the order from what it gave us — no
    // form — and settle it through the same endpoint the card uses.
    async function onWalletPaymentMethod(ev){
      try {
        var s = ev.shippingAddress || {};
        var lines = s.addressLine || [];
        var a = {
          name: ev.payerName || s.recipient || '',
          line1: lines[0] || '',
          city: s.city || '',
          country: (s.country || 'US').toUpperCase(),
        };
        if (lines[1]) a.line2 = lines[1];
        if (s.region) a.region = s.region;
        if (s.postalCode) a.postalCode = s.postalCode;
        if (!a.line1 || !a.city || a.country.length !== 2) {
          ev.complete('invalid_shipping_address');
          say('That address was incomplete — try another card or the form.', true);
          return;
        }
        var email = ev.payerEmail || '';
        var cart = await api('/cart/items', { variantId: chosenVariant.i, quantity: qty });
        await api('/cart/shipping', { cartToken: cart.token, shipAddress: a });
        var order = await api('/cart/checkout', { cartToken: cart.token, email: email, shipAddress: a });
        var paid = await api('/shop/checkout/pay-token', {
          orderNumber: order.orderNumber, accessToken: order.accessToken,
          provider: 'stripe', token: ev.paymentMethod.id,
        });
        // Dismiss the sheet as success BEFORE painting our confirmation, or it
        // lingers over the card.
        ev.complete('success');
        drawLine();
        fillDone(paid.orderNumber, paid.accessToken || order.accessToken, email);
        say('');
        payStep('done');
        if (resetTimer) clearTimeout(resetTimer);
        resetTimer = setTimeout(function(){
          resetCard(true);
          say('Order ' + paid.orderNumber + ' confirmed — check your email for the details.');
        }, 12000);
      } catch (e) {
        // Genuine failure: fail the sheet so it stops spinning, drop back to the
        // first step and say what happened.
        try { ev.complete('fail'); } catch (x) {}
        payStep('who');
        say(e.message || String(e), true);
      }
    }

    // Pressing a token-wallet icon: sync the sheet to the current quantity, then
    // show it. A dismissed sheet is not an error — nothing was collapsed, so
    // nothing is restored and nothing is said.
    // Cross-device fallback: reveal a QR of THIS product's page. The shopper
    // scans it, lands on the product on their phone, and pays there with the
    // native wallet. The wallet row stays exactly where it is underneath — the
    // QR is added, never a swap, so nothing disappears.
    function showQr(){
      var img = payQ('[data-pay-qr-img]');
      if (img && !img.firstChild) {
        // The product link lives on the CARD ITEM, not this inner root — so
        // reach up to it. On a PDP (no card item) the page IS the product, so
        // location.pathname is the right fallback.
        var item = root.closest('.c-product-grid__item');
        var link = item && item.querySelector('.woocommerce-LoopProduct-link');
        var path = (link && link.getAttribute('href')) || location.pathname;
        img.innerHTML = '<img src="/shop/qr?path=' + encodeURIComponent(path) + '" width="180" height="180" alt="Scan to pay on your phone">';
      }
      var panel = payQ('[data-pay-qr]'); if (panel) panel.hidden = false;
    }
    function hideQr(){ var panel = payQ('[data-pay-qr]'); if (panel) panel.hidden = true; }

    async function payWallet(){
      if (!chosenVariant) return;
      if (!SUBMIT_ENABLED) { say('Test mode — nothing was charged.'); return; }
      if (stripeWalletsReady) { try { await stripeWalletsReady; } catch (e) {} }
      if (!stripePR || !stripeCan) {
        say('That wallet is not available on this device — use card instead.', true);
        return;
      }
      try {
        stripePR.update({ total: { label: productLabel(), amount: Math.max(1, chosenVariant.p * qty) } });
        stripePR.show();
      } catch (e) {
        if (!cancelled(e)) say(e.message || String(e), true);
      }
    }

    var walletsLoaded = false;
    var walletsAvailable = false;   // did any express button actually render?
    // The express options, in method-strip shape, so the Payment tab can
    // offer exactly what the icon row offered.
    var expressMethods = [];
    // Assigned inside the payEl block below, but called from pay(), which
    // lives out here. Declared at this scope on purpose rather than relying on
    // a block-scoped function declaration leaking out of an if.
    var focusWay = function(){};
    // Same reason as focusWay: assigned inside the payEl block, called from
    // pay() out here. Declared at this scope rather than leaning on a block
    // function declaration leaking.
    var openSec = function(){};
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
        syncPayBtn();
      } catch (e) {
        say('Card payments could not start: ' + (e.message || e), true);
      }
    }

    // A saved card chosen from the list. When set, no field needs mounting —
    // the card already exists at the gateway.
    var savedCardId = null;

    /**
     * Show this shopper's saved cards, if they are signed in and have any.
     *
     * Silent when signed out or when there are none: an empty "saved cards"
     * heading tells a first-time buyer about a feature they cannot use yet,
     * at the exact moment they are trying to pay.
     */
    async function loadSavedCards(){
      var box = payQ('[data-pay-saved]');
      var consent = payQ('[data-pay-savecard]');
      var token = null;
      try { token = localStorage.getItem('therum_customer_token'); } catch (e) { /* private mode */ }
      if (!token) return;
      // Signed in, so offering to remember the card is meaningful.
      if (consent) consent.hidden = false;
      if (!box) return;
      try {
        var r = await fetch('/api/shop/account/payment-methods', {
          headers: { Authorization: 'Bearer ' + token },
        });
        if (!r.ok) return;
        var cards = (await r.json()).cards || [];
        if (!cards.length) return;
        box.innerHTML = '<div class="card-pay__saved-t">Your cards</div>'
          + cards.map(function(c){
              return '<button type="button" class="card-pay__saved-card" data-saved="' + esc(c.id) + '">'
                + '<span class="card-pay__saved-brand">' + esc(String(c.brand).toUpperCase()) + '</span>'
                + '<span>•••• ' + esc(c.last4) + '</span>'
                + '<span class="card-pay__saved-exp">' + esc(String(c.expMonth).padStart(2, '0')) + '/' + esc(String(c.expYear).slice(-2)) + '</span>'
                + '</button>';
            }).join('');
        box.hidden = false;
        box.addEventListener('click', function(e){
          var b = e.target.closest('[data-saved]');
          if (!b) return;
          savedCardId = b.getAttribute('data-saved');
          box.querySelectorAll('[data-saved]').forEach(function(x){ x.classList.toggle('on', x === b); });
          // A saved card IS the payment method, so the typed-card field and
          // the "save this card" offer both stop applying.
          var field = payQ('[data-pay-cardfield]');
          if (field) field.hidden = true;
          if (consent) consent.hidden = true;
          payReady = payReady || { provider: 'stripe' };
          sqCard = sqCard || { __saved: true };
          syncPayBtn();
        });
      } catch (e) { /* saved cards are a convenience, never a blocker */ }
    }

    /** Ask the mounted field for a token. Null means "no card path available". */
    async function tokenize(){
      // A saved card needs no tokenising — the id from the list IS the
      // payment method, and asking a non-existent field for a token would
      // throw on the one path that should be the fastest.
      if (savedCardId) return savedCardId;
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
        var groups = (data.groups || []).slice();
        var methods = (data.methods || []).slice();
        // NO EXPRESS TAB IN THE CARD. The four icons are the first thing in
        // this panel, so a tab repeating them is the same row twice — and a
        // tab that duplicates its own page teaches people the tabs do not
        // mean anything. It belongs on the full checkout page, which has no
        // icon row of its own.
        // expressMethods is still populated; nothing here consumes it.
        box.hidden = false;
        box.innerHTML =
          '<div class="card-pay__tabs">' + groups.filter(function(g){
            // Hide a group entirely when nothing in it is set up — a disabled
            // tab just advertises what the store cannot do yet. Coming-soon
            // methods are a deliberate tease, so a group holding one still shows.
            return methods.some(function(m){ return m.group === g.id && (m.available || m.comingSoon); });
          }).map(function(g){
            return '<button type="button" class="card-pay__tab" data-mgroup="' + g.id + '">' + g.ico + ' ' + g.label + '</button>';
          }).join('') + '</div><div class="card-pay__methods" data-pay-methods></div>';

        box.addEventListener('click', function(e){
          var t = e.target.closest('[data-mgroup]');
          if (t && !t.disabled) return showGroup(t.getAttribute('data-mgroup'), methods);
          var b = e.target.closest('[data-method]');
          if (b && !b.disabled) {
            var mid = b.getAttribute('data-method');
            // An express entry is the SAME action as the icon at the top, not
            // a selection to be confirmed with Pay — tapping Apple Pay here
            // and then having to press Pay would be two taps for a one-tap
            // method.
            var ex = mid && mid.indexOf('wallet:') === 0
              ? expressMethods.filter(function(m){ return m.id === mid; })[0]
              : null;
            if (ex) {
              payProvider = ex.provider;
              if (ex.kind === 'redirect') return payRedirect(ex.provider);
              // Token wallets open the browser sheet, same as the icon row —
              // never the card form.
              if (ex.provider === 'stripe') return payWallet();
              return loadClientAndMount(ex.provider).then(function(){ pay(); });
            }
            chosenMethod = { id: mid, provider: b.getAttribute('data-provider') };
            box.querySelectorAll('[data-method]').forEach(function(x){ x.classList.toggle('on', x === b); });
            // Selecting a card-style method has to actually mount its field,
            // or Pay stays disabled saying "choose a payment method" after
            // the shopper just chose one.
            loadClientAndMount(b.getAttribute('data-provider'));
            syncPayBtn();
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
      host.innerHTML = methods.filter(function(m){ return m.group === groupId; })
        // Setup-required methods are hidden, not advertised. The only exception
        // is one flagged coming-soon (real, approval pending) — it shows, inert,
        // saying so, rather than as a dead "setup required" chip.
        .filter(function(m){ return m.available || m.comingSoon; })
        .map(function(m){
          var soon = !m.available && m.comingSoon;
          return '<button type="button" class="card-pay__method" data-method="' + m.id + '"'
            + ' data-provider="' + (m.provider || '') + '"' + (m.available ? '' : ' disabled') + '>'
            + '<span>' + m.label + (m.sub ? '<em>' + m.sub + '</em>' : '') + '</span>'
            + (soon ? '<span class="card-pay__na">Payment availability coming soon</span>' : '') + '</button>';
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
    // Circular icon buttons. The MARK does the identifying — a payment brand
    // is recognised faster as its glyph than as its name, and four names in a
    // row on a card this narrow truncate to nonsense.
    // The accessible name is still the full brand, so a screen reader and a
    // tooltip both say "Apple Pay", not "button".
    var walletLabels = {
      apple_pay: 'Apple Pay', google_pay: 'Google Pay', link: 'Link',
      shop_pay: 'Shop Pay', paypal: 'PayPal',
    };
    var walletIcons = {
      apple_pay: '<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true">'
        + '<path d="M16.3 12.7c0-2 1.6-3 1.7-3-1-1.3-2.4-1.5-2.9-1.6-1.2-.1-2.4.7-3 .7-.6 0-1.6-.7-2.6-.7-1.3 0-2.6.8-3.2 2-1.4 2.4-.4 6 1 8 .7 1 1.5 2 2.5 2 1 0 1.4-.6 2.6-.6s1.5.6 2.6.6c1.1 0 1.8-1 2.4-1.9.8-1.1 1.1-2.2 1.1-2.3 0 0-2.2-.8-2.2-3.2zM14.4 6.3c.5-.7.9-1.6.8-2.6-.8 0-1.8.5-2.4 1.2-.5.6-1 1.6-.8 2.5.9.1 1.8-.4 2.4-1.1z"/></svg>',
      google_pay: '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">'
        + '<path fill="#4285F4" d="M21.6 12.2c0-.6-.1-1.2-.2-1.8H12v3.4h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.1z"/>'
        + '<path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z"/>'
        + '<path fill="#FBBC04" d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2L6.4 14z"/>'
        + '<path fill="#EA4335" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.8-2.8A10 10 0 0 0 3.1 7.4L6.4 10c.8-2.3 3-4.1 5.6-4.1z"/></svg>',
      link: '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">'
        + '<circle cx="12" cy="12" r="10" fill="#00D66F"/>'
        + '<path fill="#011E0F" d="M8.6 7.4h2.2v9.2H8.6zM12.4 12l3-4.6h2.5l-3.1 4.5 3.2 4.7h-2.6z"/></svg>',
      paypal: '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">'
        + '<path fill="#002C8A" d="M8.9 20.4H6.1c-.3 0-.5-.3-.4-.6l2.6-16c0-.3.3-.5.6-.5h5.4c2.9 0 4.7 1.4 4.4 4.2-.4 3.2-2.7 4.7-5.7 4.7h-2c-.3 0-.5.2-.6.5z"/>'
        + '<path fill="#009BE1" d="M18.7 7.5c.4 2.7-1.4 5.6-5 5.6h-2.1c-.3 0-.5.2-.6.5l-.9 5.6c0 .3-.3.5-.6.5h-.6l.6-3.9c0-.3.3-.5.6-.5h2c3.1 0 5.4-1.5 5.8-4.7.1-1.2-.1-2.2-.7-2.9z"/>'
        + '<path fill="#001F6B" d="M8.9 20.4l.4-2.7h-.4z"/></svg>',
    };
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
        var express = [];
        ready.forEach(function(p){
          (p.wallets || []).forEach(function(w){
            if (!walletLabels[w]) return;
            express.push({ id: 'wallet:' + w, group: 'express', label: walletLabels[w],
              available: true, provider: p.provider, wallet: w, kind: p.kind || 'token' });
            // data-wallet-kind travels with the button so the click handler
            // can tell a token wallet from a redirect one. Sending PayPal
            // down the token path throws at the server's provider guard.
            buttons.push('<button type="button" class="card-pay__wallet" data-wallet="' + w
              + '" data-wallet-kind="' + (p.kind || 'token') + '"'
              + ' data-wallet-provider="' + p.provider + '"'
              + ' title="' + walletLabels[w] + '" aria-label="Pay with ' + walletLabels[w] + '">'
              + (walletIcons[w] || '<span class="card-pay__wallet-txt">' + walletLabels[w] + '</span>')
              + '</button>');
          });
        });
        if (buttons.length === 0) return;   // stays hidden; no empty express row
        // Remembered so the Payment strip can offer the same options as a
        // tab, for anyone who scrolled past the row at the top.
        expressMethods = express;
        box.innerHTML = buttons.join('');
        box.hidden = false;
        walletsAvailable = true;
        var or = payQ('[data-pay-or]');
        if (or) or.hidden = false;
        // Wire the token wallets to the real browser sheet and hide any the
        // device cannot present. After render, so the buttons exist to gate.
        stripeWalletsReady = initStripeWallets(data.providers, box);
      } catch (e) { /* express is a shortcut; losing it costs nothing */ }
    }

    // ── Address autocomplete ──────────────────────────────────────────────
    //
    // Stripe's Address Element. Chosen over a Places key because it needs no
    // new credential, no billing account and no server work — Stripe is
    // already connected and its publishable key is already being fetched for
    // the card field.
    //
    // It WRITES INTO the plain inputs rather than replacing them. That keeps
    // one source of truth: addr(), the validation and the ship-to echo all
    // read the same fields whether the element mounted or not, so a shopper
    // on a browser where it fails to load still has a working form rather
    // than an empty div.
    var addressMounted = false;
    async function mountAddress(){
      if (addressMounted) return;
      var host = payQ('[data-pay-address]');
      if (!host) return;
      try {
        var res = await fetch('/api/shop/wallets');
        var data = await res.json();
        var sp = (data.providers || []).filter(function(x){ return x.provider === 'stripe'; })[0];
        var key = sp && sp.publishableKey;
        if (!key) return; // no Stripe -> the plain fields stay, which is fine
        await loadSdk('https://js.stripe.com/v3/');
        var stripe = window.Stripe(key);
        var els = stripe.elements();
        var addressEl = els.create('address', {
          mode: 'shipping',
          autocomplete: { mode: 'automatic' },
          defaultValues: { name: (payQ('[data-pay-name]') || {}).value || '' },
        });
        addressEl.mount(host);
        host.hidden = false;
        // Once the element is driving, the raw inputs would be a duplicate
        // form asking the same questions twice.
        ['[data-pay-line1]','[data-pay-city]','[data-pay-region]','[data-pay-postal]','[data-pay-country]']
          .forEach(function(sel){ var el = payQ(sel); if (el) el.hidden = true; });
        payEl.querySelectorAll('[data-pay-sec-body="who"] .card-pay__row').forEach(function(r){ r.hidden = true; });
        addressEl.on('change', function(ev){
          var v = ev.value || {}; var a = v.address || {};
          var set = function(sel, val){ var el = payQ(sel); if (el) el.value = val || ''; };
          set('[data-pay-line1]', a.line1);
          set('[data-pay-city]', a.city);
          set('[data-pay-region]', a.state);
          set('[data-pay-postal]', a.postal_code);
          set('[data-pay-country]', a.country);
          if (v.name) set('[data-pay-name]', v.name);
        });
        addressMounted = true;
      } catch (e) {
        // Autocomplete is an enhancement. Losing it costs a nicety, not the
        // sale — the typed fields are still there and still validated.
      }
    }

    async function loadClientAndMount(provider){
      try {
        var res = await fetch('/api/shop/wallets');
        var data = await res.json();
        var p = (data.providers || []).filter(function(x){ return x.provider === provider; })[0];
        if (p) { payReady = p; await mountCardField(); }
      } catch (e) { /* the strip still works; only the inline field is lost */ }
    }

    // Shared by the picker's confirm AND by the single-variant shortcut, so
    // both paths land on an identically-prepared pay face.
    function openPay(){
      if (!chosenVariant) return;
      qty = 1;
      drawLine();
      face('pay');
      payStep('who');
      // Wallets only — the express path needs to be visible before the form,
      // because taking it means never filling the form in. The method strip
      // waits for the payment step.
      loadWallets();
    }

    confirm.addEventListener('click', function(){
      if (confirm.disabled) return;
      openPay();
    });

    /** Which half of the pay face is showing. */
    function payStep(name){
      if (!payEl) return;
      payEl.querySelectorAll('[data-pay-step]').forEach(function(el){
        el.hidden = el.getAttribute('data-pay-step') !== name;
      });
      payEl.setAttribute('data-step', name);
      // An error belongs to the step that raised it. Walking back used to
      // carry "add your address" onto the name-and-email step, where it was
      // both wrong and unfixable.
      say('');
      // Back has nowhere to go from the success face, and offering it would
      // invite someone to walk backwards into a paid order.
      var b = payQ('[data-pay-back]');
      if (b) b.hidden = name === 'done';
      // Move focus to the step's first field so the keyboard follows the
      // shopper instead of being dismissed between steps.
      var first = payEl.querySelector('[data-pay-step="' + name + '"] .card-pay__in');
      if (first && name !== 'who') { try { first.focus({ preventScroll: true }); } catch (e) { first.focus(); } }
    }

    // Put the card back the way it was found. Called from Keep shopping and
    // after a wallet payment — the grid stays usable, and the next shopper on
    // this device does not inherit the last one's email and address.
    function resetCard(keepMessage){
      if (resetTimer) { clearTimeout(resetTimer); resetTimer = null; }
      if (payEl) {
        payEl.querySelectorAll('.card-pay__in').forEach(function(i){ i.value = ''; });
        var sub = payQ('[data-pay-done-sub]'); if (sub) sub.textContent = '';
        payStep('who');
      }
      // The auto-reset carries the order number out with it; a manual Keep
      // shopping is the shopper saying they are done reading.
      if (!keepMessage) say('');
      face('rest');
    }

    if (payEl) {
      // ── The accordion ──────────────────────────────────────────────────
      //
      // Sections live INSIDE the 'who' step now; 'where' and 'payment' are no
      // longer steps of their own. Opening one closes the other, and a
      // completed section collapses to its summary line.
      openSec = function(name){
        payEl.querySelectorAll('[data-pay-sec-body]').forEach(function(b){
          b.hidden = b.getAttribute('data-pay-sec-body') !== name;
        });
        payEl.querySelectorAll('[data-pay-sec-toggle]').forEach(function(h){
          h.setAttribute('aria-expanded', String(h.getAttribute('data-pay-sec-toggle') === name));
        });
        if (name === 'payment') { loadMethods(); loadSavedCards(); }
        if (name === 'who') { mountAddress(); }
        syncPayBtn();
      };
      function secSummary(name, text){
        var el = payEl.querySelector('[data-pay-sec-sum="' + name + '"]');
        if (el) el.textContent = text || '';
      }
      payEl.querySelectorAll('[data-pay-sec-toggle]').forEach(function(h){
        h.addEventListener('click', function(){
          var name = h.getAttribute('data-pay-sec-toggle');
          var body = payEl.querySelector('[data-pay-sec-body="' + name + '"]');
          // Tapping the open one closes it; tapping a closed one opens it and
          // closes whatever else was open.
          openSec(body && body.hidden ? name : null);
        });
      });

      var back = payQ('[data-pay-back]');
      if (back) back.addEventListener('click', function(){
        // The receipt is one step now, so back leaves it rather than walking
        // sections — the accordion headers are how you move between those.
        var receipt = payQ('[data-pay-receipt]');
        if (receipt && !receipt.hidden) { focusWay(null); return; }
        face('pick');
      });

      // Each step validates only ITS OWN fields, so nothing complains about a
      // box that is not on screen yet — the whole reason the form was split.
      // Finish "To whom and where": validate everything the section asks for,
      // collapse it to a summary line, and open Payment.
      function advance(){
        var email = (payQ('[data-pay-email]') || {}).value || '';
        var name = (payQ('[data-pay-name]') || {}).value || '';
        if (!email) return say('Add your email so we can send the receipt.', true);
        if (email.indexOf('@') < 1) return say('That email does not look right.', true);
        if (!name.trim()) return say('Add your name.', true);
        var a = addr();
        if (!a.line1 || !a.city || a.country.length !== 2) {
          return say('Add your address, city and 2-letter country.', true);
        }
        say('');
        // The collapsed line reads like a receipt entry, and it is how the
        // shopper checks the address took without reopening anything.
        secSummary('who', [a.name, a.line1, a.city, a.region, a.postal].filter(Boolean).join(', '));
        var to = payQ('[data-pay-shipto]');
        if (to) to.textContent = 'Shipping to ' + [a.name, a.line1, a.city, a.region, a.postal].filter(Boolean).join(', ');
        openSec('payment');
      }
      // Every step's Continue runs the same walker.
      payEl.querySelectorAll('[data-pay-next]').forEach(function(b){
        b.addEventListener('click', advance);
      });
      payEl.addEventListener('input', function(){ syncPayBtn(); });

      // ── LESS TYPING ─────────────────────────────────────────────────────
      //
      // A US ZIP determines the city and state, so asking for all three is
      // asking twice. Filled from the post office's own public lookup, and
      // only into fields the shopper has left empty — never overwriting
      // something they typed on purpose.
      var zipEl = payQ('[data-pay-postal]');
      if (zipEl) {
        var zipDone = '';
        zipEl.addEventListener('input', async function(){
          var z = (zipEl.value || '').trim();
          var country = ((payQ('[data-pay-country]') || {}).value || 'US').toUpperCase();
          if (country !== 'US' || !/^\\d{5}$/.test(z) || z === zipDone) return;
          zipDone = z;
          try {
            var r = await fetch('https://api.zippopotam.us/us/' + z);
            if (!r.ok) return;
            var j = await r.json();
            var place = (j.places || [])[0];
            if (!place) return;
            var city = payQ('[data-pay-city]');
            var region = payQ('[data-pay-region]');
            if (city && !city.value) city.value = place['place name'] || '';
            if (region && !region.value) region.value = place['state abbreviation'] || '';
            syncPayBtn();
          } catch (e) { /* a lookup that fails just means they type it */ }
        });
      }
      // Enter should move on. On a phone the keyboard's Go key is the button
      // most people reach for, and a form that ignores it feels broken.
      payEl.addEventListener('keydown', function(e){
        if (e.key !== 'Enter') return;
        if (!e.target.closest || !e.target.closest('.card-pay__in')) return;
        e.preventDefault();
        advance();
      });

      var resetBtn = payQ('[data-pay-reset]');
      if (resetBtn) resetBtn.addEventListener('click', function(){ resetCard(); });

      // Leave the checkout, keep the work. face('rest') alone is deliberate:
      // resetCard() would wipe the fields, and someone closing a card to go
      // and check something should not be punished for it.
      var closeBtn = payQ('[data-pay-close]');
      // Moved OUT of the pay panel and onto the card itself. Sitting on the
      // rail beside the back chevron — level with the colour swatches — it
      // read as "close the swatches", which is not a thing anyone wants to
      // do. Top-right of the card is where a close control belongs, and
      // anchoring it to the tile is the only way to put it there: .card-evolve
      // is position:relative, so a CSS offset from inside the panel can never
      // reach past it.
      if (closeBtn) {
        var cardItem = root.closest('.c-product-grid__item');
        if (cardItem) { cardItem.appendChild(closeBtn); cardItem.classList.add('has-card-close'); }
      }
      if (closeBtn) closeBtn.addEventListener('click', function(){
        if (resetTimer) { clearTimeout(resetTimer); resetTimer = null; }
        say('');
        face('rest');
      });

      payEl.addEventListener('click', function(e){
        var q = e.target.closest('[data-pay-qty]');
        if (!q || q.disabled) return;
        var next = qty + parseInt(q.getAttribute('data-pay-qty'), 10);
        if (next < 1 || next > QTY_MAX) return;
        qty = next;
        drawLine();
      });

      // Back to the product card to re-choose colour or size. The chevron
      // unwinds one step at a time and gives no hint it eventually reaches
      // the picker, so this says it outright. Everything typed is cleared:
      // changing the product mid-flow means the receipt starts again.
      var editBtn = payQ('[data-pay-edit]');
      if (editBtn) editBtn.addEventListener('click', function(){
        qty = 1;
        resetCard();
        face('pick');
        draw();
      });

      // ── Sign in, in place ───────────────────────────────────────────────
      //
      // Never navigates. A shopper part way through a purchase who gets sent
      // to a login page has lost the purchase, which is the entire thing this
      // flow exists to avoid.
      //
      // The session fills the NAME and email only: the server stores no
      // address for a customer (/shop/account/me returns id, email, name and
      // identities), so there is nothing to prefill the shipping step with.
      // Claiming otherwise would mean inventing an address.
      // EXPAND ONE, STAND THE OTHERS DOWN.
      // The row of ways in collapses to whichever was chosen, so the card
      // shows one action instead of four. waysRow() puts them all back.
      var waysBack = payQ('[data-pay-ways]');
      focusWay = function(which){
        var wallets = payQ('[data-pay-wallets]');
        var box = payQ('[data-pay-signin-box]');
        var btn = payQ('[data-pay-signin]');
        var detailsBtn = payQ('[data-pay-open-details]');
        var receipt = payQ('[data-pay-receipt]');
        var expanded = which !== null;
        // One way in at a time. Choosing a wallet hides sign-in and the
        // details button; choosing sign-in hides the wallet row; opening the
        // details receipt hides both of the others.
        if (wallets) wallets.hidden = expanded ? which !== 'wallets' : !walletsAvailable;
        if (btn) btn.hidden = expanded && which !== 'signin';
        if (box) box.hidden = which !== 'signin';
        if (detailsBtn) detailsBtn.hidden = expanded && which !== 'details';
        if (receipt) receipt.hidden = which !== 'details';
        // "or pay a different way" belongs to the WALLETS only. Signing in is
        // not a way of paying — it is how you get to your own payment options
        // — so offering to pay differently underneath it answers a question
        // nobody asked, and reads as an escape from the sign-in form.
        if (waysBack) waysBack.hidden = which !== 'wallets';
        payEl.setAttribute('data-way', which || '');
        // With no wallet to compete with, the details button IS the way in —
        // "or" would be offering an alternative to nothing.
        var label = payQ('.card-pay__details-label');
        // In details mode the button flips to the way BACK: tapping it restores
        // the quick-checkout row. Bam's rule — users need a way to get back and
        // forth, not a one-way door into the form.
        if (label) label.textContent = !walletsAvailable ? 'Enter your details'
          : which === 'details' ? 'or sign in for quick checkout'
          : 'or enter your details';
        if (detailsBtn) detailsBtn.classList.toggle('is-primary', !walletsAvailable);
      };
      var openDetails = payQ('[data-pay-open-details]');
      if (openDetails) openDetails.addEventListener('click', function(){
        // A toggle, not a one-way door. If the form is already open and there
        // is a quick-checkout row to return to, this button reads "or sign in
        // for quick checkout" and brings the wallet buttons back.
        var receipt = payQ('[data-pay-receipt]');
        if (receipt && !receipt.hidden && walletsAvailable) {
          var box = payQ('[data-pay-wallets]');
          if (box) box.querySelectorAll('[data-wallet]').forEach(function(b){ b.hidden = false; });
          focusWay(null);
          say('');
          return;
        }
        focusWay('details');
        var em = payQ('[data-pay-email]');
        if (em) { try { em.focus({ preventScroll: true }); } catch (e) { em.focus(); } }
      });
      if (waysBack) waysBack.addEventListener('click', function(){
        // Every wallet button comes back too — collapsing to one is a view of
        // the row, not a permanent choice.
        var box = payQ('[data-pay-wallets]');
        if (box) box.querySelectorAll('[data-wallet]').forEach(function(b){ b.hidden = false; });
        focusWay(null);
        say('');
      });

      var signinBtn = payQ('[data-pay-signin]');
      var signinBox = payQ('[data-pay-signin-box]');
      if (signinBtn && signinBox) {
        signinBtn.addEventListener('click', function(){
          focusWay(signinBox.hidden ? 'signin' : null);
          if (!signinBox.hidden) { var pw = payQ('[data-pay-password]'); if (pw) pw.focus(); }
        });
        var doSignIn = async function(){
          var emailEl = payQ('[data-pay-email]');
          var pwEl = payQ('[data-pay-password]');
          var email = (emailEl || {}).value || '';
          var password = (pwEl || {}).value || '';
          if (!email) { if (emailEl) emailEl.focus(); return say('Enter your email first.', true); }
          if (!password) return say('Enter your password.', true);
          var go = payQ('[data-pay-signin-go]');
          if (go) { go.disabled = true; go.textContent = 'Signing in…'; }
          try {
            var s = await api('/shop/account/login', { email: email, password: password });
            try { localStorage.setItem('therum_customer_token', s.token); } catch (e) { /* private mode */ }
            var nameEl = payQ('[data-pay-name]');
            if (nameEl && s.customer && s.customer.name) nameEl.value = s.customer.name;

            // Pull the saved address too. Signing in mid-purchase is meant to
            // REMOVE typing; filling only the name and leaving five address
            // fields blank barely earns the tap.
            try {
              var me = await fetch('/api/shop/account/me', {
                headers: { Authorization: 'Bearer ' + s.token },
              }).then(function(r){ return r.ok ? r.json() : null; });
              var ad = me && me.address;
              if (ad) {
                var put = function(sel, v){ var el = payQ(sel); if (el && !el.value && v) el.value = v; };
                put('[data-pay-line1]', ad.line1);
                put('[data-pay-city]', ad.city);
                put('[data-pay-region]', ad.region);
                put('[data-pay-postal]', ad.postalCode);
                put('[data-pay-country]', ad.country);
                // Straight to the receipt with everything already filled —
                // there is nothing left to ask on the sign-in panel.
                focusWay('details');
                openSec('who');
              }
            } catch (e) { /* no saved address is normal for a new customer */ }
            syncPayBtn();
            signinBox.hidden = true;
            if (pwEl) pwEl.value = '';
            signinBtn.textContent = 'Signed in as ' + ((s.customer && s.customer.email) || email);
            signinBtn.disabled = true;
            say('');
          } catch (e) {
            say('That email and password did not match.', true);
          } finally {
            if (go) { go.disabled = false; go.textContent = 'Sign in'; }
          }
        };
        var signinGo = payQ('[data-pay-signin-go]');
        if (signinGo) signinGo.addEventListener('click', doSignIn);
        // Enter inside the password field signs in rather than advancing the
        // step — the generic Enter handler would otherwise skip past it.
        var pwField = payQ('[data-pay-password]');
        if (pwField) pwField.addEventListener('keydown', function(e){
          if (e.key !== 'Enter') return;
          e.preventDefault(); e.stopPropagation();
          doSignIn();
        });
      }

      var goBtn = payQ('[data-pay-go]');
      if (goBtn) goBtn.addEventListener('click', function(){ pay(); });
      payEl.addEventListener('click', function(e){
        if (e.target.closest('[data-pay-qr-back]')) { hideQr(); return; }
        var w = e.target.closest('[data-wallet]');
        if (!w) return;
        payProvider = w.getAttribute('data-wallet-provider');
        var kind = w.getAttribute('data-wallet-kind');
        // Every option stays put — nothing is ever hidden or pruned.
        // PayPal approves in its own popup and is captured server-side.
        if (kind === 'redirect') return payRedirect(payProvider);
        // Token wallets (Apple Pay, Google Pay, Link): open the browser's NATIVE
        // sheet when this browser can present this wallet; otherwise fall back to
        // the QR — scan to finish on a phone, where the wallet IS native. So a
        // desktop with no wallet configured still has a real way to pay by phone
        // rather than a dead button.
        if (payProvider === 'stripe') {
          var key = WALLET_PR_KEY[w.getAttribute('data-wallet')];
          if (stripeCan && key && stripeCan[key]) return payWallet();
          // The QR is a DESKTOP-ONLY bridge: scan it with a phone. On a phone it
          // would only reopen this very page — useless — so there we never show
          // it. Send the shopper to the card/other methods below instead.
          if (!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches)) return showQr();
          say('That wallet is not available on this device — use card or another option below.', true);
          openSec('payment');
          return;
        }
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
.c-product-grid__title{font-size:15.5px;font-weight:600;line-height:1.3}
.c-product-grid__short-desc{font-size:12px;color:var(--text-color-light,#888);margin-top:2px}
.c-product-grid__price-wrap{font-size:14px;font-weight:600}
.c-product-grid__title-wrap{display:flex;flex-direction:column;gap:4px}

/* ── SHAPE ──────────────────────────────────────────────────────────────
   --card-r rounds the CARD only — the photo keeps its own square corners (Bam's
   call). A card with a shell shows the rounded frame around a square image. */
.card-radius-sharp{--card-r:0}
.card-radius-soft{--card-r:6px}
.card-radius-round{--card-r:16px}
.card-radius-pill{--card-r:28px}
.card-radius-squircle{--card-r:24px}
.c-product-grid__item{border-radius:var(--card-r,0)}
.c-product-grid__thumb-wrap,.c-product-grid__thumb{border-radius:0}
/* A squircle is a superellipse, not an arc — corner-shape is the only thing
   that actually draws one. Card only. */
@supports (corner-shape: superellipse(4)){
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
/* The ported theme pins object-fit with !important on .c-product-grid__thumb--contain
   and sizes the frame with a square padding-floor on the wrap; our fit/ratio/media
   settings only take effect if they out-rank that. (Card-effects audit.) */
.card-fit-contain .c-product-grid__thumb{object-fit:contain!important}
.card-fit-cover .c-product-grid__thumb{object-fit:cover!important}
/* Kill the theme's square padding-floor so the aspect-ratio rules above govern
   EVERY ratio — landscape and natural included. 0,3,0 beats the theme's 0,1,0. */
.c-product-grid__item.counter-product .c-product-grid__thumb-wrap{padding-bottom:0}
/* The theme hides the second/hover image with display:none!important unless the
   card opts into tap-to-swap; our cards cross-fade instead, so force it laid out
   (0,4,0 + !important beats the theme's 0,3,0 + !important). It stays opacity:0
   until the media area is hovered, so nothing shows until the swap. */
.c-product-grid__item.counter-product .card-media .c-product-grid__thumb--hover{display:block!important}

.card-shadow-none.card-shell-boxed,.card-shadow-none.card-shell-elevated{box-shadow:none}
.card-shadow-soft.card-shell-elevated{box-shadow:0 2px 4px rgba(0,0,0,.04),0 12px 28px rgba(0,0,0,.07)}
.card-shadow-strong.card-shell-elevated{box-shadow:0 4px 8px rgba(0,0,0,.07),0 20px 44px rgba(0,0,0,.13)}
.card-shadow-strong.card-shell-boxed{box-shadow:0 8px 24px rgba(0,0,0,.09)}

/* ── THE PORTED THEME HOVERS THE WHOLE CARD. UNDO THAT. ────────────────────
   The theme's own stylesheet carries:
       .c-product-grid__item:hover .c-product-grid__thumb--base{opacity:0}
       .c-product-grid__item:hover .c-product-grid__thumb--hover{opacity:1;...}
       .c-product-grid__item:hover .c-product-grid__thumb-wrap{background:...}
       .c-product-grid__item:hover:after{border-color:...}
   so the base photo faded to nothing whenever the pointer was anywhere on the
   tile. MEASURED with the pointer resting on the swatch row: card:hover=true,
   media:hover=false, base image opacity=0. Clicking a colour did swap the
   picture — into an element that had been faded out, which is precisely the
   "stuck on the hover state" this fixes.
   Scoped away from our own rules because the theme sheet loads AFTER this one:
   .counter-product is on every card we render, so adding it outranks the
   theme's selector (0,4,0 vs 0,3,0) whatever the order ends up being. */
.c-product-grid__item.counter-product:hover .c-product-grid__thumb--base{opacity:1}
.c-product-grid__item.counter-product:hover .c-product-grid__thumb--hover{opacity:0;transform:none}
.c-product-grid__item.counter-product:hover .c-product-grid__thumb-wrap{background-color:transparent}
.c-product-grid__item.counter-product:hover:after{border-color:transparent}
.c-product-grid__item.counter-product:hover .c-product-grid__thumb-button-list,
.c-product-grid__item.counter-product:hover .c-product-grid__atc-block,
.c-product-grid__item.counter-product:hover .c-product-grid__atc{opacity:0;visibility:hidden}

/* Now put every one of them back, keyed on the PICTURE.
   The base only fades when there is actually a second image to reveal — the
   theme assumes one always exists, and on a gallery or single-still card that
   assumption empties the frame. */
.c-product-grid__item.counter-product .card-media:has(.c-product-grid__thumb--hover):hover .c-product-grid__thumb--base{opacity:0}
.c-product-grid__item.counter-product .card-media:hover .c-product-grid__thumb--hover{opacity:1;transform:scale(1.05,1.05)}
.c-product-grid__item.counter-product .card-media:hover .c-product-grid__thumb-wrap{background-color:var(--image-background-color)}
.c-product-grid__item.counter-product .card-media:hover .c-product-grid__thumb-button-list,
.c-product-grid__item.counter-product .card-media:hover .c-product-grid__atc-block,
.c-product-grid__item.counter-product .card-media:hover .c-product-grid__atc{opacity:1;visibility:visible}
/* A chosen colour still outranks the preview, hover or not. */
.c-product-grid__item.counter-product .card-media.card-media--picked:hover .c-product-grid__thumb--base{opacity:1}
.c-product-grid__item.counter-product .card-media.card-media--picked:hover .c-product-grid__thumb--hover{opacity:0}

/* HOVER BELONGS TO THE IMAGE, NOT THE CARD.
   Every hover effect is triggered by the pointer being over .card-media — the
   thumbnail — and nothing responds to the pointer merely being on the tile.
   Reaching down to the swatches, the price or the buttons used to hold the
   whole card in its hover state, which is what made picking a colour feel
   stuck. The lift still moves the whole card; it is just the PICTURE that
   decides when. */
.card-hover-lift,.card-hover-both{transition:transform .28s cubic-bezier(.2,.7,.3,1),box-shadow .28s ease}
.card-hover-lift:has(.card-media:hover),
.card-hover-both:has(.card-media:hover){transform:translateY(-5px)}
.card-hover-zoom .c-product-grid__thumb,.card-hover-both .c-product-grid__thumb{
  transition:transform .5s cubic-bezier(.2,.7,.3,1)}
.card-hover-zoom .card-media:hover .c-product-grid__thumb,
.card-hover-both .card-media:hover .c-product-grid__thumb{transform:scale(1.05)}
@media(prefers-reduced-motion:reduce){
  .card-hover-lift,.card-hover-both,.card-hover-zoom .c-product-grid__thumb{transition:none}
  .card-hover-lift:has(.card-media:hover),.card-hover-both:has(.card-media:hover){transform:none}
  .card-hover-zoom .card-media:hover .c-product-grid__thumb,
  .card-hover-both .card-media:hover .c-product-grid__thumb{transform:none}
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
/* HOVER IS THE PICTURE'S, NOT THE WHOLE CARD'S.
   card-media-fade / -motion sit on the card ROOT, so :hover on them fired
   anywhere on the tile — including the swatch row. Reaching down to pick a
   colour therefore held the card in its hover state the entire time, and the
   secondary image stayed up while you clicked. Scoped to .card-media (the
   thumb wrapper), the preview belongs to the image area alone and releases
   the moment the pointer moves down to the controls. */
.card-media-fade .card-media:hover .c-product-grid__thumb--hover,
.card-media-motion .card-media:hover .c-product-grid__thumb--hover{opacity:1}
/* A picked colour outranks the hover preview. Doubled class (0,3,0) so it
   beats the :hover rules above (0,2,0) whatever order they end up in. */
.card-media.card-media--picked .c-product-grid__thumb--hover{opacity:0}
.card-media.card-media--picked .card-video{opacity:0}
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
.card-media:hover .card-nav{opacity:1}
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
.card-title-row .c-product-grid__price-wrap{flex:0 0 auto;font-size:14.5px;font-weight:600}
.card-was{margin-left:8px;color:var(--text-color-light,#999);font-weight:400;font-size:12px}
.card-member{display:block;font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
  color:var(--text-color-light,#888);margin-top:3px}

/* Category pills — a row at the FOOT of the card (below the actions), one small
   NEUTRAL pill per category with a colour dot. Hidden by default and revealed
   only when the card is hovered or focused (a touch tap fires :hover too), so
   the card stays clean until you engage it. Collapsed to max-height:0 so it
   reserves NO space and never covers anything; it expands on hover. Several
   categories just wrap. The dot's hue comes from the slug (--cat-h), so a
   category is the same colour everywhere. */
.card-cat-pills{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;
  max-height:0;opacity:0;overflow:hidden;margin-top:0;pointer-events:none;
  transition:max-height .25s ease,opacity .18s ease,margin-top .25s ease}
.c-product-grid__item:hover .card-cat-pills,
.c-product-grid__item:focus-within .card-cat-pills{max-height:64px;opacity:1;margin-top:10px;pointer-events:auto}
/* ── UNIFIED PILL ────────────────────────────────────────────────────────
   One component, FOUR style variants — ghost / soft / outline / solid — used
   for card category pills AND the shop filter chips, so a pill is the same pill
   everywhere. Filters add a small ·×· to clear; card categories are text only. */
.th-pill{display:inline-flex;align-items:center;gap:7px;padding:5px 12px;border-radius:999px;
  font-size:11.5px;font-weight:600;letter-spacing:.01em;line-height:1;text-decoration:none;white-space:nowrap;
  border:1px solid transparent;background:transparent;color:var(--tx,#2b2b2b);cursor:pointer;
  transition:background .15s ease,border-color .15s ease,color .15s ease,filter .15s ease}
.th-pill--sm{padding:4px 11px;font-size:10.5px}
.th-pill--ghost{background:transparent;border-color:transparent}
.th-pill--soft{background:var(--th-pill-soft,#ececec);border-color:transparent}
.th-pill--outline{background:var(--sf,#fff);border-color:var(--th-pill-line,#d6d6d6)}
.th-pill--solid{background:var(--th-pill-solid,#111);color:#fff;border-color:transparent}
.th-pill--ghost:hover{background:var(--th-pill-soft,#ececec)}
.th-pill--soft:hover{background:var(--th-pill-soft-h,#e2e2e2)}
.th-pill--outline:hover{border-color:var(--tx,#333)}
.th-pill--solid:hover{filter:brightness(.96)}
.th-pill__x{opacity:.5;font-size:14px;line-height:1;margin-left:1px;transition:opacity .15s ease}
.th-pill:hover .th-pill__x{opacity:.9}
.th-pill--solid .th-pill__x{opacity:.85;color:#fff}
/* Card category pill — the shop filter chip's outline pill, but JUST the
   category name: no "Category" label, no ×, no dot. They sit next to each other
   and only wrap if the row genuinely runs out of width. */
.card-cat-pill{max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-size:10.5px;font-weight:600}

/* Hover picker — colour / size / qty. MORPH reveal: it precipitates in (blur +
   a hair of scale), not a slide. Collapsed to max-height:0 so it reserves no
   space; expands on hover or keyboard focus. */
/* Picker lives in the DETAILS, under the title — never on the image. Revealed
   on hover with a MORPH (blur + fade + a hair of rise); colours/sizes scroll
   sideways so it stays a tidy 3 lines instead of wrapping into a tall stack. */
.card-picker-reveal{display:flex;flex-direction:column;gap:10px;max-height:0;opacity:0;overflow:hidden;
  filter:blur(6px);transform:translateY(6px);margin:0;
  transition:max-height .34s cubic-bezier(.2,.7,.2,1),opacity .3s ease,filter .34s ease,transform .34s cubic-bezier(.2,.7,.2,1),margin .34s ease}
.c-product-grid__item:hover .card-picker-reveal,
.c-product-grid__item:focus-within .card-picker-reveal,
.c-product-grid__item.is-checking-out .card-picker-reveal{max-height:220px;opacity:1;filter:blur(0);transform:none;margin:6px 0 2px}
.card-pk-line{display:flex;align-items:center;gap:10px;min-height:26px}
.card-pk-stock{font:600 11px/1.2 var(--f,inherit);letter-spacing:.02em;color:#c0392b;text-transform:uppercase;min-height:13px}
.card-pk-label{font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--tx3,#9a9a9a);min-width:42px;flex:0 0 auto}
.card-pk-line .card-swatches{margin:0}
.card-pk-opts{display:flex;flex-wrap:wrap;gap:6px}
.card-pk-opt{min-width:30px;height:26px;padding:0 8px;border:1px solid var(--th-pill-line,#d6d6d6);border-radius:7px;
  background:var(--sf,#fff);font-size:11px;font-weight:600;cursor:pointer;color:var(--tx,#111);
  transition:border-color .15s ease,background .15s ease,color .15s ease}
.card-pk-opt:hover{border-color:var(--tx,#111)}
.card-pk-opt.on{background:var(--tx,#111);color:#fff;border-color:var(--tx,#111)}
.card-pk-opt:disabled{opacity:.32;cursor:not-allowed}
.card-pk-qty{display:inline-flex;align-items:center;gap:9px}
.card-pk-qbtn{width:24px;height:24px;border:1px solid var(--th-pill-line,#d6d6d6);border-radius:6px;background:var(--sf,#fff);
  font-size:15px;line-height:1;cursor:pointer;color:var(--tx,#111);display:inline-flex;align-items:center;justify-content:center}
.card-pk-qbtn:hover{border-color:var(--tx,#111)}
.card-pk-qn{min-width:16px;text-align:center;font-size:12px;font-weight:700;font-variant-numeric:tabular-nums}
/* Qty full-width — the stepper spreads − · n · + across the row. */
.card-pk-line--qty .card-pk-qty{flex:1;justify-content:space-between}
/* Color full-width + sideways scroll when the colourway count overflows, so it
   never wraps into a tall stack. */
/* overflow-x:auto forces overflow-y to clip too, which sliced the selected
   swatch's outer ring (box-shadow 0 0 0 3.5px) top and bottom. The padding is
   the clip region's breathing room — 4px above for the ring, a little each side
   so the first/last ring is whole, 6px below to seat the thin scrollbar just
   under the row without overlaying it. */
.card-pk-scroll{flex:1;min-width:0;overflow-x:auto;display:flex;flex-wrap:nowrap;padding:4px 3px 6px;
  scrollbar-width:thin;scrollbar-color:rgba(0,0,0,.28) transparent}
/* A thin, always-there track that sits RIGHT UNDER the row (not overlaid on the
   swatches/sizes). Webkit needs the explicit height + thumb to stop using the
   auto-hiding overlay bar. */
.card-pk-scroll::-webkit-scrollbar{height:4px}
.card-pk-scroll::-webkit-scrollbar-track{background:transparent}
.card-pk-scroll::-webkit-scrollbar-thumb{background:rgba(0,0,0,.26);border-radius:99px}
.card-pk-scroll .card-swatches{flex-wrap:nowrap;margin:0}
.card-pk-scroll .card-pk-opt,.card-pk-scroll .card-swatch{flex:0 0 auto}
/* CRITICAL: without min-width:0 the picker's un-wrapped scroll rows set the
   card's min-content, which a minmax(min-content,1fr) grid honours by widening
   that one column — blowing the tile up to ~2× while its square image follows.
   min-width:0 lets the rows shrink+scroll so the tile stays its 1fr share. */
.c-product-grid__item.counter-product,.card-picker-reveal,.card-pk-line,.card-pk-scroll,.card-pk-opts{min-width:0}
/* ── COLOUR SWATCHES ────────────────────────────────────────────────────
   Bigger and cleaner. 18px with a 2px inset white ring left about 12px of
   actual colour — too small to judge a colourway by and a poor tap target.
   24px of solid paint instead, and the selected state is a RING SET OFF the
   swatch rather than an inset that eats into the colour.
   The hairline border is there only so a white or cream colourway still reads
   as a disc; it is near-invisible on anything darker. */
.card-swatches{display:flex;gap:9px;align-items:center;flex-wrap:wrap}
/* NO BORDER. background-origin defaults to padding-box, so a two-tone
   gradient started INSIDE the border and left a 1px band of border colour
   showing over the page — which is the "outline" these had. A soft drop
   shadow gives a white or cream colourway its edge without drawing a ring
   around every disc. */
.card-swatch{width:24px;height:24px;border-radius:50%;display:inline-block;border:0;
  background-origin:border-box;background-clip:border-box;
  box-shadow:0 1px 3px rgba(0,0,0,.16),0 0 0 .5px rgba(0,0,0,.06)}
.card-swatch--named,.card-swatch--more{width:auto;height:auto;border-radius:999px;padding:5px 9px;font-size:10px;
  font-weight:600;text-transform:uppercase;box-shadow:none;color:var(--text-color-light,#888)}
.card-swatch--btn{padding:0;cursor:pointer;-webkit-appearance:none;appearance:none;
  transition:transform .14s ease,box-shadow .14s ease}
.card-swatch--btn:hover{transform:scale(1.08);box-shadow:0 2px 6px rgba(0,0,0,.16)}
/* Ring OUTSIDE, with a gap. The colour stays whole and the selection reads
   from across the grid. */
.card-swatch--btn.on{box-shadow:0 0 0 2px var(--sf,#fff),0 0 0 3.5px var(--text-color,#111)}
.card-swatch--btn:focus-visible{outline:2px solid var(--text-color,#111);outline-offset:3px}

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
/* Share sits under the heart in the theme's own button column. The theme
   draws its icons from an icon font that has no share glyph, so this one is a
   real SVG and only needs sizing to match its neighbour. */
.c-product-grid__icon--share{width:16px;height:16px;display:block;
  fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.c-product-grid__thumb-button--share.is-shared{opacity:1}
.c-product-grid__thumb-button--share.is-shared .c-product-grid__icon-text{opacity:1}
.card-icon__heart:before{content:'\\2661';font-size:17px;line-height:1}
.card-icon[aria-pressed="true"] .card-icon__heart:before{content:'\\2665'}
/* ── 'evolve': the card becomes its own picker ──────────────────────────
   Both faces occupy the same block, so the card does not change height when
   it flips — a grid that reflows under the shopper's cursor is worse than
   any picker. */
.card-evolve{position:relative}
/* Quick checkout's pay step. Sits in the card, so it must stay compact —
   anything taller than the card turns the grid into a jumping mess. */
/* THE HIDDEN ATTRIBUTE MUST WIN.
   Every block below sets display:flex on a class, and a class beats the UA's
   [hidden]{display:none} on specificity — so the hidden attribute did nothing
   and all four steps rendered at once, thank-you screen included, before
   anyone had bought anything. Any element carrying the attribute inside the
   pay face is hidden, whatever else claims otherwise.
   NOTE: no backticks in this comment. The whole block is a template literal,
   and a stray one ends the string — that is what took the site down here. */
.card-pay [hidden]{display:none!important}
.card-pay{display:flex;flex-direction:column;gap:6px;position:relative;padding-top:4px}
.card-pay__sum{font-size:12px;font-weight:600}
.card-pay__row{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.card-pay__in{width:100%;box-sizing:border-box;padding:8px 10px;font:inherit;font-size:12px;
  border:1px solid var(--ln,#e5e7eb);border-radius:8px}
.card-pay__in:focus{outline:none;border-color:var(--tx,#111)}
/* Base wallet button. The stacked-column wrapper it used to sit in is gone —
   the row is .card-pay__icons now — so only the button itself remains. */
.card-pay__wallet{display:block;width:100%;padding:12px;border:0;border-radius:var(--radius-pill,999px);background:#000;color:#fff;font:600 13px var(--f,inherit);cursor:pointer}
.card-pay__qr{display:flex;flex-direction:column;align-items:center;gap:9px;padding:12px 0 4px}
.card-pay__qr-code img{display:block;width:180px;height:180px;border-radius:10px;background:#fff}
.card-pay__qr-cap{margin:0;font-size:12px;line-height:1.45;color:var(--tx-soft,#666);text-align:center;max-width:230px}
.card-pay__qr-back{border:0;background:none;color:var(--tx,#111);font:600 12px var(--f,inherit);text-decoration:underline;cursor:pointer;padding:2px}
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
/* Sign in sits above the fields it would fill, and reads as a shortcut rather
   than a competing action — no fill, no border. */
.card-pay__signin{border:0;background:none;padding:0 0 2px;font:inherit;font-size:12px;
  text-decoration:underline;text-underline-offset:3px;color:var(--tx2,#374151);cursor:pointer;align-self:flex-start}
.card-pay__signin:hover{color:var(--tx,#111)}
.card-pay__signin:disabled{text-decoration:none;color:var(--tx3,#6b7280);cursor:default}
.card-pay__signin-box{display:flex;flex-direction:column;gap:8px}
/* ── WAYS IN: small icons, one big button ─────────────────────────────────
   The wallets are a ROW, not a stack. Stacked full-width buttons made three
   one-tap sheets look like three separate decisions of equal weight, which is
   what pushed the actual form off the bottom of the card. */
.card-pay__icons{display:flex;gap:8px;align-items:stretch}
/* CIRCLES. The brand mark identifies the button faster than its name does,
   and four names across a card this narrow truncate to nonsense. The full
   name still lives in title and aria-label, so the tooltip and the screen
   reader both say "Apple Pay".
   colour is restated because the base .card-pay__wallet rule is a black pill
   with white text; overriding only the background left white on white. */
/* The row fills the card. Each disc takes an equal share of the width rather
   than a fixed 42px, so the marks are big enough to read at a glance instead
   of huddling in the middle of empty space. aspect-ratio keeps them circular
   at whatever width that share works out to, and max-width stops four of them
   becoming absurd on a wide desktop card. */
.card-pay__icons{justify-content:center;gap:10px;padding:2px 4px}
.card-pay__icons .card-pay__wallet{color:var(--tx,#111);flex:1 1 0;
  width:auto;height:auto;aspect-ratio:1/1;max-width:82px;padding:0;border-radius:50%;
  display:flex;align-items:center;justify-content:center;
  border:1px solid var(--bd,#e5e7eb);background:var(--sf,#fff);cursor:pointer;
  transition:border-color .18s ease,transform .18s ease,box-shadow .18s ease}
.card-pay__icons .card-pay__wallet:hover{border-color:var(--tx,#111);transform:translateY(-1px);
  box-shadow:0 2px 8px rgba(0,0,0,.10)}
/* The mark scales WITH the disc rather than staying at its authored 17px,
   so growing the buttons actually grows the logos. */
.card-pay__icons .card-pay__wallet svg{display:block;width:52%;height:52%}
.card-pay__wallet-txt{font-size:10px;font-weight:600}
/* Expanded to one: it stops being an icon and becomes the action, so it takes
   the full width and says the name out loud. */
.card-pay[data-way="wallets"] .card-pay__icons .card-pay__wallet{
  width:100%;max-width:none;height:48px;aspect-ratio:auto;border-radius:10px;gap:8px;
  background:var(--tx,#111);color:var(--sf,#fff);border-color:var(--tx,#111)}
/* Back to a fixed mark size once it is a full-width button — 52% of a
   full-width bar would be an enormous logo. */
.card-pay[data-way="wallets"] .card-pay__icons .card-pay__wallet svg{width:20px;height:20px}
.card-pay[data-way="wallets"] .card-pay__icons .card-pay__wallet::after{
  content:attr(title);font-size:13px;font-weight:600}
/* Solo wallet: when hiding the unavailable ones left exactly one (commonly just
   PayPal on a browser with no Apple/Google/Link), it must not balloon into a
   giant floating disc. Give it the same full-width, named treatment as a picked
   wallet, so one option reads as one deliberate action. */
.card-pay__icons.is-solo{padding:2px 0}
.card-pay__icons.is-solo .card-pay__wallet:not([hidden]){
  width:100%;max-width:none;aspect-ratio:auto;height:48px;border-radius:10px;gap:8px;
  background:var(--tx,#111);color:var(--sf,#fff);border-color:var(--tx,#111)}
.card-pay__icons.is-solo .card-pay__wallet:not([hidden]) svg{width:20px;height:20px}
.card-pay__icons.is-solo .card-pay__wallet:not([hidden])::after{
  content:attr(title);font-size:13px;font-weight:600}
@media(prefers-reduced-motion:reduce){
  .card-pay__icons .card-pay__wallet{transition:none}
  .card-pay__icons .card-pay__wallet:hover{transform:none}
}
/* Sign in: centred under the row, because it is a peer of the options above
   rather than the first field of the form below. */
.card-pay__signin{align-self:center}
/* The details button. Primary when nothing else is on offer. */
.card-pay__details-btn{width:100%;height:46px;border:1px dashed var(--bd2,#d1d5db);border-radius:8px;
  background:none;font:inherit;font-size:13px;font-weight:600;color:var(--tx2,#374151);
  cursor:pointer;transition:border-color .18s ease,color .18s ease,background .18s ease}
.card-pay__details-btn:hover{border-color:var(--tx,#111);color:var(--tx,#111)}
.card-pay__details-btn.is-primary{border-style:solid;background:var(--tx,#111);color:var(--sf,#fff);border-color:var(--tx,#111)}
/* ── THE RECEIPT ──────────────────────────────────────────────────────────
   Below the perforation the order is assembled line by line. One dotted rule
   and tabular figures are enough to say "receipt"; torn edges and a
   typewriter face would tip it into costume, which is the wrong note to
   strike at the moment someone is deciding to trust you with a card. */
/* The order line: what, how many, how much. */
.card-pay__line{display:flex;align-items:center;justify-content:space-between;gap:10px}
.card-pay__line .card-pay__sum{flex:1 1 auto;min-width:0}
.card-pay__qty{display:flex;align-items:center;gap:2px;flex:0 0 auto;
  border:1px solid var(--bd,#e5e7eb);border-radius:7px;overflow:hidden}
.card-pay__qty-btn{width:26px;height:26px;border:0;background:none;font:inherit;font-size:14px;line-height:1;
  cursor:pointer;color:var(--tx,#111)}
.card-pay__qty-btn:hover:not(:disabled){background:var(--bg2,#f3f4f6)}
.card-pay__qty-btn:disabled{opacity:.3;cursor:default}
.card-pay__qty-n{min-width:20px;text-align:center;font-size:12px;font-weight:600;font-variant-numeric:tabular-nums}
/* Edit selection: quiet, but explicit. The back chevron gives no clue it
   eventually reaches the picker. */
.card-pay__edit{align-self:flex-start;border:0;background:none;padding:0;font:inherit;font-size:11px;
  color:var(--tx3,#6b7280);text-decoration:underline;text-underline-offset:3px;cursor:pointer}
.card-pay__edit:hover{color:var(--tx,#111)}
/* ── Accordion sections ───────────────────────────────────────────────────
   A header that reads as a receipt heading, and a summary line that reads as
   the entry underneath it. Collapsed, the section IS its answer — which is
   what keeps the card short without hiding what was typed. */
.card-pay__sec{display:flex;flex-direction:column;gap:8px}
.card-pay__sec-head{display:flex;align-items:baseline;gap:8px;width:100%;
  border:0;background:none;padding:2px 0;font:inherit;text-align:left;cursor:pointer}
.card-pay__sec-title{font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;
  color:var(--tx,#111);flex:0 0 auto}
.card-pay__sec-sum{flex:1 1 auto;min-width:0;font-size:11px;color:var(--tx3,#6b7280);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right}
.card-pay__sec-chev{flex:0 0 auto;width:8px;height:8px;border-right:1.5px solid var(--tx3,#6b7280);
  border-bottom:1.5px solid var(--tx3,#6b7280);transform:rotate(45deg);transition:transform .2s ease;
  position:relative;top:-2px}
.card-pay__sec-head[aria-expanded="true"] .card-pay__sec-chev{transform:rotate(-135deg);top:1px}
/* An open section has no summary to show — the fields are right there. */
.card-pay__sec-head[aria-expanded="true"] .card-pay__sec-sum{display:none}
.card-pay__sec-body{display:flex;flex-direction:column;gap:8px}
@media(prefers-reduced-motion:reduce){.card-pay__sec-chev{transition:none}}
/* Pay, when it cannot yet work, says what is missing instead of looking ready
   and refusing on click. */
.card-pay__sec-body .card-btn--solid:disabled{background:var(--bg2,#f3f4f6);color:var(--tx3,#6b7280);
  border-color:var(--bd,#e5e7eb);cursor:default}
/* Saved cards. Rows, because a card is identified by reading it — brand,
   last four, expiry — not by recognising a shape. */
.card-pay__saved{display:flex;flex-direction:column;gap:6px}
.card-pay__saved-t{font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--tx3,#6b7280)}
.card-pay__saved-card{display:flex;align-items:center;gap:10px;width:100%;padding:10px 12px;
  border:1px solid var(--bd,#e5e7eb);border-radius:8px;background:var(--sf,#fff);
  font:inherit;font-size:13px;cursor:pointer;text-align:left;
  transition:border-color .18s ease,background .18s ease}
.card-pay__saved-card:hover{border-color:var(--tx,#111)}
.card-pay__saved-card.on{border-color:var(--tx,#111);background:var(--bg2,#f3f4f6)}
.card-pay__saved-brand{font-weight:700;font-size:11px;letter-spacing:.04em}
.card-pay__saved-exp{margin-left:auto;font-size:11px;color:var(--tx3,#6b7280);font-variant-numeric:tabular-nums}
/* Consent sits with the field it applies to, quiet enough not to compete
   with Pay. */
.card-pay__savecard{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--tx2,#374151);cursor:pointer}
.card-pay__savecard input{width:15px;height:15px;accent-color:var(--tx,#111);cursor:pointer}
.card-pay__receipt{display:flex;flex-direction:column;gap:8px;padding-top:2px}
.card-pay__perf{height:1px;margin:6px 0 8px;
  background-image:linear-gradient(90deg,var(--bd2,#d1d5db) 0 4px,transparent 4px 9px);
  background-size:9px 1px;background-repeat:repeat-x}
.card-pay__receipt .card-pay__in{font-variant-numeric:tabular-nums}
.card-pay__mklink{font-size:12px;color:var(--tx3,#6b7280);text-decoration:underline;text-underline-offset:3px;align-self:flex-start}
.card-pay__mklink:hover{color:var(--tx,#111)}
/* "or pay a different way" — the way back out of an expanded choice. Quiet,
   because it is an escape hatch rather than an action being encouraged. */
.card-pay__back-to-ways{border:0;background:none;padding:2px 0;font:inherit;font-size:12px;
  color:var(--tx3,#6b7280);text-decoration:underline;text-underline-offset:3px;cursor:pointer;align-self:center}
.card-pay__back-to-ways:hover{color:var(--tx,#111)}
/* Submitting. A determinate-looking spinner would be a lie — we cannot know
   how long a gateway takes — so this is a plain rotation with the state
   spelled out in words underneath. */
.card-pay__sending{align-items:center;text-align:center;gap:12px;padding:22px 4px}
.card-pay__spinner{width:26px;height:26px;border-radius:50%;
  border:2px solid var(--bd,#e5e7eb);border-top-color:var(--tx,#111);animation:card-pay-spin .7s linear infinite}
@keyframes card-pay-spin{to{transform:rotate(360deg)}}
.card-pay__sending-title{font-size:13px;color:var(--tx2,#374151)}
@media(prefers-reduced-motion:reduce){
  .card-pay__spinner{animation-duration:2.4s}
}
.card-pay__done-ref{font-size:11px;color:var(--tx3,#6b7280);font-variant-numeric:tabular-nums}
/* While one card is checking out, the OTHER cards stop being interactive and
   drop back — so a stray tap cannot start a second checkout or navigate away
   mid-purchase. The card in checkout is exempt, and so is the toolbar, which
   sits outside the grid. */
/* FROSTED GLASS. The rest of the grid is still THERE — you can see the shapes
   and colours of what you were browsing, so the card has not become a modal
   floating in nowhere — but it is obstructed enough that there is only one
   thing to read. Blur plus a lift of the live card does the work; a flat
   opacity drop alone left the neighbours legible enough to compete. */
.c-product-grid__list.is-checkout-open .c-product-grid__item:not(.is-checking-out){
  opacity:.3;filter:blur(5px) saturate(.75);pointer-events:none;
  transform:scale(.985);transform-origin:center;
  transition:opacity .32s ease,filter .32s ease,transform .32s ease}
/* THE CARD GROWS. It lifts out of the blurred plane rather than merely being
   the sharp thing among soft ones. */
.c-product-grid__item.is-checking-out{
  position:relative;z-index:5;
  /* OPAQUE. The tile has no background of its own, so the blurred grid
     underneath showed straight through it and the card read as semi
     transparent — exactly the thing the blur was supposed to prevent. */
  background:var(--sf,#fff);
  /* STAYS PUT, GROWS OVER THE GRID.
     No translate, no scale, no scroll lock — centring it in the viewport
     turned the card into a modal, which is not what a card doing its thing
     in place should feel like. It keeps its cell and its size; the checkout
     panel below simply hangs over whatever is underneath. */
  z-index:20;
  transition:box-shadow .28s ease;
  box-shadow:0 8px 20px rgba(0,0,0,.10),0 24px 56px rgba(0,0,0,.14)}
/* Reserve the scrollbar's width ALWAYS. Opening a checkout makes the page
   taller, the scrollbar appears, the viewport loses ~2px, and every square
   product image in the grid reflows a few pixels — measured: neighbouring
   cards moved 2px across and 9px down for nothing anyone did. A stable
   gutter removes the whole class of shift. */
html{scrollbar-gutter:stable}

/* THE PANEL IS OUT OF FLOW. In a grid, an item that grows taller stretches
   its row and shoves every row beneath it down the page — the "weird shit".
   Absolutely positioned, the card's layout height never changes, so the grid
   does not move at all and the panel floats over the tiles below it. */
.c-product-grid__item.is-checking-out{overflow:visible}
/* ANCHORED TO THE CARD, NOT TO THE BUTTON WRAPPER.
   .card-evolve sits inside the details padding — 20px in from each edge — so
   anchoring the panel there rendered it 250px wide inside a 290px card,
   floating with a margin down both sides. It read as a separate box dropped
   on top of the tile instead of the tile continuing.
   Static wrapper, so left:0/right:0 resolve against the card itself and the
   panel is exactly as wide as the card. --pay-top is measured at open time:
   it is where the buttons were, so the panel starts there and everything past
   the card's bottom edge overhangs the tiles below. */
.c-product-grid__item.is-checking-out .card-evolve{position:static}
.c-product-grid__item.is-checking-out .card-pay{
  position:absolute;left:0;right:0;top:var(--pay-top,0);z-index:21;
  background:var(--sf,#fff);padding:16px 20px 20px;
  /* No border and no radius: it IS the card, so a second outline down the
     sides and a rounded lip mid-card would draw a seam where there is none.
     The card's own shadow already wraps both halves. */
  border:0;border-radius:0;
  max-height:min(72vh,620px);overflow-y:auto}
/* Rounded cards keep their bottom corners on whichever element ends up last. */
.c-product-grid__item.is-checking-out .card-pay{border-bottom-left-radius:var(--card-r,0);
  border-bottom-right-radius:var(--card-r,0)}
/* The pay face itself eases open, so the growth reads as the card making room
   rather than the grid jumping. */
.card-pay{transition:opacity .28s ease}
@media(prefers-reduced-motion:reduce){
  .c-product-grid__list.is-checkout-open .c-product-grid__item:not(.is-checking-out){
    transition:none;transform:none}
  .c-product-grid__item.is-checking-out{transition:none;transform:none}
  .card-pay{transition:none}
}
/* A scaled-up card on a phone would spill past the viewport edges, and the
   neighbours are already off-screen there, so the lift is desktop-only. */
@media(max-width:767px){
  .c-product-grid__item.is-checking-out{transform:none;box-shadow:0 6px 24px rgba(0,0,0,.14)}
}
/* The success face. Centred and quiet — the order number is the one thing
   worth reading, so nothing competes with it. */
.card-pay__done{display:flex;flex-direction:column;align-items:center;text-align:center;gap:9px;padding:16px 4px 6px}
.card-pay__tick{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  background:var(--tx,#111);color:var(--sf,#fff);font-size:20px;line-height:1}
.card-pay__done-title{font-size:15px;font-weight:600}
.card-pay__done-sub{font-size:12px;color:var(--tx3,#6b7280);line-height:1.45}
/* The order review — a receipt row: thumb, what it is, quantity + total. */
.card-pay__done-summary{display:flex;align-items:center;gap:12px;width:100%;text-align:left;
  padding:12px;margin-top:4px;border:1px solid var(--bd2,rgba(0,0,0,.12));border-radius:12px;
  background:var(--bg2,rgba(0,0,0,.02))}
.card-pay__done-thumb{width:46px;height:46px;flex:0 0 auto;object-fit:cover;border-radius:8px;background:var(--bg2,#eee)}
.card-pay__done-lines{flex:1 1 auto;min-width:0}
.card-pay__done-name{font-size:13px;font-weight:700;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.card-pay__done-meta{font-size:12px;color:var(--tx3,#6b7280);margin-top:2px}
.card-pay__done .card-btn{margin-top:4px;width:100%}
.card-pay__done-link{text-decoration:none;text-align:center}
@media(prefers-reduced-motion:no-preference){
  .card-pay__tick{animation:card-pay-tick .32s cubic-bezier(.2,.8,.3,1)}
  @keyframes card-pay-tick{from{transform:scale(.6);opacity:0}to{transform:scale(1);opacity:1}}
}
.card-pay__msg.is-bad{color:#b3261e}
.card-picker{display:flex;flex-direction:column;gap:8px}
/* An explicit display beats the hidden ATTRIBUTE's UA display:none, so the
   picker rendered at rest — its Confirm button sitting under the two CTAs on
   every card. Anything given a display value has to opt back out of hidden. */
.card-picker[hidden],[data-evolve-face][hidden]{display:none}
.card-picker__back{position:absolute;top:-30px;left:0;border:0;background:none;font-size:20px;line-height:1;
  cursor:pointer;color:var(--text-color-light,#888);padding:0}
/* TOP-RIGHT OF THE CARD, where a close control is expected — and only while
   the card is actually in checkout. On the panel's own rail it sat level with
   the colour swatches and read as closing those.
   A filled disc rather than a bare glyph: it lands on top of product
   photography, where a plain × disappears against a light image. */
.card-pay__close{position:absolute;top:10px;right:10px;z-index:6;
  width:30px;height:30px;display:none;align-items:center;justify-content:center;
  border:0;border-radius:50%;background:rgba(255,255,255,.92);color:#111;
  font-size:19px;line-height:1;cursor:pointer;padding:0;
  box-shadow:0 1px 6px rgba(0,0,0,.18);transition:background .18s ease,transform .18s ease}
.c-product-grid__item.is-checking-out .card-pay__close{display:flex}
.card-pay__close:hover{background:#fff;transform:scale(1.06)}
@media(prefers-reduced-motion:reduce){.card-pay__close{transition:none}
  .card-pay__close:hover{transform:none}}
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

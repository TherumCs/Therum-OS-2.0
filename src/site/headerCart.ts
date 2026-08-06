// The header icons — search, account, wishlist, cart — made to actually do
// something.
//
// All four were rendered by the ported chrome and all four were dead: the
// behaviour lived in the source theme's jQuery bundle, which we do not ship.
// What the ported markup DOES give us is the theme's full hook and class
// contract, already styled by the ported stylesheet:
//
//   .js-search-button                       the magnifier
//   .js-cart / .js-cart-sidebar-open        the bag
//   .js-cart-info                           the count badge slot (empty)
//   .js-cart-sidebar                        a full-height drawer, pre-built
//     .js-cart-sidebar-wrap                   the sliding panel
//     .widget_shopping_cart_content           where the cart goes
//   .js-cart-sidebar-shadow                 the scrim
//   .js-wishlist-info                       the wishlist count slot
//
// So this binds to what is already there rather than injecting a parallel set
// of components — the drawer animates, the badge sits, and the type matches
// the rest of the site because the theme's own CSS is doing the work.
//
// TWO CART PRESENTATIONS (Settings > Counter > cartStyle), both native to the
// theme:
//
//   'mini'     .c-header__cart--default — a panel under the bag.
//   'sidebar'  .c-header__cart--sidebar — a full-height drawer.
//
// and the sidebar arrives one of two ways (cartSidebarReveal):
//
//   'overlay'  it slides OVER the page. The source theme's own behaviour.
//   'push'     the PAGE slides aside and the drawer is revealed from under it,
//              so nothing is covered — the admin dashboard's dual-pane move.
//
// The push translates the page's three top-level regions by exactly the
// drawer's measured width. The drawer is position:fixed and lives OUTSIDE
// those regions, because a transformed ancestor becomes the containing block
// for fixed positioning — the same trap that broke the sticky header once.

export const HEADER_CART_CSS = `
/* THE PAGE-SHIFT — the Arc move: the whole page slides sideways and the cart
   is uncovered in the gutter it leaves behind.
   ONE shell is transformed, not three separate regions. Transforming
   #brx-header / #brx-content / #brx-footer individually never applied at all:
   the selector matched, the class was on, the media query did not fire, the
   variable resolved — and the computed transform stayed identity. One wrapper
   with one transform has none of that surface area, and does not depend on
   those three ids existing on every page. */
#th-shell{position:relative;z-index:2;min-height:100vh;background:var(--background-color,#fff);
  transition:transform .42s cubic-bezier(.32,.72,0,1),border-radius .42s ease,box-shadow .42s ease}
/* The distance is written INLINE by the runtime, because only the runtime knows
   how wide the drawer actually is. Everything else about the move lives here.
   The mobile opt-out lives in the runtime too, for the same reason: an inline
   transform cannot be cancelled by a media query. */

/* The page slides off a DARK ground, so the move reads as the cart being
   uncovered from underneath rather than a white panel sliding on top — Arc's
   sidebar, where the web view shifts and rounds and the app's own background
   is what you see behind it. */
/* The ground is a REAL painted layer, not a background on html or body.
   Background propagation from body to the canvas only happens while html has
   no background of its own — a condition of the ported theme, not something
   this feature should depend on. A fixed pseudo-element behind the shell paints
   the same colour under any theme. */
body.th-cart-open{overflow-x:hidden}
body.th-cart-open::before{content:'';position:fixed;inset:0;z-index:0;
  background:var(--th-cart-ground,#0a0a0a);pointer-events:none}
/* THE PAGE IS ON TOP. The cart is BEHIND it and is uncovered as the page moves
   off — not a drawer that arrives over the page. The theme parks the sidebar at
   z-index 1400 because in its own design it overlays; in push mode that is
   exactly the wrong order, and it is what made this read as an overlay.
   The theme's scrim goes with it: dimming the page is an overlay's job. */
body.th-cart-open .c-shop-sidebar{z-index:1}
body.th-cart-open .c-shop-sidebar__shadow{display:none}
/* Rounded corners, and a shadow thrown off the page's trailing edge ONTO the
   cart, so the cart reads as sitting underneath. */
body.th-cart-open #th-shell{border-radius:14px;
  box-shadow:0 0 0 1px rgba(0,0,0,.10),24px 0 60px rgba(0,0,0,.55)}

/* Mini cart. The theme ships a bare .widget_shopping_cart_content{display:none}
   that outranks its own .c-header__cart--default dropdown rule (which sets
   position and width but never display) — so the panel measured 0x0 no matter
   what opacity said. The source theme's jQuery presumably set display itself;
   we do it here, on the open state, and keep the theme's geometry.
   The !important on opacity matches the theme's own — its base rule declares
   opacity:0!important and only :hover overrides it, so a plain 1 loses. */
.c-header__cart .widget_shopping_cart_content.th-open{display:block;opacity:1!important;visibility:visible}

/* Count badges. The theme styles .c-header__cart-count but the ported markup
   ships the slots empty and unclassed; the runtime adds the class, this hides
   the slot until there is a number to show. */
.js-cart-info:empty,.js-wishlist-info:empty{display:none}

/* Cart lines, in the theme's own widget contract. Only the few properties the
   theme leaves to WooCommerce's stylesheet are set here. */
.c-product-list-widget__item{padding:14px 0;border-bottom:solid 1px var(--border-color-light,rgba(0,0,0,.08));list-style:none}
.c-product-list-widget__item:last-child{border-bottom:0}
.c-product-list-widget__remove{background:none;border:0;cursor:pointer;padding:0}
.c-product-list-widget__qty{display:inline-flex;align-items:center;gap:8px;margin-top:8px}
.c-product-list-widget__qty button{width:22px;height:22px;line-height:1;border:solid 1px var(--border-color-light,rgba(0,0,0,.15));
  background:none;cursor:pointer;font-size:13px;border-radius:2px}
.c-product-list-widget__qty button[disabled]{opacity:.35;cursor:default}
.c-product-list-widget__qty span{font-size:12px;min-width:14px;text-align:center;font-variant-numeric:tabular-nums}
.c-product-list-widget__buttons .button{text-align:center;text-decoration:none;padding:13px 16px;font-size:12px;
  font-weight:600;letter-spacing:.06em;text-transform:uppercase;border:solid 1px currentColor}
/* In this theme --button-color is the button's FILL, not its text. The colour
   needs !important because a theme rule further down paints every .button with
   --button-color as its FOREGROUND too — which on the filled variant is the
   same value as its background, i.e. a black-on-black Checkout button. */
.widget_shopping_cart_content .c-product-list-widget__buttons .button.checkout{
  background-color:var(--button-color,#111);color:var(--white-color,#fff)!important;border-color:var(--button-color,#111)}
.th-cart-busy{opacity:.5;pointer-events:none}

/* PUSH MODE ONLY — the cart on the ground, not on a panel.
   With the page shifted the drawer is standing in the gutter the page left
   behind, so a white drawer just reads as a second page: the dark ground is
   never seen and the effect Bam described ("under the page ... all black
   background") does not land. Here the drawer gives up its own background and
   inverts, so what you are looking at IS the ground.
   Scoped to body.th-cart-open, so overlay mode keeps the light panel it was
   designed for. */
/* The white is on the WRAP, not on .c-shop-sidebar — that one is the fixed
   positioning frame and has no background of its own. */
body.th-cart-open .c-shop-sidebar,
body.th-cart-open .c-shop-sidebar__wrap{background:transparent;box-shadow:none}
body.th-cart-open .c-shop-sidebar,
body.th-cart-open .c-shop-sidebar *{color:var(--th-cart-ink,#fff)}
body.th-cart-open .c-shop-sidebar a{color:inherit}
body.th-cart-open .c-product-list-widget__item{border-bottom-color:var(--th-cart-line,rgba(255,255,255,.14))}
body.th-cart-open .c-product-list-widget__qty button{border-color:var(--th-cart-line,rgba(255,255,255,.3));color:inherit}
/* Both buttons need !important, because the theme paints every .button's
   foreground with --button-color and declares it !important — which on the
   ground is dark type on a dark field, i.e. an invisible View cart button. */
body.th-cart-open .widget_shopping_cart_content .c-product-list-widget__buttons .button{
  color:var(--th-cart-ink,#fff)!important;border-color:var(--th-cart-ink,#fff)}
/* The filled Checkout button flips to a light fill on the ground. */
body.th-cart-open .widget_shopping_cart_content .c-product-list-widget__buttons .button.checkout{
  background-color:var(--th-cart-ink,#fff);color:var(--th-cart-ground,#0a0a0a)!important;border-color:var(--th-cart-ink,#fff)}

/* Search takeover. The ported header has a magnifier but no search UI behind
   it — the source theme renders that panel from PHP we do not have. */
.th-search{position:fixed;inset:0;z-index:1500;background:var(--background-color,#fff);
  display:flex;flex-direction:column;opacity:0;visibility:hidden;transition:opacity .2s ease}
.th-search.on{opacity:1;visibility:visible}
.th-search__bar{display:flex;align-items:center;gap:18px;padding:26px 30px;border-bottom:solid 1px var(--border-color-light,rgba(0,0,0,.08))}
/* border:0 is not enough — the ported theme styles every input with a border
   and a background, and its selector outranks a bare element rule here, so the
   field rendered as a boxed control sitting inside the panel. Doubling the
   class raises specificity above it without !important.
   appearance:none removes WebKit's own search decoration: type="search" draws
   its own clear button, which put a SECOND x next to the panel's close. */
.th-search .th-search__bar input[type="search"]{flex:1;min-width:0;border:0;outline:0;
  background:none;box-shadow:none;border-radius:0;padding:0;height:auto;
  font:inherit;font-size:28px;letter-spacing:-.01em;
  appearance:none;-webkit-appearance:none}
.th-search__bar input::-webkit-search-cancel-button,
.th-search__bar input::-webkit-search-decoration,
.th-search__bar input::-webkit-search-results-button{-webkit-appearance:none;appearance:none;display:none}
.th-search__bar input::-ms-clear{display:none}
/* The magnifier that leads the field, as in the reference. Sized off the
   input's own font so it keeps proportion when the field grows in immersive. */
.th-search__icon{flex:0 0 auto;width:1em;height:1em;font-size:inherit;opacity:.45;
  stroke:currentColor;fill:none;stroke-width:2;pointer-events:none}
.th-search__bar form{display:flex;align-items:center;gap:.5em;flex:1;min-width:0}
.th-search__close{border:0;background:none;font-size:26px;line-height:1;cursor:pointer;color:inherit}
.th-search__body{flex:1;overflow:auto;padding:24px 30px 60px}
.th-search__hint{font-size:13px;letter-spacing:.04em;color:var(--text-color-light,#888)}
/* Results get their own layout rather than borrowing .c-product-grid — that
   contract expects the full card structure and collapses without it.

   TWO PER ROW, asked for directly: "right now lets use a 2x2 grid for search
   results". Fixed at 2 columns rather than auto-fill, because auto-fill widens
   to 4 across on a large screen and the 2x2 is the point. Cards, not rows —
   a 2-up layout with a 56px thumbnail reads as a broken list. */
/* THREE RESULT LAYOUTS (Settings > Customization > Result layout). One class
   on the container switches between them; the hit markup never changes, so a
   merchant flipping this cannot break the results. Grid is the default. */
.th-search__results{display:grid;gap:30px;max-width:900px}
.th-search__hit{display:flex;text-decoration:none;color:inherit}
.th-search__hit img,.th-search__hit .th-search__ph{object-fit:cover;background:var(--background-color-dark,#f2f2f2);display:block}

/* GRID — two across, large images. The default: on a store where the
   photograph is the product, the picture is the answer. */
.th-search__results--grid{grid-template-columns:repeat(2,minmax(0,1fr))}
.th-search__results--grid .th-search__hit{flex-direction:column;align-items:stretch;gap:12px}
.th-search__results--grid .th-search__hit img,.th-search__results--grid .th-search__hit .th-search__ph{
  width:100%;height:auto;aspect-ratio:1/1;flex:0 0 auto}

/* LIST — one per row, small thumbnail, most matches in view at once. */
.th-search__results--list{grid-template-columns:minmax(0,1fr);gap:4px;max-width:640px}
.th-search__results--list .th-search__hit{flex-direction:row;align-items:center;gap:16px;padding:10px 0}
.th-search__results--list .th-search__hit img,.th-search__results--list .th-search__hit .th-search__ph{
  width:56px;height:56px;flex:0 0 56px;aspect-ratio:auto}

/* CATEGORIES — matches grouped under their category, one column per group.
   Built from the reference shot: an uppercase group header with the match
   count, then rows of thumbnail + name + a lighter sub-line, separated by
   hairlines, with the whole row highlighting on hover.

   auto-fit rather than a fixed column count: the number of groups is however
   many categories the matches happen to span, which is not knowable when the
   CSS is written. One category collapses to a single column and still reads
   correctly. */
.th-search__results--categories{grid-template-columns:repeat(auto-fit,minmax(210px,1fr));
  gap:0 44px;max-width:none;align-items:start}
.th-search__group{min-width:0}
.th-search__group-head{display:flex;align-items:baseline;gap:7px;padding:0 8px 12px;
  font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;
  color:var(--text-color-light,#8a8a8a)}
.th-search__group-n{font-weight:400;opacity:.75;letter-spacing:.06em}
/* The row is the hit itself, so the whole thing is one click target — a name
   that is a link inside a row that is not leaves a dead margin around it. */
.th-search__results--categories .th-search__hit{flex-direction:row;align-items:center;gap:13px;
  padding:11px 8px;border-top:solid 1px var(--border-color-light,rgba(0,0,0,.08));
  transition:background-color .14s ease}
.th-search__results--categories .th-search__group .th-search__hit:first-of-type{border-top:0}
.th-search__results--categories .th-search__hit:hover{background:var(--background-color-dark,#f5f5f5)}
.th-search__results--categories .th-search__hit img,
.th-search__results--categories .th-search__hit .th-search__ph{
  width:34px;height:34px;flex:0 0 34px;border-radius:50%;aspect-ratio:auto}
.th-search__results--categories .th-search__nm{font-size:13.5px;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap}
.th-search__results--categories .th-search__pr{font-size:11.5px;margin-top:2px}
/* Stack the groups on a phone: 210px columns beside each other would truncate
   every name to two words. */
@media(max-width:600px){
  .th-search__results--categories{grid-template-columns:minmax(0,1fr);gap:22px 0}
}

/* SLIDER — one swipeable row. Native overflow scrolling with snap points
   rather than a carousel library: it keeps momentum scrolling and the
   trackpad, which a transform carousel has to reimplement badly. */
.th-search__results--slider{display:flex;overflow-x:auto;gap:20px;max-width:none;
  scroll-snap-type:x mandatory;scrollbar-width:none;padding-bottom:6px}
.th-search__results--slider::-webkit-scrollbar{display:none}
.th-search__results--slider .th-search__hit{flex:0 0 min(240px,62vw);scroll-snap-align:start;
  flex-direction:column;align-items:stretch;gap:12px}
.th-search__results--slider .th-search__hit img,.th-search__results--slider .th-search__hit .th-search__ph{
  width:100%;height:auto;aspect-ratio:1/1}
.th-search__nm{display:block;font-size:14px;font-weight:500;line-height:1.35}
.th-search__pr{display:block;font-size:12px;color:var(--text-color-light,#888);margin-top:3px}
.th-search__hit:hover .th-search__nm{color:var(--accent-color,inherit)}
/* Two columns survive to phone width — the shopper is comparing two products,
   and one-per-row turns four results into a scroll. */
@media(max-width:767px){.th-search__bar{padding:18px}.th-search .th-search__bar input[type="search"]{font-size:20px}.th-search__body{padding:18px}
  .th-search__results{gap:18px 14px}}

/* Immersive: the page itself empties. The panel is transparent and the body
   class fades the real content out beneath it, so the shopper is not looking
   at a sheet ON a page — the page has become the search. Results come back as
   a product grid rather than a list, because they are now the whole view. */
body.th-search-open #brx-content,body.th-search-open main,body.th-search-open #brx-footer,
body.th-search-open footer.site{
  opacity:0;transform:scale(.985);pointer-events:none;
  transition:opacity .32s ease,transform .32s ease}
/* IMMERSIVE — the field sits CENTRED in the viewport, full width, over the
   page; results filter in underneath it.
   justify-content:center centres the bar+body block as a unit, so with an
   empty query the field lands mid-screen, and as results arrive the block
   grows downward around it. That needs .th-search__body to stop being flex:1
   — stretched, it fills the column and shoves the field back to the top,
   which is the layout this replaces. */
.th-search--immersive{background:rgba(255,255,255,.94);backdrop-filter:blur(8px);
  z-index:1200;justify-content:center}
.th-search--immersive .th-search__bar{border-bottom:0;padding:0 6vw;width:100%;
  max-width:none;gap:22px;flex:0 0 auto}
/* Full width and scaled to the viewport — this field IS the interface here. */
.th-search--immersive .th-search__bar input[type="search"]{font-size:clamp(26px,4.4vw,52px);
  font-weight:500;letter-spacing:-.02em}
.th-search--immersive .th-search__close{font-size:34px;opacity:.5}
.th-search--immersive .th-search__close:hover{opacity:1}
/* A rule under the field, the width of the field: it ties the results to the
   thing that produced them instead of leaving them floating. */
.th-search--immersive .th-search__body{width:100%;max-width:none;padding:26px 6vw 0;
  flex:0 1 auto;overflow:auto;margin-top:22px;
  border-top:solid 1px var(--border-color-light,rgba(0,0,0,.10))}
.th-search--immersive .th-search__results{max-width:none}
@media(prefers-reduced-motion:reduce){
  .th-search--immersive{backdrop-filter:none}
}
.th-search__results--grid .th-search__hit img,.th-search__results--grid .th-search__hit .th-search__ph{
  width:100%;height:auto;aspect-ratio:1;flex:none}
@media(max-width:767px){
  .th-search--immersive .th-search__bar{padding:20px 18px 10px}
  .th-search--immersive .th-search__bar input[type="search"]{font-size:22px}
}
@media(prefers-reduced-motion:reduce){
  body.th-search-open #brx-content,body.th-search-open main,body.th-search-open #brx-footer,
  body.th-search-open footer.site{transform:none;transition:none}
}

/* BOXED — the panel drops out of the header as a contained card: a large
   field along the top, results directly beneath it, inside one box.

   A CARD, not a full-bleed bar. Edge-to-edge, the panel reads as part of the
   header and the results look like page content that just appeared; boxed and
   shadowed, it reads as a thing that opened over the page and can be closed.

   Centred with left:50% + translateX rather than left/right insets, because
   the base .th-search sets inset:0 and a card narrower than the viewport has
   to override both sides anyway. */
.th-search--inline{position:absolute;top:100%;left:50%;right:auto;bottom:auto;
  transform:translateX(-50%);width:min(1120px,calc(100% - 48px));
  max-height:min(74vh,620px);margin-top:12px;
  background:var(--background-color,#fff);
  border:solid 1px var(--border-color-light,rgba(0,0,0,.09));
  box-shadow:0 28px 64px rgba(0,0,0,.14);overflow:auto}
/* The larger field asked for. Sized against the box, not the viewport, so it
   does not outgrow the card it sits in. */
.th-search--inline .th-search__bar{padding:22px 26px;gap:14px}
.th-search--inline .th-search__bar input[type="search"]{font-size:24px;font-weight:400}
.th-search--inline .th-search__body{padding:20px 26px 28px;flex:0 1 auto}
@media(max-width:767px){
  .th-search--inline{width:calc(100% - 20px);margin-top:8px}
  .th-search--inline .th-search__bar{padding:16px 18px}
  .th-search--inline .th-search__bar input[type="search"]{font-size:19px}
  .th-search--inline .th-search__body{padding:14px 18px 22px}
}

/* FULL WIDTH — the docked panel, edge to edge.
   Carries th-search--inline as well, so it inherits the whole docked
   behaviour and overrides only the box: no side inset, no gap under the
   header, and no side border, because at full bleed a vertical edge has
   nothing to sit against. The drop shadow stays — it is what holds the panel
   above the page.
   Written after the boxed rules AND at equal specificity, so these win by
   order; the mobile block above cannot re-narrow it because this comes later. */
.th-search--fullwidth{left:0;right:0;transform:none;width:100%;max-width:none;
  margin-top:0;border-left:0;border-right:0;
  box-shadow:0 18px 44px rgba(0,0,0,.13)}
.th-search--fullwidth .th-search__bar,
.th-search--fullwidth .th-search__body{max-width:1400px;margin-inline:auto;width:100%}
@media(max-width:767px){
  .th-search--fullwidth{width:100%;margin-top:0}
}
`;

export interface HeaderCartConfig {
  cartStyle: 'mini' | 'sidebar';
  cartSidebarReveal: 'overlay' | 'push';
  /** Mobile only: tap the bag to slide the drawer out, or open the cart page. */
  cartMobile: 'drawer' | 'page';
  /** Hex. The colour uncovered behind a shifted page. */
  cartSidebarGround: string;
  searchStyle: 'takeover' | 'inline' | 'fullwidth' | 'immersive';
  /**
   * Result layout: a 2-up grid, a dense list, results grouped under their
   * category, or a swipeable row.
   *
   * 'categories' groups the matches by product category, one column per
   * group with a count in the header — the layout Bam specified from a
   * reference shot: thumbnail, name, and a lighter sub-line per row.
   */
  searchLayout: 'list' | 'grid' | 'categories' | 'slider';
  wishlistEnabled: boolean;
}

export const HEADER_CART_DEFAULTS: HeaderCartConfig = {
  cartStyle: 'sidebar', cartSidebarReveal: 'push', cartSidebarGround: '#0a0a0a', cartMobile: 'drawer',
  searchStyle: 'takeover', searchLayout: 'grid', wishlistEnabled: true,
};

export function headerCartRuntime(cfg: HeaderCartConfig = HEADER_CART_DEFAULTS): string {
  return `
(function(){
  var SIDEBAR = ${JSON.stringify(cfg.cartStyle)} === 'sidebar';
  var PUSH = ${JSON.stringify(cfg.cartSidebarReveal)} === 'push';
  var MOBILE_PAGE = ${JSON.stringify(cfg.cartMobile)} === 'page';
  var GROUND = ${JSON.stringify(cfg.cartSidebarGround)};
  var SEARCH_STYLE = ${JSON.stringify(cfg.searchStyle)};
  var SEARCH_LAYOUT = ${JSON.stringify(cfg.searchLayout ?? 'grid')};
  // Both docked styles hang off the header, so they share the anchoring and
  // positioning path; only their width differs, which is pure CSS.
  var DOCKED_SEARCH = SEARCH_STYLE === 'inline' || SEARCH_STYLE === 'fullwidth';
  var INLINE_SEARCH = DOCKED_SEARCH;
  var IMMERSIVE_SEARCH = SEARCH_STYLE === 'immersive';
  var WISHLIST = ${JSON.stringify(cfg.wishlistEnabled)};
  var KEY = 'therum_cart_token';
  var busy = false;

  // Self-contained on purpose: this script runs on EVERY page, including the
  // Base Theme pages that never load the storefront runtime.
  function tok(){ return localStorage.getItem(KEY); }
  function setTok(t){ t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); }
  async function api(path, opts){
    opts = opts || {};
    var headers = Object.assign({'content-type':'application/json'}, opts.headers || {});
    if (tok()) headers['x-cart-token'] = tok();
    var res = await fetch('/api' + path, Object.assign({}, opts, { headers: headers }));
    var body = await res.json().catch(function(){ return {}; });
    if (!res.ok) throw Object.assign(new Error((body.error && body.error.message) || 'Request failed'), { status: res.status });
    return body;
  }
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]; }); }
  function money(m){ return (m/100).toLocaleString('en-US',{ style:'currency', currency:'USD' }); }

  // ── Cart surface ────────────────────────────────────────────────────────
  //
  // The ported chrome renders TWO headers — a desktop one and a mobile one —
  // and hides whichever does not apply with display:none. So there are two
  // .js-cart hosts, and binding to the first in DOM order picks the mobile bag,
  // whose dropdown is inside a hidden ancestor and measures 0x0 on a desktop.
  // Rather than guess which is live (and re-guess on every resize), the mini
  // cart gets a panel in EVERY host and opens them all: only the visible
  // header's is on screen, which is the same answer the CSS already has.
  // One shell wraps header + main + footer; the drawer is reparented out of it
  // so it stays put while the shell slides.
  var shell = document.getElementById('th-shell');

  // The ground is the merchant's colour, so the cart's own ink has to follow it
  // rather than being hardcoded white — a cream ground with white type is an
  // unreadable cart. Relative luminance, sRGB-corrected, same maths the
  // contrast ratio is built on.
  (function(){
    var m = /^#([0-9a-f]{6})$/i.exec(GROUND || '');
    if (!m) return;
    var n = parseInt(m[1], 16);
    var ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(function(v){
      v = v / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    var lum = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
    var dark = lum < 0.45; // a dark ground wants light ink
    var root = document.documentElement.style;
    root.setProperty('--th-cart-ground', GROUND);
    root.setProperty('--th-cart-ink', dark ? '#ffffff' : '#111111');
    root.setProperty('--th-cart-line', dark ? 'rgba(255,255,255,.18)' : 'rgba(0,0,0,.14)');
  })();
  var bagHosts = [].slice.call(document.querySelectorAll('.js-cart'));
  var drawer  = document.querySelector('.js-cart-sidebar');
  var wrap    = document.querySelector('.js-cart-sidebar-wrap');
  var shadow  = document.querySelector('.js-cart-sidebar-shadow');
  var panels = [];   // every cart surface on the page — see above.

  if (SIDEBAR && drawer) {
    // The ported markup nests the drawer inside #brx-header, which is one of
    // the regions the page-shift translates — and a transformed ancestor
    // becomes the containing block for position:fixed. Left where it is, the
    // drawer slides away with the page and gets clipped to the header's own
    // height. Moving it to <body> is what makes it fixed to the VIEWPORT.
    // The shadow follows because the theme targets it as an adjacent sibling.
    if (drawer.parentElement !== document.body) {
      document.body.appendChild(drawer);
      if (shadow) document.body.appendChild(shadow);
    }
    var el = drawer.querySelector('.widget_shopping_cart_content');
    panels = el ? [el] : [];
  } else {
    // Mini: swap each host to the theme's dropdown variant and give it
    // something to drop.
    bagHosts.forEach(function(host){
      host.classList.remove('c-header__cart--sidebar');
      host.classList.add('c-header__cart--default');
      var el = host.querySelector('.widget_shopping_cart_content');
      if (!el) {
        el = document.createElement('div');
        el.className = 'widget_shopping_cart_content';
        host.appendChild(el);
      }
      panels.push(el);
    });
    if (drawer) drawer.classList.add('c-shop-sidebar--disabled');
  }

  // Exposed so ANY surface that adds to the cart can reveal the drawer.
  // addToCart in storefrontHtml.ts posts, updates the count and stops — which
  // is why adding from a product page changed the badge and nothing else,
  // while the same action elsewhere opened the drawer. One cart, one reveal.
  window.__thCartOpen = function(){ open(); };
  window.__thCartRefresh = function(){ render(); };

  function isOpen(){
    return SIDEBAR
      ? (document.body.classList.contains('th-cart-open') || document.body.classList.contains('th-cart-over'))
      : panels.some(function(p){ return p.classList.contains('th-open'); });
  }
  function open(){
    if (!panels.length) return;
    render();
    if (SIDEBAR && drawer) {
      // Measure rather than assume: the theme sets the drawer's width, and a
      // hardcoded copy here would silently desync from it.
      // Only the push mode moves the page; overlay leaves it exactly where it
      // is and lets the drawer slide across, which is the theme's own default.
      // Written NEGATIVE so the CSS can use it with no calc() — see the note
      // on the page-shift rule for why that mattered.
      // Below 768px the drawer is nearly full-width — there is nothing left to
      // reveal, so it covers instead of pushing. Checked here rather than in a
      // media query because an inline transform outranks one.
      if (PUSH && shell && window.innerWidth >= 768) {
        shell.style.setProperty('transform', 'translateX(-' + drawer.offsetWidth + 'px)');
      }
      drawer.classList.add('c-shop-sidebar--active');
      if (wrap) wrap.classList.add('c-shop-sidebar__wrap--active');
      document.body.classList.add(PUSH ? 'th-cart-open' : 'th-cart-over');
      if (PUSH) document.documentElement.classList.add('th-cart-open');
    } else {
      panels.forEach(function(p){ p.classList.add('th-open'); });
    }
  }
  function close(){
    if (!panels.length) return;
    if (SIDEBAR && drawer) {
      drawer.classList.remove('c-shop-sidebar--active');
      if (wrap) wrap.classList.remove('c-shop-sidebar__wrap--active');
      if (shell) shell.style.removeProperty('transform');
      document.body.classList.remove('th-cart-open');
      document.documentElement.classList.remove('th-cart-open');
      document.body.classList.remove('th-cart-over');
    } else {
      panels.forEach(function(p){ p.classList.remove('th-open'); });
    }
  }

  function inside(t, els){ return els.some(function(el){ return el.contains(t); }); }

  document.addEventListener('click', function(e){
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('.js-cart-sidebar-open, .js-cart > a, .js-cart > div > a')) {
      // Mobile can be set to open the cart PAGE instead of the slide-out drawer:
      // let the bag's own /cart link navigate rather than intercepting it.
      if (MOBILE_PAGE && window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return;
      e.preventDefault();
      isOpen() ? close() : open();
      return;
    }
    if (t.closest('.js-cart-sidebar-close') || t.closest('.js-cart-sidebar-shadow')) { e.preventDefault(); close(); return; }
    if (!SIDEBAR && !inside(t, panels) && !inside(t, bagHosts)) close();
  });
  if (shadow) shadow.addEventListener('click', close);

  // ── Rendering, in the theme's widget markup ─────────────────────────────
  async function fetchCart(){
    if (!tok()) return null;
    try { return await api('/cart'); }
    catch (err) { if (err.status === 404) setTok(null); return null; }
  }

  function lineHtml(l){
    var variant = [l.color, l.size].filter(Boolean).join(' / ');
    return '<li class="c-product-list-widget__item mini_cart_item">'
      + '<button class="c-product-list-widget__remove" type="button" aria-label="Remove"'
      + ' data-cart-remove="' + esc(l.variantId) + '">&times;</button>'
      + '<div class="c-product-list-widget__wrap">'
      +   '<div class="c-product-list-widget__thumb-col">'
      +     (l.image
              ? '<img class="c-product-list-widget__thumb c-product-list-widget__thumb--crop" src="' + esc(l.image) + '" alt="" loading="lazy">'
              : '<div class="c-product-list-widget__thumb c-product-list-widget__thumb--crop"></div>')
      +   '</div>'
      +   '<div class="c-product-list-widget__title-col">'
      +     '<a class="c-product-list-widget__title c-product-list-widget__title-link" href="/product/' + esc(l.productSlug) + '">' + esc(l.productName) + '</a>'
      +     (variant ? '<dl class="variation"><dd>' + esc(variant) + '</dd></dl>' : '')
      +     '<div class="c-product-list-widget__qty">'
      +       '<button type="button" data-cart-qty="' + esc(l.variantId) + '" data-delta="-1" aria-label="Decrease">&minus;</button>'
      +       '<span>' + l.quantity + '</span>'
      +       '<button type="button" data-cart-qty="' + esc(l.variantId) + '" data-delta="1" aria-label="Increase"'
      +         (l.quantity >= l.available ? ' disabled' : '') + '>+</button>'
      +     '</div>'
      +     '<div class="c-product-list-widget__price">' + money(l.lineTotal) + '</div>'
      +   '</div>'
      + '</div></li>';
  }

  async function render(){
    if (!panels.length) return;
    var c = await fetchCart();
    var lines = (c && c.totals && c.totals.lines) || [];
    var markup = !lines.length
      ? '<p class="c-product-list-widget__empty">No products in the cart.</p>'
        + '<div class="c-product-list-widget__buttons"><a class="button" href="/shop">Continue shopping</a></div>'
      : '<ul class="c-product-list-widget">' + lines.map(lineHtml).join('') + '</ul>'
        + '<div class="c-product-list-widget__total"><span class="c-product-list-widget__total-title">Subtotal</span>'
        +   '<span class="amount">' + money(c.totals.subtotal) + '</span></div>'
        + '<div class="c-product-list-widget__buttons">'
        +   '<a class="button" href="/cart">View cart</a>'
        +   '<a class="button checkout" href="/checkout">Checkout</a>'
        + '</div>';
    // Every panel, because in mini mode there is one per header and the CSS —
    // not this script — decides which of them is on screen.
    panels.forEach(function(p){ p.innerHTML = markup; });
  }

  // Quantity and removal, straight from the drawer — going to /cart to drop a
  // line the shopper can already see is a wasted page load.
  document.addEventListener('click', async function(e){
    var t = e.target;
    if (!t || !t.closest || busy) return;
    var rm = t.closest('[data-cart-remove]');
    var qt = t.closest('[data-cart-qty]');
    if (!rm && !qt) return;
    e.preventDefault();
    busy = true;
    panels.forEach(function(p){ p.classList.add('th-cart-busy'); });
    // One endpoint for both: PATCH with quantity 0 IS removal (cart.ts).
    var setQty = function(variantId, quantity){
      return api('/cart/items/' + encodeURIComponent(variantId), {
        method: 'PATCH',
        body: JSON.stringify({ cartToken: tok(), quantity: quantity }),
      });
    };
    try {
      if (rm) {
        await setQty(rm.getAttribute('data-cart-remove'), 0);
      } else {
        var id = qt.getAttribute('data-cart-qty');
        var delta = Number(qt.getAttribute('data-delta'));
        var cur = await api('/cart');
        var line = (cur.totals.lines || []).filter(function(l){ return l.variantId === id; })[0];
        if (line) await setQty(id, Math.max(0, line.quantity + delta));
      }
    } catch (err) { /* the re-render below shows whatever the server now says */ }
    busy = false;
    panels.forEach(function(p){ p.classList.remove('th-cart-busy'); });
    await render();
    await counts();
    window.dispatchEvent(new CustomEvent('therum:cart-changed'));
  });

  // ── Badges ──────────────────────────────────────────────────────────────
  async function counts(){
    document.querySelectorAll('.js-cart-info').forEach(function(el){ el.classList.add('c-header__cart-count'); });
    var wl = WISHLIST ? document.querySelectorAll('.js-wishlist-info') : [];
    wl.forEach(function(el){
      el.classList.add('c-header__cart-count');
      var n = 0;
      try { n = (JSON.parse(localStorage.getItem('therum_wishlist') || '[]') || []).length; } catch (err) {}
      el.textContent = n > 0 ? String(n) : '';
    });
    var c = await fetchCart();
    var n = c ? (c.totals.lines || []).reduce(function(a, l){ return a + l.quantity; }, 0) : 0;
    document.querySelectorAll('.js-cart-info').forEach(function(el){ el.textContent = n > 0 ? String(n) : ''; });
  }
  counts();
  // Anything that changes the cart elsewhere on the page says so; the badge and
  // an open drawer both follow.
  window.addEventListener('therum:cart-changed', function(){ counts(); if (isOpen()) render(); });
  window.addEventListener('therum:wishlist-changed', counts);
  window.addEventListener('storage', function(e){ if (e.key === 'therum_wishlist' || e.key === KEY) counts(); });

  // ── Search ──────────────────────────────────────────────────────────────
  //
  // THE PORTED CHROME CARRIES THREE MAGNIFIERS, not one: the theme ships a
  // desktop header and two mobile header variants, all in the DOM at once,
  // with CSS deciding which is visible. The mobile ones come FIRST, so
  // querySelector('.js-search-button') returned a 0x0 hidden button and the
  // click handler landed on something no one can click. Measured on the live
  // page: count=3, visible=1, and the visible one is index 2.
  //
  // Bind EVERY match. Whichever header the viewport is showing, its magnifier
  // is wired. This is the same trap the cart hooks already avoid — .js-cart
  // and .js-cart-info are duplicated three times for exactly the same reason.
  var searchBtns = [].slice.call(document.querySelectorAll('.js-search-button'));
  // The anchor must come from the button the visitor can actually see, or the
  // inline panel docks under a header that is not on screen.
  var searchBtn = searchBtns.filter(function (b) {
    return b.getBoundingClientRect().width > 0;
  })[0] || searchBtns[0];
  if (searchBtn) {
    var box = document.createElement('div');
    box.className = 'th-search'
      + (SEARCH_STYLE === 'inline' ? ' th-search--inline'
        : SEARCH_STYLE === 'fullwidth' ? ' th-search--inline th-search--fullwidth'
        : IMMERSIVE_SEARCH ? ' th-search--immersive' : '');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Search products');
    box.innerHTML = '<div class="th-search__bar">'
      + '<form data-search-form>'
      + '<svg class="th-search__icon" viewBox="0 0 24 24" aria-hidden="true">'
      + '<circle cx="11" cy="11" r="7"></circle><path d="M16.5 16.5 21 21"></path></svg>'
      + '<input type="search" name="q" placeholder="Search products" autocomplete="off">'
      + '</form>'
      + '<button class="th-search__close" type="button" aria-label="Close">&times;</button></div>'
      + '<div class="th-search__body"><p class="th-search__hint">Type to search the shop.</p></div>';
    // Inline docks under the header, so it belongs INSIDE it — appended to
    // <body> it would have nothing to anchor to. Takeover covers the viewport
    // and belongs at the top level.
    var searchAnchor = INLINE_SEARCH ? (searchBtn.closest('#brx-header') || document.body) : document.body;
    if (INLINE_SEARCH && searchAnchor !== document.body) searchAnchor.style.position = 'relative';
    searchAnchor.appendChild(box);
    var input = box.querySelector('input');
    var body = box.querySelector('.th-search__body');
    var closeBtn = box.querySelector('.th-search__close');

    // Immersive empties the PAGE rather than covering it: the body class fades
    // the content out underneath, and the panel is transparent so what is left
    // is the field and whatever the shopper's typing brings back.
    var openSearch = function(){
      box.classList.add('on');
      if (IMMERSIVE_SEARCH) document.body.classList.add('th-search-open');
      input.focus();
    };
    var closeSearch = function(){
      box.classList.remove('on');
      document.body.classList.remove('th-search-open');
    };
    searchBtns.forEach(function (b) {
      b.addEventListener('click', function(e){ e.preventDefault(); openSearch(); });
    });
    closeBtn.addEventListener('click', closeSearch);
    // Enter goes to the full shop results, where the filters live — the
    // overlay is for finding something fast, not for replacing that page.
    box.querySelector('[data-search-form]').addEventListener('submit', function(e){
      e.preventDefault();
      var q = input.value.trim();
      if (q) window.location.href = '/shop?q=' + encodeURIComponent(q);
    });

    var timer = null;
    input.addEventListener('input', function(){
      clearTimeout(timer);
      var q = input.value.trim();
      if (q.length < 2) { body.innerHTML = '<p class="th-search__hint">Type to search the shop.</p>'; return; }
      timer = setTimeout(async function(){
        try {
          // The category layout shows several groups at once, so it needs a
          // deeper pool than the flat layouts — 8 matches split four ways is
          // two products per column.
          var cap = SEARCH_LAYOUT === 'categories' ? 24 : 8;
          var r = await api('/products?q=' + encodeURIComponent(q) + '&status=active&limit=' + cap);
          var items = r.items || [];

          var hit = function(p){
            var prices = (p.variants || []).map(function(v){ return v.price; }).filter(function(n){ return typeof n === 'number'; });
            var from = prices.length ? Math.min.apply(null, prices) : null;
            return '<a class="th-search__hit" href="/product/' + esc(p.slug) + '">'
              + (p.image
                  ? '<img src="' + esc(p.image) + '" alt="" loading="lazy">'
                  : '<span class="th-search__ph"></span>')
              + '<span><span class="th-search__nm">' + esc(p.name) + '</span>'
              + (from === null ? '' : '<span class="th-search__pr">' + (prices.length > 1 ? 'From ' : '') + money(from) + '</span>')
              + '</span></a>';
          };

          var results;
          if (SEARCH_LAYOUT === 'categories') {
            // Group by category. A product in two categories appears under
            // both — that is what a category listing means, and hiding it from
            // one of them would make the counts lie.
            var groups = [], byName = {};
            var push = function(name, p){
              if (!byName[name]) { byName[name] = []; groups.push(name); }
              byName[name].push(p);
            };
            items.forEach(function(p){
              var cats = (p.categories || []).filter(Boolean);
              // Uncategorised products still have to appear. Dropping them
              // would mean a search that matches a product returns nothing,
              // which reads as a broken search rather than a tidy store.
              if (!cats.length) return push('Products', p);
              cats.forEach(function(c){ push(c.name || c.slug, p); });
            });
            results = '<div class="th-search__results th-search__results--categories">'
              + groups.map(function(name){
                  var list = byName[name];
                  return '<div class="th-search__group">'
                    + '<div class="th-search__group-head">' + esc(name)
                    + '<span class="th-search__group-n">(' + list.length + ')</span></div>'
                    + list.map(hit).join('')
                    + '</div>';
                }).join('')
              + '</div>';
          } else {
            results = '<div class="th-search__results th-search__results--' + SEARCH_LAYOUT + '">'
              + items.map(hit).join('') + '</div>';
          }

          body.innerHTML = items.length
            ? results + '<p class="th-search__hint" style="margin-top:28px">Press Enter for all results.</p>'
            : '<p class="th-search__hint">Nothing matches &ldquo;' + esc(q) + '&rdquo;.</p>';
        } catch (err) {
          body.innerHTML = '<p class="th-search__hint">Search is unavailable right now.</p>';
        }
      }, 220);
    });
    document.addEventListener('keydown', function(e){ if (e.key === 'Escape') { closeSearch(); close(); } });
  } else {
    document.addEventListener('keydown', function(e){ if (e.key === 'Escape') close(); });
  }
})();
`;
}

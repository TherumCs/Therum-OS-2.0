import { esc, money } from './html.js';
import { BANNER_RUNTIME, BANNER_STYLES } from './bannerRuntime.js';
import { SUBSCRIBE_SCRIPT } from './shortcodes.js';
import { PRODUCT_GRID_FALLBACK_CSS } from './productGrid.js';
import { CHECKOUT_FLOW_CSS } from './checkoutFlow.js';
import { SHOP_TOOLBAR_CSS } from './shopToolbar.js';
import { HEADER_CART_CSS, headerCartRuntime, HEADER_CART_DEFAULTS, type HeaderCartConfig } from './headerCart.js';
import { MOBILE_MENU_CSS, MOBILE_MENU_RUNTIME } from './mobileMenu.js';
import { WISHLIST_CSS, WISHLIST_RUNTIME } from './wishlist.js';
import { ACCOUNT_CSS } from './accountPage.js';
// Counter C4 — storefront HTML layer. Server-rendered, zero client
// framework: pages are plain HTML strings + a small vanilla-JS cart runtime
// (below) that talks to the existing /api/cart + /api/checkout routes.
// All colors/type/spacing come from the real 1.9.44 token values
// (shared/therum-tokens.css) — the storefront is the public face of the same
// design system the admin chrome uses: #fafafa canvas, white surfaces,
// near-black ink, blue action buttons (--ac-btn), red reserved for brand.


export const CSS = `
:root{
  /* Action colour is the THEME's button colour (--button-color in the ported
     chrome), not a framework blue. The storefront shipped #3858e9, which
     matched nothing else on the site and read as a stray admin control. */
  --ac:#e83b3b;--ac-btn:#070707;--ac-btn-h:#252525;
  --sf:#ffffff;--sf2:#f5f5f5;--bd:rgba(0,0,0,0.08);--bd2:rgba(0,0,0,0.16);
  --bg:#fafafa;--tx:#0a0a0a;--tx2:#666666;--tx3:#999999;
  --ok:#10b981;--err:#ef4444;
  --f:-apple-system,BlinkMacSystemFont,'Inter','Helvetica Neue',Arial,sans-serif;
  --e:0.15s ease;--radius-sm:6px;--radius-md:10px;--radius-lg:14px;--radius-pill:999px;
}
*{box-sizing:border-box;margin:0;padding:0}
:where(body){font-family:var(--f);background:var(--bg);color:var(--tx);line-height:1.55;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
/* Same knob the rest of the site uses (Settings > Site > Content width).
   This was a literal 1080px, so the shop stayed narrow at every setting and
   at every viewport — cards got thinner as columns went up instead of the
   grid getting wider. The fallback is the old value, so a page rendered
   without the variable looks exactly as it did. */
.wrap{max-width:var(--th-site-max,1080px);margin:0 auto;padding:0 24px}
header.site{background:var(--sf);border-bottom:1px solid var(--bd);position:sticky;top:0;z-index:10}
header.site .wrap{display:flex;align-items:center;justify-content:space-between;height:64px}
.brand{font-weight:700;font-size:17px;letter-spacing:-0.01em;display:flex;align-items:center;gap:10px}
.brand .dot{width:10px;height:10px;border-radius:50%;background:var(--ac);display:inline-block}
nav.main{display:flex;gap:22px;font-size:14px;color:var(--tx2)}
nav.main a:hover{color:var(--tx)}
nav.main a.cartlink{color:var(--tx);font-weight:600;display:flex;align-items:center;gap:6px}
#cart-count{min-width:20px;height:20px;border-radius:var(--radius-pill);background:var(--ac-btn);color:#fff;font-size:12px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;padding:0 6px}
#cart-count.empty{background:var(--sf2);color:var(--tx3)}
main{padding:40px 0 80px}
.page-title{font-size:26px;font-weight:700;letter-spacing:-0.02em;margin-bottom:6px;text-wrap:balance}
.page-sub{color:var(--tx2);font-size:14px;margin-bottom:28px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:20px}
.card{background:var(--sf);border:1px solid var(--bd);border-radius:var(--radius-lg);overflow:hidden;transition:border-color var(--e),transform var(--e);display:flex;flex-direction:column}
.card:hover{border-color:var(--bd2);transform:translateY(-2px)}
.card .thumb{aspect-ratio:4/3;background:var(--sf2);display:flex;align-items:center;justify-content:center;color:var(--tx3);font-size:12px;letter-spacing:0.06em;text-transform:uppercase}
.card .body{padding:16px;display:flex;flex-direction:column;gap:4px;flex:1}
.card .name{font-weight:600;font-size:15px}
.card .vendor{color:var(--tx3);font-size:12px}
.card .price{margin-top:auto;padding-top:10px;font-weight:700;font-size:15px;font-variant-numeric:tabular-nums}
/* Measured from the ported theme's .c-button: 12px/600, .06em tracking,
   uppercase, square, 18px 50px, ink fill with a 1px ink border. */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;background:var(--ac-btn);color:#fff;border:1px solid var(--ac-btn);border-radius:var(--th-btn-r,0);padding:18px 40px;font-size:12px;line-height:1;font-weight:600;letter-spacing:.06em;text-transform:uppercase;font-family:var(--f);cursor:pointer;transition:background var(--e),border-color var(--e),color var(--e)}
.btn:hover{background:var(--ac-btn-h);border-color:var(--ac-btn-h)}
.btn:disabled{opacity:0.5;cursor:default}
.pdp-cta{display:flex;gap:12px;flex-wrap:wrap}
.pdp-cta .btn{flex:1 1 0;min-width:140px}
.btn--alt{background:transparent;color:var(--ac-btn)}
.btn--alt:hover{background:var(--ac-btn);color:#fff}
.btn.ghost{background:transparent;color:var(--tx);border:1px solid var(--tx)}
.btn.ghost:hover{background:var(--ac-btn);border-color:var(--ac-btn);color:#fff}
.btn.sm{padding:12px 25px;font-size:11px}
input[type=email],input[type=text],select{font-family:var(--f);font-size:14px;padding:10px 12px;border:1px solid var(--bd2);border-radius:var(--radius-md);background:var(--sf);color:var(--tx);width:100%}
input:focus,select:focus{outline:2px solid var(--ac-btn);outline-offset:-1px;border-color:transparent}
label{font-size:13px;font-weight:600;color:var(--tx2);display:block;margin-bottom:6px}
.panel{background:var(--sf);border:1px solid var(--bd);border-radius:var(--radius-lg);padding:24px}
.split{display:grid;grid-template-columns:1fr 380px;gap:28px;align-items:start}
@media(max-width:860px){.split{grid-template-columns:1fr}}
table.lines{width:100%;border-collapse:collapse;font-size:14px}
table.lines th{text-align:left;font-size:12px;color:var(--tx3);text-transform:uppercase;letter-spacing:0.05em;font-weight:600;padding:0 0 10px}
table.lines td{padding:12px 0;border-top:1px solid var(--bd);vertical-align:middle}
table.lines .num{text-align:right;font-variant-numeric:tabular-nums}
.qty{display:inline-flex;align-items:center;gap:8px}
.qty button{width:28px;height:28px;border-radius:var(--radius-sm);border:1px solid var(--bd2);background:var(--sf);cursor:pointer;font-size:15px;line-height:1;color:var(--tx)}
.qty button:hover{background:var(--sf2)}
.totals{display:flex;flex-direction:column;gap:8px;font-size:14px}
.totals .row{display:flex;justify-content:space-between}
.totals .row.muted{color:var(--tx2)}
.totals .row.grand{border-top:1px solid var(--bd);padding-top:12px;margin-top:6px;font-weight:700;font-size:17px}
.totals .num{font-variant-numeric:tabular-nums}
.pill{display:inline-flex;align-items:center;gap:6px;background:var(--sf2);border-radius:var(--radius-pill);padding:4px 12px;font-size:12px;font-weight:600;color:var(--tx2)}
.pill.ok{background:rgba(16,185,129,0.1);color:var(--ok)}
.notice{border-radius:var(--radius-md);padding:12px 14px;font-size:13px;margin:12px 0}
.notice.err{background:rgba(239,68,68,0.08);color:var(--err)}
.notice.ok{background:rgba(16,185,129,0.08);color:var(--ok)}
.empty-state{text-align:center;padding:70px 0;color:var(--tx2)}
.empty-state .big{font-size:40px;margin-bottom:12px}
/* ── Payment method strip — ported 1:1 from 1.x checkout-experience.html ── */
.method-strip{display:flex;gap:6px;margin:0 -2px 18px;padding:4px;background:var(--sf2);border-radius:var(--radius-md);overflow-x:auto;scrollbar-width:none}
.method-strip::-webkit-scrollbar{display:none}
.method-pill{display:inline-flex;align-items:center;gap:8px;padding:9px 14px;background:transparent;border:0;border-radius:8px;font:600 12px var(--f);color:var(--tx2);cursor:pointer;white-space:nowrap;transition:all var(--e);position:relative}
.method-pill .pill-ico{flex-shrink:0;width:18px;height:18px;border-radius:5px;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;letter-spacing:-0.02em}
.method-pill:hover{background:rgba(255,255,255,.6);color:var(--tx)}
.method-pill.active{background:var(--sf);color:var(--tx);box-shadow:0 1px 3px rgba(0,0,0,.06),0 0 0 1px var(--bd)}
.method-pill .preview{position:absolute;left:50%;bottom:calc(100% + 8px);transform:translateX(-50%);background:var(--tx);color:#fff;padding:7px 11px;border-radius:7px;font-size:11px;font-weight:500;letter-spacing:.01em;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .15s ease,transform .2s ease;transform-origin:bottom center;box-shadow:0 6px 20px rgba(0,0,0,.18);z-index:5}
.method-pill .preview::after{content:'';position:absolute;left:50%;top:100%;transform:translateX(-50%);border:5px solid transparent;border-top-color:var(--tx)}
.method-pill:hover .preview{opacity:1;transform:translateX(-50%) translateY(-2px)}
.method-pill[data-method="card"] .pill-ico{background:#1a1a1a}
.method-pill[data-method="wallets"] .pill-ico{background:#000}
.method-pill[data-method="bnpl"] .pill-ico{background:#ffa8b8;color:#000}
.method-pill[data-method="bank"] .pill-ico{background:#10b981}
.method-pill[data-method="crypto"] .pill-ico{background:#f7931a}
.method-pill[data-method="p2p"] .pill-ico{background:#00d632}
.method-panel{display:none;animation:panelIn .28s var(--e)}
.method-panel.active{display:block}
@keyframes panelIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
/* Method rows (bnpl-card pattern generalized: every selectable method row) */
.method-list{display:flex;flex-direction:column;gap:8px}
.method-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;background:var(--sf2);border:1.5px solid transparent;border-radius:var(--radius-md);cursor:pointer;transition:all var(--e)}
.method-row:hover{background:#eee;border-color:var(--bd2)}
.method-row.active{border-color:var(--ac-btn);background:rgba(7,7,7,0.05)}
.method-row.disabled{opacity:.55;cursor:default}
.method-row.disabled:hover{background:var(--sf2);border-color:transparent}
.method-l{display:flex;align-items:center;gap:12px}
.method-logo{width:46px;height:28px;border-radius:5px;display:flex;align-items:center;justify-content:center;font:700 11px var(--f);letter-spacing:-0.02em;background:#1a1a1a;color:#fff}
.method-name{font-size:13px;font-weight:700}
.method-sub{font-size:11px;color:var(--tx3);margin-top:1px}
.method-chev{color:var(--tx3);font-size:16px}
.setup-chip{font-size:10px;font-weight:700;color:var(--tx3);text-transform:uppercase;letter-spacing:.05em;background:var(--sf);border:1px solid var(--bd2);border-radius:var(--radius-pill);padding:3px 9px;white-space:nowrap}
/* Brand tiles */
.logo-klarna{background:#ffa8b8;color:#000}.logo-affirm{background:#060809;color:#fff}
.logo-afterpay{background:#b2fce4;color:#000}.logo-sezzle{background:#fffd6d;color:#000}
.logo-zip{background:#aa8fff;color:#fff}.logo-paypal_credit{background:#003087;color:#fff;font-size:9px}
.logo-paypal{background:#fff;color:#003087;border:1px solid var(--bd2);font-style:italic;font-weight:800}
.logo-apple_pay{background:#000;color:#fff}.logo-google_pay{background:#fff;color:#1a1a1a;border:1px solid var(--bd2)}
.logo-link{background:#00d66f;color:#011e0f}.logo-shop_pay{background:#5a31f4;color:#fff}
.logo-bank_ach{background:#10b981;color:#fff}
.logo-cashapp{background:#00d632;color:#000}.logo-venmo{background:#3d95ce;color:#fff}.logo-zelle{background:#6d1ed4;color:#fff}
.logo-card{background:#1a1a1a;color:#fff}
/* Crypto chips */
.crypto-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:12px}
@media(max-width:540px){.crypto-grid{grid-template-columns:repeat(3,1fr)}}
.crypto-chip{display:flex;flex-direction:column;align-items:center;gap:4px;padding:12px 8px;background:var(--sf2);border:1.5px solid transparent;border-radius:var(--radius-md);cursor:pointer;transition:all var(--e)}
.crypto-chip:hover{background:#eee;border-color:var(--bd2)}
.crypto-chip.active{border-color:var(--ac-btn);background:rgba(7,7,7,0.05)}
.crypto-chip.disabled{opacity:.55;cursor:default}
.crypto-sym{width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font:700 11px var(--f);color:#fff;letter-spacing:-0.02em;background:#f7931a}
.sym-crypto_btc{background:#f7931a}.sym-crypto_eth{background:#627eea}.sym-crypto_usdc{background:#2775ca}
.sym-crypto_usdt{background:#26a17b}.sym-crypto_sol{background:linear-gradient(135deg,#9945ff,#14f195)}.sym-crypto_xrp{background:#23292f}
.crypto-label{font-size:11px;font-weight:600;color:var(--tx2)}
.method-note{font-size:11px;color:var(--tx3);text-align:center;line-height:1.5;padding:10px;background:var(--sf2);border-radius:var(--radius-md);margin-top:10px}
footer.site{border-top:1px solid var(--bd);padding:28px 0;color:var(--tx3);font-size:13px}
.variant-picker{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 20px}
.variant-picker button{border:1px solid var(--bd2);background:var(--sf);border-radius:var(--radius-md);padding:9px 14px;font-size:13px;font-family:var(--f);cursor:pointer;color:var(--tx)}
.variant-picker button.sel{outline:2px solid var(--ac-btn);outline-offset:-1px;border-color:transparent;font-weight:600}
.variant-picker button:disabled{opacity:0.4;cursor:default;text-decoration:line-through}
/* Colour swatches. The swatch is the variant's own mockup, not a colour dot:
   "Dark Green/Natural" is two colours and no single dot is honest about it. */
.swatches{display:flex;flex-wrap:wrap;gap:11px;margin:6px 0 8px}
/* A hairline rather than a full border: on the PDP the swatch is judged as a
   colour, and a 1px grey ring around every disc reads as a grid of buttons
   instead of a row of paint. It stays for white and cream, which would
   otherwise have no edge at all. */
/* Same reasoning as the card swatch: no border, or the two-tone gradient is
   inset by it and the border colour shows as a ring. */
.swatch{width:38px;height:38px;padding:0;border:0;background:var(--sf);
  background-origin:border-box;background-clip:border-box;
  border-radius:50%;overflow:hidden;cursor:pointer;line-height:0;
  box-shadow:0 1px 3px rgba(0,0,0,.16),0 0 0 .5px rgba(0,0,0,.06);
  transition:transform .14s ease,box-shadow .14s ease}
.swatch:hover{transform:scale(1.06);box-shadow:0 3px 9px rgba(0,0,0,.22),0 0 0 .5px rgba(0,0,0,.06)}
.swatch img{width:100%;height:100%;object-fit:cover;display:block}
.swatch-blank{display:block;width:100%;height:100%;background:var(--bd2)}
.swatch-fill{display:block;width:100%;height:100%}
/* "All" is a view, not a colour, so it reads as a label rather than a chip of
   paint that would imply a colourway the product does not have. */
.swatch--all{background:var(--sf);border-style:dashed}
.swatch-all-mark{display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:9px;font-weight:700;letter-spacing:.06em;color:var(--tx)}
.swatch.sel{outline:0;box-shadow:0 0 0 2px var(--sf,#fff),0 0 0 3.5px var(--tx,#111)}
.swatch:focus-visible{outline:2px solid var(--tx,#111);outline-offset:3px}
.swatch:disabled{opacity:.35;cursor:default}
.swatch-name{font-size:13px;color:var(--tx);margin-bottom:10px}
/* One size is a fact, not a choice — stated once instead of repeated on every
   option chip. */
.single-size{font-size:13px;color:var(--tx2,var(--tx));opacity:.75;margin:2px 0 10px}
/* ── Product page layouts ─────────────────────────────────────────────────
   One markup tree, four arrangements. The page is a two-column grid by
   default; each style re-arranges it rather than re-rendering it, so a layout
   change can never lose a control the way a second template would. */
.pdp{display:grid;gap:44px;align-items:start;max-width:min(var(--th-site-max,1080px),1320px);margin:0 auto;padding:0 24px}
/* A layout that ignores the site's own gutters stops being part of the site.
   The full-bleed styles still READ as edge-to-edge because their imagery fills
   the column — they simply stop escaping the grid the rest of the pages sit
   on, which is what made the hero touch the browser chrome. */
/* The details column is BOUNDED, not a fraction. As a 0.9fr it grew with the
   viewport while its content did not, so a wide screen put ~300px of text in a
   ~640px column and the slack read as dead space on the right of the page.
   Bounding it hands the width back to the image instead. */
.pdp--classic{grid-template-columns:minmax(0,1fr) minmax(300px,420px)}
/* Image side is a column ORDER, not a different DOM order — the gallery stays
   first in the source so a screen reader and a keyboard meet the product
   before the form, whichever side it is painted on. */
.pdp--imgright .pdp__media{order:2}
.pdp--imgright .pdp__info{order:1}

/* Apple: one large centred image, generous air, tight centred type. */
.pdp--apple{grid-template-columns:minmax(0,1fr);justify-items:center;text-align:center;gap:48px;max-width:940px;margin:0 auto}
.pdp--apple .pdp__media{width:100%;max-width:720px}
.pdp--apple .gallery-main{height:min(62vh,620px)}
.pdp--apple .gallery-main img{width:100%;height:100%;object-fit:contain}
.pdp--apple .pdp__info{max-width:560px}
.pdp--apple .variant-picker,.pdp--apple .swatches,.pdp--apple .gallery-strip{justify-content:center}
.pdp--apple .product-title{font-size:clamp(32px,5vw,56px);letter-spacing:-.03em;line-height:1.05;font-weight:700;margin:0 0 6px}
.pdp--apple .price{font-size:19px;font-weight:600;opacity:.9;margin-bottom:4px}
.pdp--apple .stock-note{font-size:13px;opacity:.65;margin-bottom:28px}
/* Apple labels each choice above a centred row, with the CHOSEN value spelled
   out beside it — the swatch alone never tells you what you picked. */
.pdp--apple .pdp__info label{display:block;font-size:13px;font-weight:600;letter-spacing:0;text-transform:none;margin:26px 0 10px;opacity:.9}
.pdp--apple .swatch-name{font-size:13px;opacity:.7;margin:10px 0 0}
.pdp--apple .single-size{font-size:13px;opacity:.7}
.pdp--apple .btn{min-width:260px;margin-top:32px;border-radius:var(--radius-pill,999px);padding:16px 34px}
.pdp--apple .product-desc{margin-top:34px;font-size:15px;line-height:1.7;opacity:.85;max-width:520px;margin-left:auto;margin-right:auto}
.pdp--apple .taxonomy-row{justify-content:center}
.pdp--apple .gallery-strip{max-width:420px;margin-left:auto;margin-right:auto}
.pdp--apple .gallery-strip > .gallery-thumb{height:64px}

/* Athletic: the imagery runs edge to edge and the details float over it. */
/* Two columns: imagery on the left, the buy controls on the right. The info
   used to float ON the photograph, which meant the hero had to be cropped to
   leave room for it — and cropping a product shot to fit a layout is the
   layout winning an argument it should not be in. */
.pdp--athletic{grid-template-columns:minmax(0,1fr) minmax(300px,400px);gap:32px;position:relative}
.pdp--athletic .pdp__media{width:100%}
/* The hero is CAPPED. Without a height the product image simply fills the
   viewport and every one of these layouts renders as the same giant photo —
   the arrangement only becomes visible once the image stops being the page. */
.pdp--athletic .gallery-main{height:min(58vh,560px);display:flex;align-items:center;justify-content:center;background:var(--sf2)}
/* CONTAIN, not cover: the whole product, scaled down, rather than a crop of it. */
.pdp--athletic .gallery-main img{max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain}
/* A real grid of images under the hero, not a row of chips — big enough to be
   worth looking at, and sitting to the LEFT of the colour and cart controls. */
.pdp--athletic .gallery-strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-top:10px}
.pdp--athletic .gallery-strip > .gallery-thumb{flex:none;height:auto;aspect-ratio:1;background:var(--sf2)}
.pdp--athletic .gallery-strip > .gallery-thumb img{object-fit:contain;padding:6px}
.pdp--athletic .pdp__info{position:static;margin:0;width:auto;box-shadow:none;background:transparent;border:0;padding:0}
.pdp--athletic .pdp__info{position:relative;margin:-120px 24px 0 auto;width:min(400px,100%);background:var(--sf);border:1px solid var(--bd2);border-radius:var(--radius-md);padding:24px;z-index:2;box-shadow:0 18px 48px rgba(0,0,0,.10)}
@media(max-width:900px){.pdp--athletic{grid-template-columns:minmax(0,1fr)}}

/* Editorial: oversized wordmark, overlapping hero, price inside the button. */
.pdp--editorial{grid-template-columns:minmax(0,1fr);gap:0}
.pdp--editorial .pdp__wordmark{font-size:clamp(56px,13vw,168px);line-height:.82;letter-spacing:-.04em;font-weight:800;text-transform:uppercase;margin:0 0 -.14em;overflow-wrap:anywhere}
/* Fills its column. Capped at 760 the hero left ~600px of dead page to its
   right, which is not an editorial composition — it is a narrow layout in a
   wide container. */
.pdp--editorial .pdp__media{position:relative;z-index:1}
.pdp--editorial .gallery-main{height:min(56vh,560px);display:flex;align-items:center;justify-content:center;background:var(--sf2)}
/* The hero stays large but is never cut — scaled to fit rather than filled. */
.pdp--editorial .gallery-main img{max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain}
/* 16:9 thumbs: wide enough to span the full hero width without becoming tall
   squares that push the buy controls off the screen.
   align-items:flex-start matters: the strip is a flex row, and Safari resolves
   the default stretch height BEFORE aspect-ratio — the ratio then computes
   width from that stretched height and the thumbs deform (the same transfer
   trap that turned the wallet discs into ovals). With stretch off, width is
   the definite axis and the ratio sets height, on every engine. */
.pdp--editorial .gallery-strip{align-items:flex-start}
.pdp--editorial .gallery-strip > .gallery-thumb{flex:1 1 0;min-width:0;height:auto;aspect-ratio:16/9;background:var(--sf2)}
.pdp--editorial .gallery-strip > .gallery-thumb img{object-fit:contain;padding:6px}
.pdp--editorial .pdp__info{max-width:760px;margin-top:28px}
.pdp--editorial .product-title{display:none}
.pdp--editorial .trust-row{display:flex;gap:24px;margin:14px 0 0;font-size:12px;color:var(--tx2,var(--tx));opacity:.8}

/* Thumbnails beside the main image instead of under it. */
.pdp--thumbside .gallery{display:grid;grid-template-columns:72px minmax(0,1fr);gap:12px;align-items:start}
.pdp--thumbside .gallery-strip{display:grid;grid-auto-rows:72px;gap:10px;order:-1;margin-top:0}
.pdp--thumbside .gallery-strip > .gallery-thumb{flex:none;height:72px}
.pdp--thumbnone .gallery-strip{display:none}
.product-hero{display:grid;grid-template-columns:1fr 1fr;gap:36px;align-items:start}
@media(max-width:860px){.product-hero{grid-template-columns:1fr}}
.product-hero .thumb{aspect-ratio:1;background:var(--sf2);border-radius:var(--radius-lg);display:flex;align-items:center;justify-content:center;color:var(--tx3);text-transform:uppercase;letter-spacing:0.06em;font-size:13px;overflow:hidden}
.product-hero .thumb img,.card .thumb img{width:100%;height:100%;object-fit:cover}
/* Catalog presentation */
.shop-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:8px}
.shop-search{display:flex;gap:8px;align-items:center}
.shop-search input[type=search]{width:240px}
.filter-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:10px 0}
.filter-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--tx3);min-width:64px}
.filter-chip{display:inline-flex;align-items:center;background:var(--sf);border:1px solid var(--bd2);border-radius:var(--radius-pill);padding:5px 13px;font-size:12px;font-weight:600;color:var(--tx2);transition:all var(--e)}
.filter-chip:hover{color:var(--tx);border-color:var(--tx3)}
.filter-chip.active{background:var(--ac-btn);border-color:var(--ac-btn);color:#fff}
.gallery-main{margin-bottom:10px}
/* The strip spans the width of the image above it, so the gallery reads as one
   block rather than a big picture with a few chips loose underneath. Each thumb
   takes an equal share; the height is fixed so a wide image cannot make them
   tall enough to compete with the hero. */
/* A CAROUSEL, not a row that divides itself up.
   flex:1 1 0 made every thumbnail share the strip equally, so a product with
   24 shots rendered 24 slivers ~23px wide — unreadable, and unclickable on a
   phone. Fixed-size thumbs that scroll sideways instead: the strip holds its
   size whether the product has three photographs or thirty.
   Native overflow scrolling rather than a carousel library, so trackpad,
   touch and shift-wheel all work without reimplementation. */
/* ── PDP: topbar (back + save/share), 3-box picker, quantity ──────────── */
.pdp-topbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 16px}
.pdp-back{display:inline-flex;align-items:center;gap:4px;padding:6px 12px 6px 8px;
  font-size:13px;font-weight:600;color:var(--tx2,#666);text-decoration:none;background:none;
  border:1px solid var(--bd,#e5e7eb);border-radius:999px;cursor:pointer;transition:color var(--e),border-color var(--e)}
.pdp-back:hover{color:var(--tx,#111);border-color:var(--tx,#111)}
.pdp-topbar__actions{display:flex;gap:8px}
.pdp-act{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border:1px solid var(--bd,#e5e7eb);
  border-radius:999px;background:var(--sf,#fff);color:var(--tx,#111);font:600 12px var(--f,inherit);cursor:pointer;
  transition:border-color var(--e),background var(--e),color var(--e)}
.pdp-act:hover{border-color:var(--tx,#111)}
.pdp-act svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linejoin:round}
.pdp-act[aria-pressed="true"]{background:var(--tx,#111);color:var(--sf,#fff);border-color:var(--tx,#111)}
.pdp-act[aria-pressed="true"] svg{fill:currentColor;stroke:currentColor}
.pdp-cats{margin:0 0 10px}
/* Three boxes, side by side on desktop and stacked on narrow screens. Colour and
   Size are tap-to-open and BECOME their chosen value (nothing pre-selected);
   Quantity is an inline stepper. */
/* Equal-flex, not a fixed 3-column grid: whether there are 3 boxes or 2 (a
   single-colour product is just Size + Quantity), they share the row evenly. */
.pdp-picker{display:flex;flex-direction:column;gap:12px;margin:18px 0}
@media(max-width:560px){.pdp-box{flex-basis:100%}}
.pdp-box{position:relative;min-width:0;border:1px solid var(--bd,#e5e7eb);border-radius:12px;background:var(--sf,#fff);
  min-height:74px;display:flex;flex-direction:row;align-items:center;justify-content:space-between;gap:12px;padding:11px 15px;cursor:pointer;
  transition:border-color var(--e),box-shadow var(--e)}
.pdp-box[data-box]:hover{border-color:var(--tx,#111)}
.pdp-box[aria-expanded="true"]{border-color:var(--tx,#111);box-shadow:0 0 0 1px var(--tx,#111)}
.pdp-box.set{border-color:var(--tx2,#888)}
.pdp-box--static,.pdp-box--qty{cursor:default}
.pdp-box__k{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--tx2,#888)}
.pdp-box__v{display:flex;align-items:center;gap:9px;font-size:15px;font-weight:600;color:var(--tx2,#888)}
.pdp-box.set .pdp-box__v{color:var(--tx,#111)}
.pdp-box__dot{width:20px;height:20px;border-radius:50%;box-shadow:inset 0 0 0 1px rgba(0,0,0,.12);flex:0 0 auto}
.pdp-box__pop{position:absolute;left:0;top:calc(100% + 8px);z-index:6;min-width:100%;width:max-content;max-width:min(280px,80vw);
  background:var(--sf,#fff);border:1px solid var(--bd,#e5e7eb);border-radius:12px;box-shadow:0 10px 34px rgba(0,0,0,.14);padding:13px}
.pdp-box__pop .swatches,.pdp-box__pop .variant-picker{margin:0}
.pdp-box--qty{flex-direction:row;align-items:center;justify-content:space-between;gap:12px}
.qtybox{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--bd,#e5e7eb);border-radius:10px;padding:4px}
.qbtn{width:30px;height:30px;border:0;background:none;font-size:18px;line-height:1;cursor:pointer;color:var(--tx,#111);
  border-radius:7px;display:inline-flex;align-items:center;justify-content:center;transition:background var(--e)}
.qbtn:hover:not(:disabled){background:var(--sf2,#f4f4f5)}
.qbtn:disabled{opacity:.3;cursor:not-allowed}
.qn{min-width:26px;text-align:center;font-size:14px;font-weight:700;font-variant-numeric:tabular-nums}
.gallery-strip{display:flex;gap:10px;margin-top:12px;align-items:stretch;
  overflow-x:auto;overflow-y:hidden;scroll-snap-type:x proximity;
  /* overflow-y:hidden clips the selected thumb's 2px ring — no top padding meant
     the first/selected thumbnail's border was sliced off the top. Pad the clip
     box: room above for the ring, a little each side for the first/last. */
  scroll-behavior:smooth;padding:4px 2px 7px;
  scrollbar-width:thin;scrollbar-color:var(--bd2) transparent}
.gallery-strip::-webkit-scrollbar{height:6px}
.gallery-strip::-webkit-scrollbar-thumb{background:var(--bd2);border-radius:3px}
.gallery-strip::-webkit-scrollbar-track{background:transparent}
/* aspect-ratio drives the width from whatever height the layout has chosen,
   so the apple layout's 64px thumbs stay square too. */
.gallery-strip > .gallery-thumb{flex:0 0 auto;aspect-ratio:1;width:auto;scroll-snap-align:start}
/* ARROWS. Every shot stays in the strip — all 24 of them — and these page
   through it rather than the strip dividing itself up to fit. The rail holds
   them outside the scrolling area so they never sit on top of a thumbnail. */
.gallery-striprail{display:flex;align-items:center;gap:6px;margin-top:12px}
.gallery-striprail > .gallery-strip{margin-top:0;flex:1 1 auto;min-width:0}
.gallery-arrow{flex:0 0 auto;width:28px;height:28px;display:flex;align-items:center;justify-content:center;
  border:1px solid var(--bd);border-radius:50%;background:var(--sf);color:var(--tx);
  font-size:17px;line-height:1;cursor:pointer;padding:0;
  transition:border-color var(--e),opacity var(--e)}
.gallery-arrow:hover{border-color:var(--tx)}
/* Disabled at the ends rather than hidden — a control that vanishes makes the
   strip jump sideways as you reach the last thumbnail. */
.gallery-arrow:disabled{opacity:.3;cursor:default}
/* Nothing to page through: the arrows would be two dead circles. */
.gallery-striprail[data-fits="1"] .gallery-arrow{display:none}
/* One size everywhere, square, and aligned to the gallery's left edge. The
   strip used to inherit whatever the layout gave it, so the same product
   showed 64px thumbs in one style and stretched ones in another. */
/* The ring is QUIET until it means something. Every thumb used to carry a
   visible box, so the row read as a set of framed tiles and the selected one
   had to shout to stand out. Unselected thumbs now show no border at all; the
   selection is the only ring on screen and needs no extra weight to be found.
   The border is always 2px and only changes COLOUR, so selecting one cannot
   nudge the row by a pixel. */
.gallery-thumb{height:92px;border-radius:var(--radius-md);border:2px solid transparent;padding:0;overflow:hidden;cursor:pointer;background:var(--sf2);transition:border-color var(--e)}
.gallery-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.gallery-thumb:hover{border-color:var(--bd2)}
.gallery-thumb.sel{border-color:var(--ac-btn)}
.gallery-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.gallery-thumb.sel{border-color:var(--ac-btn)}
.product-desc{margin-top:22px;padding-top:18px;border-top:1px solid var(--bd);font-size:14px;color:var(--tx2);line-height:1.7}
/* PDP reviews — list + rating summary + submit form. */
.pdp-reviews{max-width:820px;margin:56px auto 0;padding:32px 20px 0;border-top:1px solid var(--bd)}
.pdp-reviews__h{font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin:0 0 16px;color:var(--tx)}
.pdp-reviews__summary{font-size:15px;color:var(--tx2);margin-bottom:20px;min-height:20px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.pdp-rstar{color:var(--bd2,#cfcfcf);font-size:15px;letter-spacing:1px}
.pdp-rstar.on{color:#f5b301}
.pdp-reviews__cnt{color:var(--tx3,var(--tx2));font-size:13px}
.pdp-reviews__none{color:var(--tx2);font-size:14px}
.pdp-reviews__list{display:flex;flex-direction:column;gap:18px;margin-bottom:8px}
.pdp-review{border-bottom:1px solid var(--bd);padding-bottom:16px}
.pdp-review__top{display:flex;align-items:center;flex-wrap:wrap;gap:10px;font-size:12px;color:var(--tx2)}
.pdp-review__verified{background:var(--sf2);border:1px solid var(--bd);border-radius:999px;padding:2px 10px;font-size:10px;letter-spacing:.04em;text-transform:uppercase;color:var(--tx2)}
.pdp-review__by{color:var(--tx3,var(--tx2));margin-left:auto}
.pdp-review__title{font-weight:700;font-size:15px;margin-top:8px;color:var(--tx)}
.pdp-review__body{font-size:14px;line-height:1.65;color:var(--tx2);margin-top:6px;white-space:pre-wrap}
.pdp-reviews__writewrap{margin-top:24px}
.pdp-reviews__writebtn{cursor:pointer;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--tx);list-style:none;display:inline-block;border:1px solid var(--bd);padding:12px 22px;border-radius:var(--th-btn-r,0)}
.pdp-reviews__writewrap[open] .pdp-reviews__writebtn{margin-bottom:18px}
.pdp-reviews__writebtn::-webkit-details-marker{display:none}
.pdp-reviews__form{display:flex;flex-direction:column;gap:12px;max-width:520px}
.pdp-reviews__stars{display:flex;gap:4px}
.pdp-star{background:none;border:none;cursor:pointer;font-size:26px;line-height:1;color:var(--bd2,#cfcfcf);padding:0;transition:color var(--e)}
.pdp-star.on{color:#f5b301}
.pdp-reviews__in{width:100%;padding:12px 14px;border:1px solid var(--bd);background:var(--sf2);color:var(--tx);font-family:var(--f);font-size:14px;border-radius:var(--th-btn-r,0)}
.pdp-reviews__body{min-height:90px;resize:vertical}
.pdp-reviews__msg{font-size:13px;color:var(--tx2);min-height:16px;margin:4px 0 0}
/* Card media: hover-video + arrow-flip */
.card-media{position:relative;overflow:hidden}
.card-media .card-still{width:100%;height:100%;object-fit:cover;display:block}
.card-media .card-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .25s ease;pointer-events:none}
.card-media.playing .card-video{opacity:1}
.card-nav{position:absolute;top:50%;transform:translateY(-50%);width:30px;height:30px;border-radius:50%;border:0;background:rgba(255,255,255,.85);color:var(--tx);font-size:18px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,.15);opacity:0;transition:opacity var(--e);z-index:2}
.card-nav.prev{left:8px}.card-nav.next{right:8px}
.card:hover .card-nav{opacity:1}
@media(hover:none){.card-nav{opacity:.9}}
.card-media.playing .card-nav,.card-media.playing .card-dots{opacity:0;pointer-events:none}
.card-dots{position:absolute;bottom:8px;left:50%;transform:translateX(-50%);display:flex;gap:5px;z-index:2}
.card-dots .dot{width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,.6);box-shadow:0 0 2px rgba(0,0,0,.3)}
.card-dots .dot.on{background:#fff}
/* Product-page gallery video */
.gallery-main video{width:100%;height:100%;object-fit:cover;display:block}
.gallery-thumb{position:relative}
.gallery-thumb .play-badge{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:18px;background:rgba(0,0,0,.25);pointer-events:none}
.taxonomy-row{margin-top:16px;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.taxonomy-row .pill:hover{background:#eee;color:var(--tx)}
/* ── REMOVABLE PILLS ────────────────────────────────────────────────────
   A category or tag the shopper is filtered BY carries its own dismiss, so
   getting out of a filter is one tap on the thing that put you in it —
   rather than hunting for a Clear that drops every other filter with it. */
.pill--rm{padding-right:5px;gap:4px}
.pill__x{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;
  margin-left:2px;border:0;border-radius:50%;background:transparent;color:inherit;
  font:inherit;font-size:13px;line-height:1;cursor:pointer;opacity:.55;
  transition:opacity .15s ease,background .15s ease;text-decoration:none}
.pill__x:hover{opacity:1;background:rgba(0,0,0,.10)}
.pill__x:focus-visible{outline:2px solid currentColor;outline-offset:1px}
.price-big{font-size:24px;font-weight:700;font-variant-numeric:tabular-nums;margin:10px 0 4px}
.stock-note{font-size:13px;color:var(--tx2);margin-bottom:18px}
`;

// The client cart runtime: token in localStorage, all calls same-origin.
const RUNTIME = `
const CART_KEY='therum_cart_token';
function tok(){return localStorage.getItem(CART_KEY)}
function setTok(t){t?localStorage.setItem(CART_KEY,t):localStorage.removeItem(CART_KEY)}
async function api(path,opts={}){
  const headers={'content-type':'application/json',...(opts.headers||{})};
  if(opts.useToken&&tok())headers['x-cart-token']=tok();
  // Timeout, always: the checkout's wallet-sheet callback settles through this
  // function, and a hung request there pins the native sheet on "Processing…"
  // until the OS gives up. Guarded — older WebKit lacks AbortSignal.timeout.
  const signal=(window.AbortSignal&&AbortSignal.timeout)?AbortSignal.timeout(15000):undefined;
  const res=await fetch('/api'+path,{...opts,headers,signal});
  const body=await res.json().catch(()=>({}));
  if(!res.ok)throw Object.assign(new Error(body?.error?.message||'Request failed'),{status:res.status});
  return body;
}
async function refreshCount(){
  const el=document.getElementById('cart-count');if(!el)return;
  if(!tok()){el.textContent='0';el.classList.add('empty');return}
  try{const c=await api('/cart',{useToken:true});
    const n=c.totals.lines.reduce((s,l)=>s+l.quantity,0);
    el.textContent=String(n);el.classList.toggle('empty',n===0);
  }catch(e){if(e.status===404){setTok(null)}el.textContent='0';el.classList.add('empty')}
}
async function addToCart(variantId,qty=1,btn){
  if(btn){btn.disabled=true;btn.textContent='Adding…'}
  try{
    const body={variantId,quantity:qty};if(tok())body.cartToken=tok();
    const r=await api('/cart/items',{method:'POST',body:JSON.stringify(body)});
    setTok(r.token);await refreshCount();
    // Refresh the PORTED header too: its .js-cart-info badges and drawer only
    // update on this event, and refreshCount() above only touches the fallback
    // header's #cart-count. Without it the item was added but the ported badge
    // stayed blank — "add to cart did nothing" on the live store.
    window.dispatchEvent(new CustomEvent('therum:cart-changed'));
    // Reveal the cart. Without this the badge ticked up and nothing else
    // happened, so adding from a product page felt like it had failed.
    if(window.__thCartOpen)window.__thCartOpen();
    if(btn){btn.textContent='Added ✓';setTimeout(()=>{btn.disabled=false;btn.textContent='Add to cart'},1200)}
  }catch(e){
    if(btn){btn.disabled=false;btn.textContent='Add to cart'}
    alert(e.message);
  }
}
document.addEventListener('DOMContentLoaded',refreshCount);
// Card media. The gallery arrows flip the stills; a motion card plays its
// video on hover. Which of those a card HAS is decided server-side by the card
// style (see productGrid.ts) — this script only drives whatever is present.
//
// It used to look for .card, a class the theme-shaped card does not carry.
// m.closest('.card') returned null and the addEventListener on it threw,
// which killed the hover-video binding AND every card after it in the loop —
// so the arrows never showed and the video never played. The card root is
// resolved from the real markup now, and skipped rather than thrown on.
document.addEventListener('DOMContentLoaded',function(){
  var canHover=window.matchMedia('(hover: hover)').matches;
  document.querySelectorAll('.card-media').forEach(function(m){
    var stills=[];try{stills=JSON.parse(m.dataset.stills||'[]')}catch(e){}
    // Which colourway each still belongs to, same order as stills. The gallery
    // runs colour by colour, so crossing into the next block means the card is
    // now showing a different colourway than the one the swatches claim.
    var stillColors=[];try{stillColors=JSON.parse(m.dataset.stillColors||'[]')}catch(e){}
    var img=m.querySelector('.card-still');
    var video=m.querySelector('.card-video');
    var dots=m.querySelectorAll('.card-dots .dot');
    var idx=0;
    // Arrows are tap-targets too — that IS the mobile story (no hover on
    // touch). They live inside the card <a>, so they must swallow the click
    // or every tap navigates.
    m.querySelectorAll('.card-nav').forEach(function(btn){
      btn.addEventListener('click',function(e){
        e.preventDefault();e.stopPropagation();
        if(!img||stills.length<2)return;
        // RE-SYNC BEFORE STEPPING. A colour swatch sets img.src directly, so
        // this counter goes stale the moment one is picked — stepping from the
        // old index made the first arrow click jump somewhere unrelated and
        // silently discard the chosen colourway.
        // Whatever is on screen now is the truth; find it and step from there.
        var here=stills.indexOf(img.getAttribute('src'));
        if(here>=0)idx=here;
        idx=(idx+Number(btn.dataset.dir)+stills.length)%stills.length;
        img.src=stills[idx];
        // Browsing the gallery IS leaving the chosen colourway behind, so the
        // card stops suppressing its hover preview.
        m.classList.remove('card-media--picked');
        dots.forEach(function(d,i){d.classList.toggle('on',i===idx)});
        // THE SWATCH FOLLOWS THE CAROUSEL. Step past the last angle of the red
        // hat and the next shot is a black one — the selected swatch has to
        // move with it, or the card shows one colour and claims another, and
        // Buy now would add the colour you are no longer looking at.
        var col=stillColors[idx];
        if(col)m.dispatchEvent(new CustomEvent('therum:gallery-color',{bubbles:true,detail:{color:col}}));
      });
    });
    if(video&&canHover){
      // Bound to the MEDIA, not the whole card: entering the card anywhere —
      // including reaching for a colour swatch — used to start playback and
      // hold it there while you clicked. The video belongs to the picture.
      m.addEventListener('mouseenter',function(){
        m.classList.add('playing');
        video.play().catch(function(){});
      });
      m.addEventListener('mouseleave',function(){
        m.classList.remove('playing');
        video.pause();video.currentTime=0;
      });
    }
  });
});
`;

/**
 * Head metadata for a store page.
 *
 * Storefront pages shipped with nothing but a <title>: no description, no
 * canonical, no og: tags. For a shop that is money — a product shared to a
 * message thread or a story came through as a bare URL with no image, no name
 * and no price.
 *
 * `noindex` exists because the correct answer for /cart, /checkout, /account
 * and a receipt is not a canonical URL, it is "do not index this at all".
 * Those pages are per-shopper and some carry an access token.
 */
export interface SeoMeta {
  description?: string;
  /** Path or absolute URL. Combined with `origin` to emit an absolute og:url. */
  canonical?: string;
  /** Absolute or root-relative image URL for social cards. */
  image?: string;
  /** og:type — 'website' for listings, 'product' for a PDP. */
  type?: 'website' | 'product' | 'article';
  /** Scheme + host of the current request, so og:url can be absolute. */
  origin?: string;
  siteName?: string;
  noindex?: boolean;
  /** Minor units. Emitted as product:price for rich results. */
  priceMinor?: number;
  currency?: string;
}

function seoTags(title: string, seo?: SeoMeta): string {
  if (!seo) return '';
  const abs = (u?: string): string | undefined => {
    if (!u) return undefined;
    if (/^https?:\/\//i.test(u)) return u;
    return seo.origin ? seo.origin.replace(/\/$/, '') + u : undefined;
  };
  const out: string[] = [];
  if (seo.noindex) {
    // Keep these out of the index entirely, and out of link previews.
    out.push('<meta name="robots" content="noindex,nofollow">');
    return out.join('\n');
  }
  if (seo.description) {
    out.push(`<meta name="description" content="${esc(seo.description)}">`);
    out.push(`<meta property="og:description" content="${esc(seo.description)}">`);
  }
  const canonical = abs(seo.canonical);
  if (canonical) {
    out.push(`<link rel="canonical" href="${esc(canonical)}">`);
    out.push(`<meta property="og:url" content="${esc(canonical)}">`);
  }
  out.push(`<meta property="og:title" content="${esc(title)}">`);
  out.push(`<meta property="og:type" content="${esc(seo.type ?? 'website')}">`);
  if (seo.siteName) out.push(`<meta property="og:site_name" content="${esc(seo.siteName)}">`);
  const image = abs(seo.image);
  if (image) {
    out.push(`<meta property="og:image" content="${esc(image)}">`);
    out.push('<meta name="twitter:card" content="summary_large_image">');
  } else {
    out.push('<meta name="twitter:card" content="summary">');
  }
  if (typeof seo.priceMinor === 'number') {
    out.push(`<meta property="product:price:amount" content="${(seo.priceMinor / 100).toFixed(2)}">`);
    out.push(`<meta property="product:price:currency" content="${esc(seo.currency ?? 'USD')}">`);
  }
  return out.join('\n');
}

export interface StoreChrome {
  /** Pre-rendered site header markup (the ported theme's own header). */
  header?: string;
  footer?: string;
  /** The ported theme stylesheet, so the chrome is styled like the rest of the site. */
  cssUrl?: string;
  /** Settings > Counter — how the ported header's icons behave. */
  headerIcons?: HeaderCartConfig;
}

/**
 * Store pages inside the SITE's chrome.
 *
 * The storefront used to render its own header ("Therum Store") and footer,
 * so a shopper who clicked through from the homepage arrived at what looked
 * like a different website — different logo, different nav, no way back into
 * the content pages. The store is part of the site, not a neighbouring app.
 *
 * The storefront's own CSS and runtime still load: they carry the cart, the
 * filters and the product-card behaviour, none of which the site chrome knows
 * about. Only the frame is replaced.
 */
export function layout(title: string, body: string, extraScript = '', chrome?: StoreChrome, seo?: SeoMeta, siteMax?: string, btnRadius?: string): string {
  const header = chrome?.header
    ? `<div id="brx-header">${chrome.header}</div>`
    : `<header class="site"><div class="wrap">
  <a class="brand" href="/shop"><span class="dot"></span>Therum Store</a>
  <nav class="main">
    <a href="/shop">Shop</a>
    <a class="cartlink" href="/cart">Cart <span id="cart-count" class="empty">0</span></a>
  </nav>
</div></header>`;
  const footer = chrome?.footer
    ? `<div id="brx-footer">${chrome.footer}</div>`
    : `<footer class="site"><div class="wrap">Powered by Counter · Therum OS</div></footer>`;
  // The ported theme asks for Manrope by name; the stylesheet alone does not
  // fetch the face. Content pages link it in siteHtml.ts — without the same
  // link here, the shared header and footer rendered in -apple-system on shop
  // and order-tracking while every other page used Manrope.
  const themeCss = chrome?.cssUrl
    ? `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@200..800&display=swap"><link rel="stylesheet" href="${esc(chrome.cssUrl)}">`
    : '';
  // Only the ported header carries the cart/search/wishlist hooks; the
  // fallback chrome above has its own plain cart link and needs none of it.
  const headerIcons = chrome?.header ? chrome.headerIcons ?? HEADER_CART_DEFAULTS : null;
  return layoutInner(title, body, extraScript, header, footer, themeCss, headerIcons, seo, siteMax, btnRadius);
}

function layoutInner(title: string, body: string, extraScript: string, header: string, footer: string, themeCss: string, headerIcons: HeaderCartConfig | null = null, seo?: SeoMeta, siteMax?: string, btnRadius?: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="facebook-domain-verification" content="9t3nhx1yw9xijatt76fw2lzktpi878">
<title>${esc(title)}</title>
${seoTags(title, seo)}
${themeCss}
<style>:root{--th-site-max:${siteMax ?? '1080px'};--th-btn-r:${btnRadius ?? '0'}}${CSS}${BANNER_STYLES}${PRODUCT_GRID_FALLBACK_CSS}${CHECKOUT_FLOW_CSS}${SHOP_TOOLBAR_CSS}${WISHLIST_CSS}${ACCOUNT_CSS}${headerIcons ? HEADER_CART_CSS + MOBILE_MENU_CSS : ''}</style>
</head>
<body>
<div id="th-shell">
${header}
<main${themeCss ? ' id="brx-content"' : ''}><div class="wrap">
${body}
</div></main>
${footer}
</div>
<script>(function(){try{if(document.cookie.indexOf('th_src=')<0){var q=new URLSearchParams(location.search),src=q.get('utm_source')||q.get('ref')||'';if(!src&&document.referrer){try{var h=new URL(document.referrer).hostname;if(h&&h!==location.hostname)src=h;}catch(e){}}if(src){var camp=q.get('utm_campaign');if(camp)src+=' / '+camp;document.cookie='th_src='+encodeURIComponent(src.slice(0,120))+'; path=/; max-age=2592000; samesite=lax';}}}catch(e){}})();${RUNTIME}${BANNER_RUNTIME}${WISHLIST_RUNTIME}${SUBSCRIBE_SCRIPT}${extraScript}</script>
${headerIcons ? `<script>${headerCartRuntime(headerIcons)}</script><script>${MOBILE_MENU_RUNTIME}</script>` : ''}
</body>
</html>`;
}

export function closedPage(): string {
  return layout('Store', `
  <div class="empty-state">
    <div class="big">🕒</div>
    <h1 class="page-title">The store isn't open yet</h1>
    <p class="page-sub">Check back soon.</p>
  </div>`);
}

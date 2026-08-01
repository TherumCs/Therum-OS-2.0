import { BANNER_RUNTIME, BANNER_STYLES } from './bannerRuntime.js';
import { PRODUCT_GRID_FALLBACK_CSS } from './productGrid.js';
import { CHECKOUT_FLOW_CSS } from './checkoutFlow.js';
import { SHOP_TOOLBAR_CSS } from './shopToolbar.js';
import { HEADER_CART_CSS, headerCartRuntime, HEADER_CART_DEFAULTS, type HeaderCartConfig } from './headerCart.js';
import { WISHLIST_CSS, WISHLIST_RUNTIME } from './wishlist.js';
import { ACCOUNT_CSS } from './accountPage.js';
// Counter C4 — storefront HTML layer. Server-rendered, zero client
// framework: pages are plain HTML strings + a small vanilla-JS cart runtime
// (below) that talks to the existing /api/cart + /api/checkout routes.
// All colors/type/spacing come from the real 1.9.44 token values
// (shared/therum-tokens.css) — the storefront is the public face of the same
// design system the admin chrome uses: #fafafa canvas, white surfaces,
// near-black ink, blue action buttons (--ac-btn), red reserved for brand.

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

export function money(minor: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(minor / 100);
}

const CSS = `
:root{
  --ac:#e83b3b;--ac-btn:#3858e9;--ac-btn-h:#2e45c5;
  --sf:#ffffff;--sf2:#f5f5f5;--bd:rgba(0,0,0,0.08);--bd2:rgba(0,0,0,0.16);
  --bg:#fafafa;--tx:#0a0a0a;--tx2:#666666;--tx3:#999999;
  --ok:#10b981;--err:#ef4444;
  --f:-apple-system,BlinkMacSystemFont,'Inter','Helvetica Neue',Arial,sans-serif;
  --e:0.15s ease;--radius-sm:6px;--radius-md:10px;--radius-lg:14px;--radius-pill:999px;
}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--f);background:var(--bg);color:var(--tx);line-height:1.55;-webkit-font-smoothing:antialiased}
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
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;background:var(--ac-btn);color:#fff;border:0;border-radius:var(--radius-md);padding:11px 20px;font-size:14px;font-weight:600;font-family:var(--f);cursor:pointer;transition:background var(--e)}
.btn:hover{background:var(--ac-btn-h)}
.btn:disabled{opacity:0.5;cursor:default}
.btn.ghost{background:transparent;color:var(--tx);border:1px solid var(--bd2)}
.btn.ghost:hover{background:var(--sf2)}
.btn.sm{padding:7px 12px;font-size:13px}
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
.method-row.active{border-color:var(--ac-btn);background:rgba(56,88,233,0.06)}
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
.crypto-chip.active{border-color:var(--ac-btn);background:rgba(56,88,233,0.06)}
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
.gallery-strip{display:flex;gap:8px;flex-wrap:wrap}
.gallery-thumb{width:64px;height:64px;border-radius:var(--radius-md);border:2px solid transparent;padding:0;overflow:hidden;cursor:pointer;background:var(--sf2)}
.gallery-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.gallery-thumb.sel{border-color:var(--ac-btn)}
.product-desc{margin-top:22px;padding-top:18px;border-top:1px solid var(--bd);font-size:14px;color:var(--tx2);line-height:1.7}
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
.taxonomy-row{margin-top:16px;display:flex;gap:6px;flex-wrap:wrap}
.taxonomy-row .pill:hover{background:#eee;color:var(--tx)}
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
  const res=await fetch('/api'+path,{...opts,headers});
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
    var img=m.querySelector('.card-still');
    var video=m.querySelector('.card-video');
    var dots=m.querySelectorAll('.card-dots .dot');
    var card=m.closest('.c-product-grid__item')||m.closest('.card')||m;
    var idx=0;
    // Arrows are tap-targets too — that IS the mobile story (no hover on
    // touch). They live inside the card <a>, so they must swallow the click
    // or every tap navigates.
    m.querySelectorAll('.card-nav').forEach(function(btn){
      btn.addEventListener('click',function(e){
        e.preventDefault();e.stopPropagation();
        if(!img||stills.length<2)return;
        idx=(idx+Number(btn.dataset.dir)+stills.length)%stills.length;
        img.src=stills[idx];
        dots.forEach(function(d,i){d.classList.toggle('on',i===idx)});
      });
    });
    if(video&&canHover){
      card.addEventListener('mouseenter',function(){
        m.classList.add('playing');
        video.play().catch(function(){});
      });
      card.addEventListener('mouseleave',function(){
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
export function layout(title: string, body: string, extraScript = '', chrome?: StoreChrome, seo?: SeoMeta, siteMax?: string): string {
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
  const themeCss = chrome?.cssUrl ? `<link rel="stylesheet" href="${esc(chrome.cssUrl)}">` : '';
  // Only the ported header carries the cart/search/wishlist hooks; the
  // fallback chrome above has its own plain cart link and needs none of it.
  const headerIcons = chrome?.header ? chrome.headerIcons ?? HEADER_CART_DEFAULTS : null;
  return layoutInner(title, body, extraScript, header, footer, themeCss, headerIcons, seo, siteMax);
}

function layoutInner(title: string, body: string, extraScript: string, header: string, footer: string, themeCss: string, headerIcons: HeaderCartConfig | null = null, seo?: SeoMeta, siteMax?: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${seoTags(title, seo)}
${themeCss}
<style>:root{--th-site-max:${siteMax ?? '1080px'}}${CSS}${BANNER_STYLES}${PRODUCT_GRID_FALLBACK_CSS}${CHECKOUT_FLOW_CSS}${SHOP_TOOLBAR_CSS}${WISHLIST_CSS}${ACCOUNT_CSS}${headerIcons ? HEADER_CART_CSS : ''}</style>
</head>
<body>
<div id="th-shell">
${header}
<main${themeCss ? ' id="brx-content"' : ''}><div class="wrap">
${body}
</div></main>
${footer}
</div>
<script>${RUNTIME}${BANNER_RUNTIME}${WISHLIST_RUNTIME}${extraScript}</script>
${headerIcons ? `<script>${headerCartRuntime(headerIcons)}</script>` : ''}
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

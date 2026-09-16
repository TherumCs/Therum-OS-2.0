// Category page templates — the editorial layer on top of the product grid.
//
// Two shapes, from the approved wireframe ("Page Templates v2"):
//   • Template 1 (grid)       — department page. ONE continuous product grid; an
//     editorial shot is a grid cell that spans TWO of the four columns, with two
//     products filling the rest of that row. The four-up grid is never broken —
//     editorial takes 2 slots, products take 2 slots, same 4 columns.
//   • Template 2 (collection) — a line/landing page: editorial-first. Hero, an
//     intro/concept, a lookbook (big shot + hero products), alternating story
//     blocks, then a "shop the collection" grid + a shop-all link.
//
// Every editorial slot is DATA, not baked in — a page with no editorial images
// configured degrades to a clean product grid (Template 1) or hero + intro +
// grid (Template 2). Drop image URLs into the per-category config in
// categoryPages.ts and the slots fill; leave them out and the slot collapses.
// A missing shot must never leave a broken box on a live page.

import { productCard, productGrid, thumbUrl, type GridProduct, type CardConfig } from './productGrid.js';
import type { CategoryPage } from './categoryPages.js';
import { esc } from './html.js';

const fig = (src: string, cls = ''): string =>
  `<figure class="ct-ed${cls ? ` ${cls}` : ''}"><img src="${esc(src)}" alt="" loading="lazy"></figure>`;

/** An editorial cell that lives ON the product grid, spanning two columns. */
const edCell = (src: string): string =>
  `<figure class="ct-ed-cell"><img src="${esc(src)}" alt="" loading="lazy"></figure>`;

/** A full-width editorial band spanning all columns — the periodic "hero" beat. */
const edBand = (src: string): string =>
  `<figure class="ct-ed-band"><img src="${esc(src)}" alt="" loading="lazy"></figure>`;

// Department rhythm (locked): a clean four-up row, then an editorial beat, on
// repeat. Editorial beats alternate LEFT/RIGHT (a 2-slot cell + 2 products);
// every HERO_EVERY-th beat is a full-width band instead of a 2-slot cell.
// ROWS_BETWEEN clean product rows sit between beats. Tune these two numbers to
// change the cadence for every department at once.
const ROWS_BETWEEN = 1;
const HERO_EVERY = 3;

/** The exact product-grid shell (from productGrid.ts) so data-cols styling and
 *  the responsive column steps apply to our hand-assembled list of children. */
function gridShell(inner: string, perRow: number, cfg: CardConfig, count: number): string {
  return '<div class="c-product-grid"><div class="c-product-grid__wrap c-product-grid__wrap--' + perRow
    + '-per-row c-product-grid__wrap--1-per-row-mobile c-product-grid__wrap--boxed c-product-grid__wrap--cnt-' + count + '">'
    + '<div class="c-product-grid__list c-product-grid__list--' + perRow
    + '-per-row c-product-grid__list--boxed c-product-grid__list--1-per-row-mobile card-gap-' + cfg.gap + '"'
    + ' data-cols="' + perRow + '" data-count="' + count + '" data-layout="' + perRow
    + '-per-row" data-layout-width="boxed" data-layout-mobile="1-per-row-mobile">'
    + inner + '</div></div></div>';
}

/**
 * Template 1 — one continuous four-up grid with editorial shots woven in as
 * two-column cells. A clean row of products opens; then each editorial shot
 * takes two slots with two products beside it (a full 4-column row), followed
 * by another clean row. Falls back to a plain grid when there are no shots or
 * the store runs fewer than 3 columns (where a 2-slot cell has no room beside
 * it).
 */
export function weaveDepartment(products: GridProduct[], perRow: number, cfg: CardConfig, editorial: string[] = []): string {
  const shots = editorial.filter(Boolean);
  if (!shots.length || perRow < 3) return productGrid(products, perRow, cfg);
  const items: string[] = [];
  let pi = 0;
  let si = 0;
  const pushN = (n: number): void => { for (let k = 0; k < n && pi < products.length; k += 1) { items.push(productCard(products[pi]!, cfg, perRow)); pi += 1; } };

  const beatCards = perRow * 2 - 4; // cards that fill the rest of a 2×2 editorial beat (4 at perRow 4)
  // Open with a clean product row ONLY when the department has enough products
  // to also fill the first editorial beat beside the shot. A sparse department
  // (e.g. Womens) leads with the editorial so its cards are never starved —
  // otherwise the opening row eats them and the beat is left with holes.
  if (products.length >= perRow + beatCards) pushN(perRow);
  while (pi < products.length) {
    if (si < shots.length) {
      const src = shots[si]!;
      if ((si + 1) % HERO_EVERY === 0) {
        items.push(edBand(src)); // full-width hero beat
      } else {
        // The editorial shot is a 2-column × 2-row block (portrait-friendly);
        // the rest of that 4-wide × 2-tall beat is product cards, so the grid
        // never leaves a hole beside the shot. At perRow 4 that is exactly 4
        // cards (a 2×2), which is the rule: 2 x 2 x 2 x 2.
        items.push(edCell(src));
        pushN(beatCards);
      }
      si += 1;
      pushN(perRow * ROWS_BETWEEN); // clean row(s) between editorial beats
    } else {
      pushN(perRow); // shots exhausted — clean four-up to the end
    }
  }
  return gridShell(items.join(''), perRow, cfg, items.length);
}

/**
 * Template 2 — collection / landing page. Editorial-first: intro, optional
 * lookbook, optional story blocks, then the products. Copy comes from config
 * (falling back to the category blurb); images are optional and collapse when
 * absent. The hero itself is rendered by the caller (shared cat-hero).
 */
export function renderCollection(opts: {
  page: CategoryPage;
  title: string;
  products: GridProduct[];
  perRow: number;
  cfg: CardConfig;
  shopAllHref: string;
}): string {
  const { page, products, perRow, cfg, shopAllHref } = opts;
  const parts: string[] = [];
  let i = 0;
  const take = (n: number): GridProduct[] => { const s = products.slice(i, i + n); i += s.length; return s; };

  // No intro block in the grid — the concept now lives in the hero (title / short
  // line / longer line, Kith-style). Straight from hero into product/editorial.
  // Lookbook = the SAME four-up grid as a department weave: the editorial shot
  // spans two columns, the rest of the row is products. One grid rule for the
  // whole site — editorial 2 slots, products fill the rest, never a bespoke split.
  if (page.lookbook && products.length && perRow >= 3) {
    const beside = take(perRow - 2);
    const inner = edCell(page.lookbook) + beside.map((p) => productCard(p, cfg, perRow)).join('');
    parts.push(`<section class="ct-wrap">${gridShell(inner, perRow, cfg, perRow)}</section>`);
  }
  (page.story ?? []).forEach((b, n) => {
    const shot = b.image ? fig(b.image) : '';
    parts.push(`<section class="ct-wrap ct-story${n % 2 ? ' ct-story--flip' : ''}"><div class="ct-story__copy"><h3>${esc(b.title)}</h3><p>${esc(b.body)}</p></div>${shot}</section>`);
  });
  if (i < products.length) {
    parts.push(`<section class="ct-wrap ct-shop"><h2 class="ct-shop__h">Shop the collection</h2>${productGrid(products.slice(i), perRow, cfg)}<div class="ct-shopall"><a href="${esc(shopAllHref)}">Shop all →</a></div></section>`);
  } else if (products.length) {
    parts.push(`<section class="ct-wrap ct-shop"><div class="ct-shopall"><a href="${esc(shopAllHref)}">Shop all →</a></div></section>`);
  }
  return parts.join('\n');
}

// ── Landing-page product callouts (Zappos-style story CAROUSEL) ──
// A numbered gallery the shopper ARROWS THROUGH: each slide is one jersey's story
// (eyebrow + big title + body + spec rows) with the piece on the other side,
// sides alternating. Two CTAs per slide — "Shop the piece" → that jersey's PDP,
// and "Shop the collection" → jumps down to the product grid (#shop-grid). Ships
// its own <style>; the arrows are wired by CALLOUT_RUNTIME. A missing image
// renders a labelled placeholder panel, never a broken box — so the page can be
// laid out before the art exists.
const CALLOUT_CSS = '<style>'
  + '.cta-wrap{max-width:var(--th-site-max,1080px);margin:46px auto 10px;padding:0 16px;box-sizing:border-box}'
  + '.cta-carousel{position:relative;overflow:hidden}'
  + '.cta-track{display:flex;transition:transform .5s cubic-bezier(.4,0,.2,1);will-change:transform}'
  + '.cta-block{flex:0 0 100%;min-width:0;display:grid;grid-template-columns:1fr 1.05fr;gap:clamp(24px,5vw,72px);align-items:center;padding:8px 0}'
  + '.cta-eyebrow{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--tx3,#999);margin:0 0 14px;font-weight:600}'
  + '.cta-title{font-size:clamp(30px,4.4vw,52px);line-height:1.02;letter-spacing:-.02em;font-weight:800;margin:0 0 18px;text-wrap:balance}'
  + '.cta-body{font-size:15px;line-height:1.7;color:var(--tx2,#555);margin:0 0 28px;max-width:46ch}'
  + '.cta-actions{display:flex;flex-wrap:wrap;gap:12px}'
  // The mobile duplicate is hidden on desktop; the media query below flips which
  // set shows so the CTAs sit below the jersey only on a phone.
  + '.cta-actions--m{display:none}'
  + '.cta-go{display:inline-flex;align-items:center;gap:8px;border-radius:999px;padding:12px 26px;font-weight:600;font-size:13px;text-decoration:none;transition:background .15s ease,color .15s ease,border-color .15s ease}'
  + '.cta-go--solid{background:var(--tx,#111);color:var(--bg,#fff);border:1.5px solid var(--tx,#111)}'
  + '.cta-go--solid:hover{background:var(--tx2,#333)}'
  + '.cta-go--ghost{border:1.5px solid var(--tx,#111);color:var(--tx,#111)}'
  + '.cta-go--ghost:hover{background:var(--tx,#111);color:var(--bg,#fff)}'
  + '.cta-media{position:relative;background:var(--sf2,#f0efec);border-radius:16px;overflow:hidden;aspect-ratio:4/5;display:flex;align-items:center;justify-content:center}'
  + '.cta-media img{width:100%;height:100%;object-fit:cover;display:block}'
  + '.cta-ph{color:var(--tx3,#999);font-size:12px;letter-spacing:.14em;text-transform:uppercase;font-weight:600}'
  // Arrows + counter live ON the media, top-right — where the 01 index used to
  // sit — so the control reads as part of the card, not floating under it.
  + '.cta-ctrls{position:absolute;top:16px;right:16px;z-index:2;display:flex;align-items:center;gap:7px}'
  + '.cta-nav{width:34px;height:34px;border-radius:999px;border:1px solid rgba(0,0,0,.14);background:rgba(255,255,255,.9);color:var(--tx,#111);font-size:14px;line-height:1;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:background .15s,color .15s;-webkit-backdrop-filter:blur(5px);backdrop-filter:blur(5px)}'
  + '.cta-nav:hover{background:var(--tx,#111);color:#fff}'
  + '.cta-count{font-size:12px;font-weight:700;color:var(--tx,#111);font-variant-numeric:tabular-nums;letter-spacing:.02em;background:rgba(255,255,255,.9);border-radius:999px;padding:6px 9px;-webkit-backdrop-filter:blur(5px);backdrop-filter:blur(5px)}'
  // Jersey selector strip (the "timeline"): all pieces as small thumbs/numbers;
  // click one to jump the carousel to it; the active one lifts. Arrows sync it.
  + '.cta-strip{display:flex;gap:10px;margin:24px 0 2px;flex-wrap:wrap;justify-content:center}'
  + '.cta-dot{width:52px;height:64px;border-radius:9px;border:1px solid var(--bd,rgba(0,0,0,.1));background:var(--sf2,#f0efec);overflow:hidden;cursor:pointer;padding:0;position:relative;opacity:.5;transition:opacity .15s,border-color .15s,transform .15s;display:flex;align-items:center;justify-content:center}'
  + '.cta-dot:hover{opacity:.85}'
  + '.cta-dot.is-active{opacity:1;border-color:var(--tx,#111);transform:translateY(-2px)}'
  + '.cta-dot img{width:100%;height:100%;object-fit:cover;display:block}'
  + '.cta-dot span{font-size:13px;font-weight:700;color:var(--tx2,#555);font-variant-numeric:tabular-nums}'
  + '.cta-dot.is-active span{color:var(--tx,#111)}'
  // Mobile: single column, everything centred. Copy (eyebrow / name / paragraph)
  // stays above the jersey; the desktop CTA set inside the copy is hidden and the
  // mobile set below the media shows. The image drops its fixed crop box
  // (aspect-ratio:auto + object-fit:contain) so the whole jersey shows, uncropped.
  + '@media(max-width:760px){'
  + '.cta-block{grid-template-columns:1fr;gap:16px;text-align:center}'
  + '.cta-copy .cta-actions{display:none}'
  + '.cta-actions--m{display:flex;justify-content:center;flex-wrap:wrap;gap:12px;margin-top:2px}'
  + '.cta-body{margin-left:auto;margin-right:auto}'
  + '.cta-media{aspect-ratio:auto;background:transparent}'
  + '.cta-media img{height:auto;object-fit:contain}'
  + '.cta-dot{width:46px;height:56px}'
  + '}'
  + '</style>';

/** Landing callout CAROUSEL (jersey stories) for a category page. Returns '' when none.
 *  Arrows sit on the media top-right; one arrow set per slide, all wired together. */
export function renderCallouts(callouts: CategoryPage['callouts'] = []): string {
  const list = (callouts ?? []).filter((c) => c && c.title);
  if (!list.length) return '';
  const N = list.length;
  const total = String(N).padStart(2, '0');
  const slides = list.map((c) => {
    const media = c.image
      ? `<img src="${esc(c.image)}" alt="${esc(c.title)}" loading="lazy">`
      : '<span class="cta-ph">Product image</span>';
    const piece = c.ctaHref
      ? `<a class="cta-go cta-go--solid" href="${esc(c.ctaHref)}">${esc(c.ctaLabel ?? 'Shop the piece')} <span aria-hidden="true">→</span></a>`
      : '';
    // Two CTAs, built once and rendered twice: inside the copy for desktop
    // (beside the image) and again after the media for mobile. The CSS shows
    // exactly one set per breakpoint, so on a phone the buttons land BELOW the
    // jersey while the eyebrow / name / paragraph stay above it.
    const actions = (extra: string) =>
      `<div class="cta-actions${extra}">`
      + piece
      + '<a class="cta-go cta-go--ghost" href="#shop-grid">Shop the collection <span aria-hidden="true">↓</span></a>'
      + '</div>';
    const ctrls = N > 1
      ? '<div class="cta-ctrls">'
        + '<button type="button" class="cta-nav" data-cta-prev aria-label="Previous jersey">←</button>'
        + `<span class="cta-count"><span data-cta-cur>01</span>&nbsp;/&nbsp;${total}</span>`
        + '<button type="button" class="cta-nav" data-cta-next aria-label="Next jersey">→</button>'
        + '</div>'
      : '';
    return '<section class="cta-block">'
      + '<div class="cta-copy">'
      + (c.eyebrow ? `<div class="cta-eyebrow">${esc(c.eyebrow)}</div>` : '')
      + `<h2 class="cta-title">${esc(c.title)}</h2>`
      + `<p class="cta-body">${esc(c.body)}</p>`
      + actions('')
      + '</div>'
      + `<div class="cta-media">${ctrls}${media}</div>`
      + actions(' cta-actions--m')
      + '</section>';
  }).join('');
  const strip = list.map((c, n) =>
    `<button type="button" class="cta-dot${n === 0 ? ' is-active' : ''}" data-cta-dot="${n}" aria-label="Jersey ${n + 1}">`
    + (c.image ? `<img src="${esc(thumbUrl(c.image))}" alt="">` : `<span>${String(n + 1).padStart(2, '0')}</span>`)
    + '</button>').join('');
  const stripHtml = N > 1 ? `<div class="cta-strip">${strip}</div>` : '';
  return `${CALLOUT_CSS}<div class="cta-wrap"><div class="cta-carousel" data-cta-carousel><div class="cta-track">${slides}</div></div>${stripHtml}</div>`;
}

/** Runtime for the callout carousel: prev/next arrows (each slide carries a set)
 *  plus the jersey selector strip (click a thumb to jump). Syncs every counter
 *  and the active thumb. Inline-injected via layout()'s script slot. */
export const CALLOUT_RUNTIME = '(function(){var w=document.querySelector("[data-cta-carousel]");if(!w)return;var wrap=w.closest(".cta-wrap")||w;var t=w.querySelector(".cta-track");if(!t)return;var n=t.children.length;if(n<2)return;var i=0;var dots=wrap.querySelectorAll("[data-cta-dot]");function pad(x){return(x<10?"0":"")+x;}function go(k){i=(k%n+n)%n;t.style.transform="translateX("+(-i*100)+"%)";var cs=w.querySelectorAll("[data-cta-cur]");for(var j=0;j<cs.length;j++)cs[j].textContent=pad(i+1);for(var d=0;d<dots.length;d++)dots[d].classList.toggle("is-active",d===i);}function bind(sel,dl){var es=w.querySelectorAll(sel);for(var a=0;a<es.length;a++)es[a].addEventListener("click",function(){go(i+dl);});}bind("[data-cta-prev]",-1);bind("[data-cta-next]",1);for(var q=0;q<dots.length;q++)(function(x){dots[x].addEventListener("click",function(){go(x);});})(q);})();';

// ── Varied story sections (Kith-style) ──
// An ordered kit of layout blocks a seasonal page stacks to break the uniform
// grid and tell the collection's story while staying shoppable:
//   • band  — full-bleed image beat with a line of story + CTA over it
//   • split — a wide image beside a column of copy (half or two-thirds)
//   • story — a centred text beat: "this is the collection, who it's for"
// Every image is optional → a labelled placeholder panel, never a broken box, so
// the rhythm can be laid out before the art exists. No runtime — all static.
const SECTIONS_CSS = '<style>'
  + '.sx-band{position:relative;width:100vw;margin:56px 0 0 calc(50% - 50vw);min-height:56vh;display:flex;align-items:flex-end;background:#111;background-size:cover;background-position:center;color:#fff;overflow:hidden}'
  + '.sx-band--light{color:#0e0e0e}'
  + '.sx-band__ph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--tx3,#999);font-size:12px;letter-spacing:.14em;text-transform:uppercase;background:var(--sf2,#efeee9)}'
  + '.sx-band__in{position:relative;width:100%;max-width:var(--th-site-max,1080px);margin:0 auto;padding:0 24px 44px;box-sizing:border-box}'
  + '.sx-band__ey{font-size:11px;letter-spacing:.18em;text-transform:uppercase;opacity:.82;margin:0 0 12px;font-weight:600}'
  + '.sx-band__t{font-size:clamp(30px,5vw,60px);font-weight:800;letter-spacing:-.02em;line-height:1;margin:0;text-wrap:balance}'
  + '.sx-band__b{max-width:560px;margin:14px 0 0;font-size:15px;line-height:1.6;opacity:.92}'
  + '.sx-band__in{z-index:2}'
  + '.sx-band__video{position:absolute;inset:0;overflow:hidden;z-index:0}'
  + '.sx-band__video iframe{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:100vw;height:56.25vw;min-height:100%;min-width:177.78vh;border:0;pointer-events:none}'
  + '.sx-band__scrim{position:absolute;inset:0;background:rgba(0,0,0,.38);z-index:1}'
  + '.sx-band--center{align-items:center;text-align:center}'
  + '.sx-band--center .sx-band__in{padding-bottom:0}'
  + '.sx-split{max-width:var(--th-site-max,1080px);margin:56px auto 0;padding:0 16px;box-sizing:border-box;display:grid;grid-template-columns:1fr 1fr;gap:clamp(24px,4vw,56px);align-items:center}'
  + '.sx-split--wide{grid-template-columns:1.7fr 1fr}'
  + '.sx-split--flip.sx-split--wide{grid-template-columns:1fr 1.7fr}'
  + '.sx-split--flip .sx-split__media{order:2}'
  + '.sx-split__media{position:relative;background:var(--sf2,#efeee9);border-radius:16px;overflow:hidden;aspect-ratio:4/3}'
  + '.sx-split__media img{width:100%;height:100%;object-fit:cover;display:block}'
  + '.sx-split__ph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--tx3,#999);font-size:12px;letter-spacing:.14em;text-transform:uppercase}'
  + '.sx-split__ey{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--tx3,#999);margin:0 0 12px;font-weight:600}'
  + '.sx-split__t{font-size:clamp(26px,3.4vw,40px);font-weight:800;letter-spacing:-.02em;line-height:1.04;margin:0 0 14px;text-wrap:balance}'
  + '.sx-split__b{font-size:15px;line-height:1.7;color:var(--tx2,#555);margin:0 0 22px;max-width:44ch}'
  + '.sx-story{max-width:720px;margin:64px auto 0;padding:0 20px;box-sizing:border-box;text-align:center}'
  + '.sx-story__ey{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--tx3,#999);margin:0 0 16px;font-weight:600}'
  + '.sx-story__t{font-size:clamp(26px,3.8vw,44px);font-weight:800;letter-spacing:-.02em;line-height:1.06;margin:0 0 18px;text-wrap:balance}'
  + '.sx-story__b{font-size:16px;line-height:1.75;color:var(--tx2,#555);margin:0}'
  + '.sx-cta{display:inline-flex;align-items:center;gap:8px;border-radius:999px;padding:12px 26px;font-weight:600;font-size:13px;text-decoration:none;border:1.5px solid currentColor;transition:opacity .15s}'
  + '.sx-cta:hover{opacity:.7}'
  + '.sx-band .sx-cta{color:#fff}.sx-band--light .sx-cta{color:#0e0e0e}'
  + '.sx-split__copy .sx-cta{color:var(--tx,#111)}'
  + '@media(max-width:760px){.sx-split,.sx-split--wide,.sx-split--flip.sx-split--wide{grid-template-columns:1fr}.sx-split--flip .sx-split__media{order:0}.sx-band{min-height:46vh}}'
  + '</style>';

/** Render the ordered story sections (band / split / story). Returns '' when none. */
export function renderSections(sections: CategoryPage['sections'] = []): string {
  const list = (sections ?? []).filter(Boolean);
  if (!list.length) return '';
  // A YouTube id from a full url or a bare 11-char id, for band video backgrounds.
  const ytId = (v: string): string | null => {
    const m = /(?:youtu\.be\/|[?&]v=|embed\/|shorts\/)([A-Za-z0-9_-]{11})/.exec(v) ?? /^([A-Za-z0-9_-]{11})$/.exec(v.trim());
    return m?.[1] ?? null;
  };
  const cta = (label: string | undefined, href: string | undefined): string =>
    href ? `<a class="sx-cta" href="${esc(href)}">${esc(label ?? 'Shop')} <span aria-hidden="true">→</span></a>` : '';
  const blocks = list.map((s) => {
    if (s.type === 'band') {
      // A YouTube id wins over a still image: it renders as a muted, looping,
      // controls-less background (scaled to cover) under a dark scrim.
      const vid = s.video ? ytId(s.video) : null;
      const bg = !vid && s.image
        ? ` style="background-image:linear-gradient(rgba(0,0,0,${s.light ? '0' : '.15'}),rgba(0,0,0,${s.light ? '0' : '.5'})),url('${esc(s.image)}')"`
        : '';
      const cls = `sx-band${s.light ? ' sx-band--light' : ''}${s.center ? ' sx-band--center' : ''}${vid ? ' sx-band--video' : ''}`;
      const videoBg = vid
        ? `<div class="sx-band__video"><iframe src="https://www.youtube.com/embed/${vid}?autoplay=1&mute=1&controls=0&loop=1&playlist=${vid}&modestbranding=1&rel=0&playsinline=1&disablekb=1&fs=0&iv_load_policy=3&showinfo=0&start=1" title="${esc(s.title ?? '')}" frameborder="0" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen tabindex="-1" aria-hidden="true"></iframe></div><div class="sx-band__scrim"></div>`
        : '';
      return `<section class="${cls}"${bg}>`
        + (!vid && !s.image ? '<span class="sx-band__ph">Section image</span>' : '')
        + videoBg
        + '<div class="sx-band__in">'
        + (s.eyebrow ? `<div class="sx-band__ey">${esc(s.eyebrow)}</div>` : '')
        + (s.title ? `<h2 class="sx-band__t">${esc(s.title)}</h2>` : '')
        + (s.body ? `<p class="sx-band__b">${esc(s.body)}</p>` : '')
        + (s.ctaHref ? `<p style="margin:20px 0 0">${cta(s.ctaLabel, s.ctaHref)}</p>` : '')
        + '</div></section>';
    }
    if (s.type === 'split') {
      const flip = s.media === 'right';
      const wide = s.ratio === 'twothird';
      const media = s.image
        ? `<img src="${esc(s.image)}" alt="${esc(s.title)}" loading="lazy">`
        : '<span class="sx-split__ph">Section image</span>';
      return `<section class="sx-split${flip ? ' sx-split--flip' : ''}${wide ? ' sx-split--wide' : ''}">`
        + `<div class="sx-split__media">${media}</div>`
        + '<div class="sx-split__copy">'
        + (s.eyebrow ? `<div class="sx-split__ey">${esc(s.eyebrow)}</div>` : '')
        + `<h2 class="sx-split__t">${esc(s.title)}</h2>`
        + `<p class="sx-split__b">${esc(s.body)}</p>`
        + cta(s.ctaLabel, s.ctaHref)
        + '</div></section>';
    }
    return '<section class="sx-story">'
      + (s.eyebrow ? `<div class="sx-story__ey">${esc(s.eyebrow)}</div>` : '')
      + `<h2 class="sx-story__t">${esc(s.title)}</h2>`
      + `<p class="sx-story__b">${s.body}</p>`
      + (s.ctaHref ? `<p style="margin:22px 0 0">${cta(s.ctaLabel, s.ctaHref)}</p>` : '')
      + '</section>';
  }).join('');
  return `${SECTIONS_CSS}${blocks}`;
}

// ── Featured product rail ──
// A horizontal, arrow-scrolled rail of the collection's own products, sat under
// the jersey carousel and above the full grid — "here's a taste, the rest is
// below". Pulls this category's products (first 12); an empty collection shows
// placeholder cards so the rail's layout reads before there's product.
const FP_CSS = '<style>'
  + '.fp-wrap{max-width:var(--th-site-max,1080px);margin:56px auto 0;padding:0 16px;box-sizing:border-box}'
  + '.fp-head{margin:0 0 18px}'
  + '.fp-title{font-size:clamp(20px,2.6vw,30px);font-weight:800;letter-spacing:-.01em;margin:0;line-height:1}'
  // Traditional side arrows: overlaid on the left/right edges of the rail,
  // centred on the product image, floating a touch over the first/last card.
  + '.fp-rail{position:relative}'
  + '.fp-nav{position:absolute;top:38%;transform:translateY(-50%);z-index:3;width:42px;height:42px;border-radius:999px;border:1px solid var(--bd,rgba(0,0,0,.1));background:rgba(255,255,255,.94);color:var(--tx,#111);font-size:16px;line-height:1;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;box-shadow:0 4px 16px rgba(0,0,0,.14);transition:background .15s,color .15s}'
  + '.fp-nav:hover{background:var(--tx,#111);color:#fff}'
  + '.fp-nav--prev{left:-8px}'
  + '.fp-nav--next{right:-8px}'
  + '.fp-track{display:flex;gap:16px;overflow-x:auto;scroll-snap-type:x mandatory;scroll-behavior:smooth;-webkit-overflow-scrolling:touch;scrollbar-width:none;padding-bottom:4px}'
  + '.fp-track::-webkit-scrollbar{display:none}'
  + '.fp-slide{flex:0 0 clamp(220px,30%,280px);scroll-snap-align:start;min-width:0}'
  + '.fp-slide>*{width:100%}'
  + '.fp-ph{aspect-ratio:3/4;border-radius:var(--card-r,10px);background:var(--sf2,#efeee9);display:flex;align-items:center;justify-content:center;color:var(--tx3,#999);font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:600}'
  + '@media(max-width:560px){.fp-slide{flex-basis:66%}.fp-nav{display:none}}'
  + '</style>';

/** Horizontal featured/collection product rail. Real cards when products exist,
 *  placeholder cards otherwise. Returns '' only if suppressed by the caller. */
export function renderFeaturedRail(products: GridProduct[], cfg: CardConfig, opts?: { title?: string; placeholders?: number }): string {
  const title = opts?.title ?? 'In the collection';
  const cards = products.length
    ? products.slice(0, 12).map((p) => `<div class="fp-slide">${productCard(p, cfg, 4)}</div>`).join('')
    : Array.from({ length: opts?.placeholders ?? 5 }, () => '<div class="fp-slide"><div class="fp-ph"><span>Product</span></div></div>').join('');
  return `${FP_CSS}<section class="fp-wrap">`
    + `<div class="fp-head"><h2 class="fp-title">${esc(title)}</h2></div>`
    + '<div class="fp-rail">'
    + '<button type="button" class="fp-nav fp-nav--prev" data-fp-prev aria-label="Scroll left">←</button>'
    + `<div class="fp-track" data-fp-track>${cards}</div>`
    + '<button type="button" class="fp-nav fp-nav--next" data-fp-next aria-label="Scroll right">→</button>'
    + '</div></section>';
}

/** Arrow runtime for the featured rail — scrolls one card-width per click. */
export const FEATURED_RUNTIME = '(function(){var t=document.querySelector("[data-fp-track]");if(!t)return;var p=document.querySelector("[data-fp-prev]");var nx=document.querySelector("[data-fp-next]");function step(){var s=t.querySelector(".fp-slide");return(s?s.getBoundingClientRect().width:280)+16;}if(p)p.addEventListener("click",function(){t.scrollBy({left:-step(),behavior:"smooth"});});if(nx)nx.addEventListener("click",function(){t.scrollBy({left:step(),behavior:"smooth"});});})();';

export const CATEGORY_TPL_CSS = '<style>'
  // ── Template 1: editorial cell ON the four-up grid ──
  // Spans two columns so a row reads editorial(2) + product + product. The
  // responsive column steps (4→3→2→1) inherit automatically because the cell is
  // a real child of .c-product-grid__list; only the 1-column phone case needs an
  // override so a 2-col span does not spill into an implicit track.
  + '.ct-ed-cell{grid-column:span 2;grid-row:span 2;min-width:0;margin:0;overflow:hidden;border-radius:var(--card-r,0);background:var(--sf2,#ececec);position:relative}'
  + '.ct-ed-cell img{display:block;width:100%;height:100%;object-fit:cover}'
  + '@media(max-width:560px){.ct-ed-cell{grid-column:1/-1;grid-row:auto;aspect-ratio:16/10}}'
  // Full-width editorial band — the periodic hero beat, spans every column.
  + '.ct-ed-band{grid-column:1/-1;min-width:0;margin:0;overflow:hidden;border-radius:var(--card-r,0);background:var(--sf2,#ececec);position:relative;aspect-ratio:24/9}'
  + '.ct-ed-band img{display:block;width:100%;height:100%;object-fit:cover}'
  + '@media(max-width:560px){.ct-ed-band{aspect-ratio:16/9}}'
  // ── Template 2: collection blocks ──
  + '.ct-wrap{max-width:var(--th-site-max,1080px);margin:34px auto 0;padding:0 16px;box-sizing:border-box}'
  + '.ct-ed{margin:0;border-radius:14px;overflow:hidden;background:var(--sf2,#ececec);position:relative}'
  + '.ct-ed img{display:block;width:100%;height:100%;object-fit:cover}'
  + '.ct-story{display:grid;grid-template-columns:1fr 1fr;gap:26px;align-items:center}'
  + '.ct-story--flip .ct-story__copy{order:2}'
  + '.ct-story__copy h3{font-size:20px;font-weight:800;margin:0 0 10px}'
  + '.ct-story__copy p{font-size:15px;line-height:1.7;color:var(--tx2,#555);margin:0}'
  + '.ct-story .ct-ed{aspect-ratio:4/5}'
  + '.ct-shop__h{font-size:20px;font-weight:800;text-align:center;margin:0 0 18px}'
  + '.ct-shopall{display:flex;justify-content:center;margin-top:24px}'
  + '.ct-shopall a{border:1.5px solid var(--tx,#111);color:var(--tx,#111);border-radius:999px;padding:11px 24px;font-weight:600;font-size:13px;text-decoration:none;transition:background .15s,color .15s}'
  + '.ct-shopall a:hover{background:var(--tx,#111);color:var(--bg,#fff)}'
  + '@media(max-width:760px){.ct-story{grid-template-columns:1fr}.ct-story--flip .ct-story__copy{order:0}.ct-story .ct-ed{aspect-ratio:16/11}}'
  + '</style>';

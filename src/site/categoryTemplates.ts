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

import { productCard, productGrid, type GridProduct, type CardConfig } from './productGrid.js';
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

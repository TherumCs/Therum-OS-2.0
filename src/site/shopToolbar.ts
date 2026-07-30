import { esc } from './storefrontHtml.js';
// The shop toolbar — one flat bar that sits ON the page.
//
// Revised to Bam's notes:
//   * No card or shadow. A hairline outline only, so it reads as part of the
//     page rather than a panel floating on top of it.
//   * Focusing the search takes the bar over: the control row gets out of the
//     way and returns when the search is done. One job on screen at a time.
//   * Every control is the SAME shape and height — a pill that opens a
//     popover — so the row cannot wrap into the jumble it was before.
//     Category, Tags and Size are dropdowns; Size's popover is a grid of
//     chips, because sizes are a set you scan, not a list you read.
//   * The column slider is gone. It was a continuous control for a discrete
//     choice, and it had nowhere to sit once everything else was a pill.
//     Columns is now a popover of fixed counts, matching its neighbours.
//
// Filters and sort stay LINKS inside those popovers, so a filtered shop is
// still shareable and crawlable. View and column count stay client-side —
// per-device preferences that do not belong in a URL.

export interface ToolbarOption {
  label: string;
  href: string;
  active: boolean;
}
export interface ToolbarGroup {
  /** Pill label shown when nothing is chosen. */
  label: string;
  options: ToolbarOption[];
  /** Chips in a grid rather than a stacked list — used for sizes. */
  grid?: boolean;
}

export interface ShopToolbar {
  q: string;
  /** Hidden inputs so a search keeps the filters already applied. */
  keep: { name: string; value: string }[];
  groups: ToolbarGroup[];
  sort: ToolbarOption[];
  resultCount: number;
  clearHref?: string | null;
  /**
   * Which parts to render (Settings > Counter). Every one defaults ON, so an
   * existing caller that passes none gets the whole bar exactly as before.
   * A part that is off is not rendered at all rather than hidden with CSS —
   * a control nobody can see should not still be in the tab order.
   */
  show?: {
    search?: boolean;
    filters?: boolean;
    sort?: boolean;
    view?: boolean;
    count?: boolean;
  };
  /** Starting column count for the grid; shoppers can still change it. */
  columns?: number;
  /** Merchant-set placeholder; falls back to the generic one. */
  searchPlaceholder?: string;
  /** 'minimal' collapses the whole bar to icons until one is opened. */
  style?: 'bar' | 'minimal';
}

// Inline SVG rather than an icon font: the storefront ships no icon font, and
// a glyph that renders as a box on a machine missing the family is worse than
// no icon at all.
const ICONS: Record<string, string> = {
  search: '<circle cx="7.5" cy="7.5" r="5.2"/><line x1="11.4" y1="11.4" x2="15.5" y2="15.5"/>',
  filter: '<line x1="2.5" y1="5" x2="15.5" y2="5"/><line x1="4.5" y1="9" x2="13.5" y2="9"/><line x1="7" y1="13" x2="11" y2="13"/>',
  sort: '<line x1="3" y1="5" x2="12" y2="5"/><line x1="3" y1="9" x2="9" y2="9"/><line x1="3" y1="13" x2="6" y2="13"/><path d="M13 10.5 L15 13 L17 10.5"/>',
  view: '<rect x="2.5" y="2.5" width="5.5" height="5.5"/><rect x="10" y="2.5" width="5.5" height="5.5"/><rect x="2.5" y="10" width="5.5" height="5.5"/><rect x="10" y="10" width="5.5" height="5.5"/>',
};
const icon = (name: string): string =>
  `<svg class="sh-ico" viewBox="0 0 18 18" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">${ICONS[name] ?? ''}</svg>`;

function dropdown(g: ToolbarGroup, i: number): string {
  if (!g.options.length) return '';
  const chosen = g.options.find((o) => o.active);
  const id = `sh-pop-${i}`;
  return `
  <div class="sh-pill-wrap">
    <button class="sh-pill${chosen ? ' has' : ''}" type="button" aria-expanded="false" aria-controls="${id}">
      <span class="sh-pill__label">${g.label}</span>
      ${chosen ? `<span class="sh-pill__value">${chosen.label}</span>` : ''}
      <span class="sh-pill__caret" aria-hidden="true">⌄</span>
    </button>
    <div class="sh-pop${g.grid ? ' sh-pop--grid' : ''}" id="${id}" hidden>
      ${g.options.map((o) => `<a class="sh-opt${o.active ? ' on' : ''}" href="${o.href}">${o.label}</a>`).join('')}
    </div>
  </div>`;
}

export function shopToolbar(t: ShopToolbar): string {
  const on = {
    search: t.show?.search !== false,
    filters: t.show?.filters !== false,
    sort: t.show?.sort !== false,
    view: t.show?.view !== false,
    count: t.show?.count !== false,
  };
  const cols = t.columns ?? 4;
  const filters = on.filters ? t.groups.map(dropdown).join('') : '';
  const activeSort = t.sort.find((s) => s.active) ?? t.sort[0];

  const sort = on.sort && t.sort.length
    ? `
    <div class="sh-pill-wrap">
      <button class="sh-pill has" type="button" aria-expanded="false" aria-controls="sh-pop-sort">
        <span class="sh-pill__label">Sort</span>
        <span class="sh-pill__value">${activeSort ? activeSort.label : ''}</span>
        <span class="sh-pill__caret" aria-hidden="true">⌄</span>
      </button>
      <div class="sh-pop" id="sh-pop-sort" hidden>
        ${t.sort.map((o) => `<a class="sh-opt${o.active ? ' on' : ''}" href="${o.href}">${o.label}</a>`).join('')}
      </div>
    </div>`
    : '';

  const view = on.view
    ? `
      <div class="sh-segs" role="group" aria-label="View">
        <button class="sh-seg" type="button" data-view="grid" aria-label="Grid view">▦</button>
        <button class="sh-seg" type="button" data-view="list" aria-label="List view">☰</button>
      </div>
      <div class="sh-pill-wrap" data-cols-wrap>
        <button class="sh-pill" type="button" aria-expanded="false" aria-controls="sh-pop-cols">
          <span class="sh-pill__label">Columns</span>
          <span class="sh-pill__value" data-cols-value>${cols}</span>
          <span class="sh-pill__caret" aria-hidden="true">⌄</span>
        </button>
        <div class="sh-pop sh-pop--grid sh-pop--right" id="sh-pop-cols" hidden>
          ${[2, 3, 4, 5, 6].map((n) => `<button class="sh-opt" type="button" data-cols="${n}">${n}</button>`).join('')}
        </div>
      </div>`
    : '';

  const search = on.search
    ? `
  <form class="sh-search" action="/shop" method="get" role="search">
    <span class="sh-search__ico" aria-hidden="true">⌕</span>
    <input type="search" name="q" value="${t.q}" placeholder="${esc(t.searchPlaceholder ?? 'Search products…')}" aria-label="Search products" data-sh-search>
    ${t.keep.map((k) => `<input type="hidden" name="${k.name}" value="${k.value}">`).join('')}
    <button class="sh-search__cancel" type="button" data-sh-cancel hidden>Cancel</button>
  </form>`
    : '';

  const count = on.count
    ? `<span class="sh-count">${t.resultCount} product${t.resultCount === 1 ? '' : 's'}</span>
       ${t.clearHref ? `<a class="sh-clear" href="${t.clearHref}">Clear</a>` : ''}`
    : '';

  // With search off, the control row is the whole bar and needs its own top
  // edge back — otherwise the hairline it borrowed from the search field's
  // bottom leaves the row looking detached.
  const controls = filters || sort || view || count
    ? `
  <div class="sh-controls${search ? '' : ' sh-controls--only'}" data-sh-controls>
    <div class="sh-controls__left">${filters}${sort}</div>
    <div class="sh-controls__right">${view}${count}</div>
  </div>`
    : '';

  if (!search && !controls) return '';

  // ── MINIMAL ────────────────────────────────────────────────────────────
  // Icons only until one is used. Each icon toggles its own panel open and
  // shuts the others, so the toolbar occupies one row of icons rather than a
  // block of controls nobody is currently touching.
  //
  // The filter/sort panels reuse the SAME pill markup as the full bar — they
  // are the same controls in a different container, not a second
  // implementation that will drift.
  if (t.style === 'minimal') {
    const active = t.groups.some((g) => g.options.some((o) => o.active));
    const tab = (name: string, label: string, body: string, on = false): string =>
      body
        ? `<button class="sh-mini__btn${on ? ' has' : ''}" type="button" data-mini="${name}" aria-expanded="false" aria-label="${label}">${icon(name)}</button>`
        : '';

    return `
<div class="sh-bar sh-bar--mini" id="sh-bar" data-cols="${cols}">
  <div class="sh-mini__row">
    ${tab('search', 'Search', search, Boolean(t.q))}
    ${tab('filter', 'Filters', filters, active)}
    ${tab('sort', 'Sort', sort)}
    ${tab('view', 'View', view)}
    <span class="sh-mini__spacer"></span>
    ${count}
  </div>
  ${search ? `<div class="sh-mini__panel" data-mini-panel="search" hidden>${search}</div>` : ''}
  ${filters ? `<div class="sh-mini__panel" data-mini-panel="filter" hidden><div class="sh-controls__left">${filters}</div></div>` : ''}
  ${sort ? `<div class="sh-mini__panel" data-mini-panel="sort" hidden><div class="sh-controls__left">${sort}</div></div>` : ''}
  ${view ? `<div class="sh-mini__panel" data-mini-panel="view" hidden><div class="sh-controls__right">${view}</div></div>` : ''}
</div>`;
  }

  return `
<div class="sh-bar" id="sh-bar" data-cols="${cols}">${search}${controls}
</div>`;
}

export const SHOP_TOOLBAR_CSS = `

/* Flat: a hairline, no shadow, no card. It belongs to the page. */
.sh-bar{border:1px solid var(--ln,#e5e7eb);border-radius:12px;background:transparent;margin-bottom:24px}
.sh-search{display:flex;align-items:center;gap:10px;padding:12px 14px}
.sh-search__ico{font-size:18px;color:var(--tx3,#6b7280);line-height:1}
.sh-search input{flex:1;border:0;outline:0;background:transparent;font:inherit;font-size:15px;padding:6px 0}
.sh-search__cancel{border:0;background:transparent;color:var(--tx3,#6b7280);font:inherit;font-size:13px;cursor:pointer}
/* Searching takes over: the controls collapse rather than competing for the
   same glance. Animating max-height means it slides instead of snapping. */
.sh-controls{display:flex;align-items:center;gap:12px;padding:10px 14px;
  border-top:1px solid var(--ln,#e5e7eb);
  max-height:60px;transition:max-height .18s ease,opacity .14s ease,padding .18s ease}
.sh-bar.is-searching .sh-controls{max-height:0;opacity:0;padding-top:0;padding-bottom:0;
  border-top-color:transparent;overflow:hidden;pointer-events:none}
.sh-bar.is-searching .sh-search{padding:18px 14px}
.sh-bar.is-searching .sh-search input{font-size:19px}
.sh-controls__left{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.sh-controls__right{display:flex;align-items:center;gap:8px;margin-left:auto}
/* One shape, one height, for every control — the row cannot jumble. */
.sh-pill-wrap{position:relative}
.sh-pill{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 11px;
  border:1px solid var(--ln,#e5e7eb);border-radius:8px;background:transparent;
  font:inherit;font-size:12px;color:var(--tx2,#374151);cursor:pointer;white-space:nowrap}
.sh-pill:hover{border-color:var(--tx3,#9ca3af)}
.sh-pill.has{border-color:var(--tx,#111);color:var(--tx,#111)}
.sh-pill[aria-expanded="true"]{border-color:var(--tx,#111)}
.sh-pill__label{font-weight:500;color:var(--tx3,#6b7280)}
.sh-pill__value{font-weight:600}
.sh-pill__caret{font-size:10px;opacity:.6;line-height:1}
.sh-pop{position:absolute;top:calc(100% + 6px);left:0;z-index:30;min-width:170px;max-height:280px;
  overflow-y:auto;padding:6px;border:1px solid var(--ln,#e5e7eb);border-radius:10px;
  background:var(--sf,#fff);box-shadow:0 8px 28px rgba(0,0,0,.12)}
.sh-pop--right{left:auto;right:0}
.sh-pop[hidden]{display:none}
.sh-opt{display:block;width:100%;padding:7px 10px;border:0;border-radius:7px;background:transparent;
  font:inherit;font-size:13px;color:var(--tx2,#374151);text-decoration:none;cursor:pointer;
  white-space:nowrap;text-align:left}
.sh-opt:hover{background:var(--sf2,#f4f4f5)}
.sh-opt.on{background:var(--tx,#111);color:#fff}
/* Sizes are a set you scan, not a list you read. */
.sh-pop--grid{display:grid;grid-template-columns:repeat(4,minmax(44px,1fr));gap:4px;min-width:200px}
.sh-pop--grid .sh-opt{text-align:center;padding:9px 6px}
.sh-segs{display:inline-flex;height:32px;border:1px solid var(--ln,#e5e7eb);border-radius:8px;overflow:hidden}
.sh-seg{border:0;border-right:1px solid var(--ln,#e5e7eb);background:transparent;color:var(--tx2,#374151);
  font:inherit;font-size:13px;padding:0 11px;cursor:pointer}
.sh-seg:last-child{border-right:0}
.sh-seg:hover{background:var(--sf2,#f4f4f5)}
.sh-seg.on{background:var(--tx,#111);color:#fff}
.sh-count{font-size:12px;color:var(--tx3,#6b7280);white-space:nowrap}
.sh-clear{font-size:12px;color:var(--err,#b42318);text-decoration:none;font-weight:600}
/* The theme's --boxed/--cnt-N wrapper computes its own width for a flex
   layout (measured: 516px inside a 1032px parent). Left alone it halves the
   grid and every card with it. */
.c-product-grid,.c-product-grid__wrap{width:100%!important;max-width:none!important}
.c-product-grid__list[data-cols]{display:grid;width:100%}
/* The theme also sizes .c-product-grid__item for that flex layout; inside a
   grid those widths crush every card to ~87px. */
.c-product-grid__list[data-cols]>.c-product-grid__item{
  width:auto!important;max-width:none!important;flex:initial!important;margin:0!important}
.c-product-grid__list[data-cols="2"]{grid-template-columns:repeat(2,1fr)}
.c-product-grid__list[data-cols="3"]{grid-template-columns:repeat(3,1fr)}
.c-product-grid__list[data-cols="4"]{grid-template-columns:repeat(4,1fr)}
.c-product-grid__list[data-cols="5"]{grid-template-columns:repeat(5,1fr)}
.c-product-grid__list[data-cols="6"]{grid-template-columns:repeat(6,1fr)}
.c-product-grid__list.is-list{display:block}
.c-product-grid__list.is-list .c-product-grid__item{display:flex;gap:18px;align-items:center;
  padding:14px 0;border-bottom:1px solid var(--ln,#eee)}
.c-product-grid__list.is-list .c-product-grid__thumb-wrap{flex:0 0 96px;width:96px;height:96px;border-radius:10px}
.c-product-grid__list.is-list .c-product-grid__details{padding:0}
.c-product-grid__list.is-list .c-product-grid__atc-block{position:static;opacity:1;margin-left:auto;width:auto}
@media(max-width:900px){
  .sh-controls{flex-wrap:wrap;max-height:none}
  .sh-controls__right{margin-left:0}
  [data-cols-wrap]{display:none}
}
@media(max-width:767px){
  .c-product-grid__list[data-cols]{grid-template-columns:repeat(2,1fr)}
}

/* ── MINIMAL ──────────────────────────────────────────────────────────────
   No box at all — a row of icons on the page. The outline only appears once
   something is open, so the resting state is genuinely just the icons. */
.sh-bar--mini{border:0;border-radius:0;margin-bottom:18px}
.sh-mini__row{display:flex;align-items:center;gap:4px;padding:0 0 6px}
.sh-mini__spacer{flex:1}
.sh-mini__btn{width:34px;height:34px;display:inline-flex;align-items:center;justify-content:center;
  border:1px solid transparent;border-radius:9px;background:transparent;color:var(--tx,#111);cursor:pointer;
  transition:background .14s ease,border-color .14s ease}
.sh-mini__btn:hover{background:var(--sf2,#f4f4f5)}
.sh-mini__btn.on{background:var(--sf2,#f4f4f5);border-color:var(--ln,#e5e7eb)}
/* A filter that IS applied has to be visible without opening anything —
   otherwise the minimal bar hides the fact the grid is filtered. */
.sh-mini__btn.has:after{content:'';position:absolute;width:6px;height:6px;border-radius:50%;
  background:var(--ac,#e83b3b);transform:translate(11px,-11px)}
.sh-mini__btn{position:relative}
.sh-mini__panel{border:1px solid var(--ln,#e5e7eb);border-radius:12px;padding:6px 10px;margin-bottom:10px}
.sh-mini__panel .sh-search{padding:8px 4px}
.sh-mini__panel .sh-controls__left,.sh-mini__panel .sh-controls__right{
  display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 0}
.sh-bar--mini .sh-count{font-size:12px;color:var(--tx3,#6b7280)}
`;

export const SHOP_TOOLBAR_RUNTIME = `
(function(){
  var bar = document.getElementById('sh-bar');
  if (!bar) return;
  var list = document.querySelector('.c-product-grid__list');

  // ── Popovers: one open at a time ────────────────────────────────────────
  function closeAll(except){
    bar.querySelectorAll('.sh-pill[aria-expanded="true"]').forEach(function(p){
      if (p === except) return;
      p.setAttribute('aria-expanded','false');
      var pop = document.getElementById(p.getAttribute('aria-controls'));
      if (pop) pop.hidden = true;
    });
  }
  bar.querySelectorAll('.sh-pill').forEach(function(pill){
    pill.addEventListener('click', function(e){
      e.stopPropagation();
      var pop = document.getElementById(pill.getAttribute('aria-controls'));
      if (!pop) return;
      var open = pill.getAttribute('aria-expanded') === 'true';
      closeAll(pill);
      pill.setAttribute('aria-expanded', open ? 'false' : 'true');
      pop.hidden = open;
    });
  });
  document.addEventListener('click', function(e){ if (!bar.contains(e.target)) closeAll(null); });
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape') closeAll(null); });

  // ── Search takeover ─────────────────────────────────────────────────────
  var input = bar.querySelector('[data-sh-search]');
  var cancel = bar.querySelector('[data-sh-cancel]');
  function enterSearch(){ bar.classList.add('is-searching'); closeAll(null); if (cancel) cancel.hidden = false; }
  function exitSearch(){ bar.classList.remove('is-searching'); if (cancel) cancel.hidden = true; }
  if (input) {
    input.addEventListener('focus', enterSearch);
    // Leaving an EMPTY box means they changed their mind. A typed query keeps
    // the bar open, so the filters do not slide back over what they are
    // reading mid-thought.
    input.addEventListener('blur', function(){
      setTimeout(function(){ if (!input.value.trim()) exitSearch(); }, 120);
    });
    input.addEventListener('keydown', function(e){
      if (e.key === 'Escape') { input.value = ''; exitSearch(); run(); }
    });

    // ── Search runs itself ────────────────────────────────────────────────
    //
    // It used to submit only on Enter, which meant CLEARING the box did
    // nothing: the shopper was left looking at results for a query no longer
    // on screen, and had to find Cancel or Clear to get the shop back. Typing
    // and stopping should show you what you typed; deleting it should show you
    // the shop. Neither is a thing you should have to confirm.
    var form = input.form;
    var settled = new URL(window.location.href).searchParams.get('q') || '';
    var timer = null;
    function run(){
      var next = input.value.trim();
      // Only navigate when the query actually CHANGED. Without this, focusing
      // the box or pressing a modifier key would reload the same page — and on
      // an empty shop that is an endless refresh.
      if (next === settled) return;
      settled = next;
      var url = new URL(window.location.href);
      if (next) url.searchParams.set('q', next);
      else url.searchParams.delete('q');
      // The caret comes back where it was: a reload that dumps the shopper out
      // of the field they are still typing in is worse than no live search.
      try { sessionStorage.setItem('therum_shop_focus', String(input.selectionStart ?? next.length)); } catch (e) {}
      window.location.assign(url.toString());
    }
    input.addEventListener('input', function(){
      clearTimeout(timer);
      // Long enough to finish a word, short enough to feel like it is keeping
      // up. Clearing the box skips the wait — there is nothing to finish.
      timer = setTimeout(run, input.value.trim() ? 420 : 140);
    });
    if (form) form.addEventListener('submit', function(e){ e.preventDefault(); clearTimeout(timer); run(); });

    // Restore the caret after the navigation the search just caused.
    try {
      var caret = sessionStorage.getItem('therum_shop_focus');
      if (caret !== null) {
        sessionStorage.removeItem('therum_shop_focus');
        enterSearch();
        input.focus();
        var at = Math.min(Number(caret) || 0, input.value.length);
        input.setSelectionRange(at, at);
      }
    } catch (e) {}
  }
  if (cancel) cancel.addEventListener('click', function(){
    if (input) { input.value = ''; input.blur(); }
    exitSearch();
  });

  // ── Minimal mode: one panel open at a time ──────────────────────────────
  // Exclusive by construction rather than by remembering to close the others:
  // every panel is set from the same decision, so two cannot end up open.
  bar.querySelectorAll('[data-mini]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var want = btn.getAttribute('data-mini');
      var isOpen = btn.classList.contains('on');
      bar.querySelectorAll('[data-mini]').forEach(function(b){
        var on = !isOpen && b === btn;
        b.classList.toggle('on', on);
        b.setAttribute('aria-expanded', String(on));
      });
      bar.querySelectorAll('[data-mini-panel]').forEach(function(p){
        p.hidden = isOpen || p.getAttribute('data-mini-panel') !== want;
      });
      if (!isOpen && want === 'search') {
        var f = bar.querySelector('[data-sh-search]');
        if (f) f.focus();
      }
    });
  });

  // ── View + columns (per-device preference) ──────────────────────────────
  if (!list) return;
  var KEY_V = 'therum_shop_view', KEY_C = 'therum_shop_cols';
  var view = localStorage.getItem(KEY_V) || 'grid';
  // The merchant's configured default (Settings > Counter), overridden by this
  // device's own choice once the shopper makes one. Reading a hardcoded 4 here
  // meant the setting was ignored on every first visit.
  var fallback = parseInt(bar.getAttribute('data-cols') || '4', 10) || 4;
  var cols = parseInt(localStorage.getItem(KEY_C) || String(fallback), 10) || fallback;
  var colsValue = bar.querySelector('[data-cols-value]');
  var colsWrap = bar.querySelector('[data-cols-wrap]');

  function apply(){
    list.classList.toggle('is-list', view === 'list');
    list.setAttribute('data-cols', String(cols));
    bar.querySelectorAll('[data-view]').forEach(function(b){
      b.classList.toggle('on', b.getAttribute('data-view') === view);
    });
    bar.querySelectorAll('#sh-pop-cols [data-cols]').forEach(function(b){
      b.classList.toggle('on', Number(b.getAttribute('data-cols')) === cols);
    });
    if (colsValue) colsValue.textContent = String(cols);
    // Columns mean nothing in list view, so the control leaves rather than
    // sitting there inert.
    if (colsWrap) colsWrap.style.display = view === 'list' ? 'none' : '';
  }

  bar.querySelectorAll('[data-view]').forEach(function(b){
    b.addEventListener('click', function(){
      view = b.getAttribute('data-view');
      localStorage.setItem(KEY_V, view);
      apply();
    });
  });
  bar.querySelectorAll('#sh-pop-cols [data-cols]').forEach(function(b){
    b.addEventListener('click', function(){
      cols = Number(b.getAttribute('data-cols')) || 4;
      localStorage.setItem(KEY_C, String(cols));
      apply();
      closeAll(null);
    });
  });

  apply();
})();
`;

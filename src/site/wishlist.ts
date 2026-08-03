// The wishlist — the header's heart icon.
//
// There is no wishlist table in the schema and no wishlist API. Rather than
// invent a backend nobody asked for, this keeps the list in the shopper's own
// browser (localStorage, a plain array of product ids) and hydrates it from the
// public product endpoint on the way in. That is honest about what it is: the
// list survives reloads and follows the shopper around this browser, and it
// does not follow them to a second device. When a real account-backed wishlist
// is wanted, the storage functions here are the only thing that changes — the
// markup is already the theme's.
//
// The heart on a product card and the wishlist page share one runtime because
// they share one source of truth; splitting them is how the badge and the page
// drift apart.

export const WISHLIST_KEY = 'therum_wishlist';

export const WISHLIST_CSS = `
.c-product-grid__thumb-button-list{z-index:2}
.c-product-grid__thumb-button{background:none;border:0;padding:0;color:inherit}
/* The theme draws its hearts from an icon font we do not ship; these are the
   two states as plain glyphs so the control still reads as a heart. */
.c-product-grid__icon--wishlist:before{content:'\\2661';font-size:19px;line-height:1;font-style:normal}
.c-product-grid__thumb-button--added .c-product-grid__icon--wishlist:before{content:'\\2665'}
.c-product-grid__icon--wishlist:after{content:none}
.th-wishlist{padding-bottom:60px}
.th-wishlist__empty{padding:60px 0;text-align:center;font-size:14px;color:var(--text-color-light,#888)}
.th-wishlist__empty a{text-decoration:underline}
.c-wishlist__shop-remove-icon{background:none;border:0;cursor:pointer;font-size:12px;line-height:1}
.c-wishlist__button-wrap .button{display:inline-flex;align-items:center;justify-content:center;padding:12px 18px;
  border:solid 1px currentColor;text-decoration:none;font-size:11px;font-weight:600;letter-spacing:.0625em;text-transform:uppercase}
`;

/** The heart, in the theme's card-overlay contract. Rendered per card. */
export function wishlistButton(productId: string): string {
  return `
<div class="c-product-grid__thumb-button-list">
  <button class="c-product-grid__thumb-button c-product-grid__thumb-button--wishlist" type="button"
          data-wishlist-toggle="${productId}" aria-label="Add to wishlist" aria-pressed="false">
    <span class="c-product-grid__icon c-product-grid__icon--wishlist"></span>
    <span class="c-product-grid__icon-text">Wishlist</span>
  </button>
</div>`;
}

export function wishlistMarkup(): string {
  return `
<div class="c-wishlist th-wishlist" data-wishlist>
  <table class="c-wishlist__table c-wishlist__shop-table" hidden>
    <thead>
      <tr>
        <th class="c-wishlist__shop-th c-wishlist__shop-th--product-thumbnail"></th>
        <th class="c-wishlist__shop-th c-wishlist__shop-th--product-name">Product</th>
        <th class="c-wishlist__shop-th c-wishlist__shop-th--product-price">Price</th>
        <th class="c-wishlist__shop-th c-wishlist__shop-th--product-stock">Stock</th>
        <th class="c-wishlist__shop-th c-wishlist__shop-th--product-actions"></th>
      </tr>
    </thead>
    <tbody data-wishlist-rows></tbody>
  </table>
  <p class="th-wishlist__empty" data-wishlist-empty>
    Nothing saved yet. Tap the heart on any product to keep it here. <a href="/shop">Browse the shop</a>
  </p>
</div>`;
}

export const WISHLIST_RUNTIME = `
(function(){
  var KEY = ${JSON.stringify(WISHLIST_KEY)};

  function read(){
    try {
      var v = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(v) ? v.filter(function(x){ return typeof x === 'string'; }) : [];
    } catch (err) { return []; }
  }
  function write(ids){
    localStorage.setItem(KEY, JSON.stringify(ids));
    // Same-tab listeners; the storage event only fires in OTHER tabs.
    window.dispatchEvent(new CustomEvent('therum:wishlist-changed'));
  }
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]; }); }
  function money(m){ return (m/100).toLocaleString('en-US',{ style:'currency', currency:'USD' }); }

  // ── The heart on product cards ──────────────────────────────────────────
  function paintButtons(){
    var ids = read();
    document.querySelectorAll('[data-wishlist-toggle]').forEach(function(btn){
      var on = ids.indexOf(btn.getAttribute('data-wishlist-toggle')) !== -1;
      btn.classList.toggle('c-product-grid__thumb-button--added', on);
      btn.setAttribute('aria-pressed', String(on));
      btn.setAttribute('aria-label', on ? 'Remove from wishlist' : 'Add to wishlist');
    });
  }
  document.addEventListener('click', function(e){
    var btn = e.target.closest && e.target.closest('[data-wishlist-toggle]');
    if (!btn) return;
    // The heart sits inside the card's link — without this every tap navigates.
    e.preventDefault();
    e.stopPropagation();
    var id = btn.getAttribute('data-wishlist-toggle');
    var ids = read();
    var at = ids.indexOf(id);
    if (at === -1) ids.push(id); else ids.splice(at, 1);
    write(ids);
  });

  // ── The wishlist page ───────────────────────────────────────────────────
  var root = document.querySelector('[data-wishlist]');

  async function renderPage(){
    if (!root) return;
    var table = root.querySelector('table');
    var rows = root.querySelector('[data-wishlist-rows]');
    var empty = root.querySelector('[data-wishlist-empty]');
    var ids = read();
    if (!ids.length) { table.hidden = true; empty.hidden = false; return; }

    var products = await Promise.all(ids.map(async function(id){
      try {
        var res = await fetch('/api/products/' + encodeURIComponent(id));
        return res.ok ? await res.json() : null;
      } catch (err) { return null; }
    }));

    // A product deleted or unpublished since it was saved drops out of the
    // stored list too, so it does not keep failing on every visit.
    var live = products.filter(function(p){ return p && p.status === 'active'; });
    if (live.length !== ids.length) write(live.map(function(p){ return p.id; }));
    if (!live.length) { table.hidden = true; empty.hidden = false; return; }

    empty.hidden = true;
    table.hidden = false;
    rows.innerHTML = live.map(function(p){
      var variants = p.variants || [];
      var prices = variants.map(function(v){ return v.price; }).filter(function(n){ return typeof n === 'number'; });
      var from = prices.length ? Math.min.apply(null, prices) : null;
      var stock = variants.reduce(function(a, v){ return a + Math.max(0, (v.inventory || 0) - (v.reserved || 0)); }, 0);
      var href = '/product/' + esc(p.slug);
      return '<tr class="c-wishlist__shop-tr">'
        + '<td class="c-wishlist__shop-td c-wishlist__shop-td--product-thumbnail">'
        +   '<button class="c-wishlist__shop-remove-icon" type="button" aria-label="Remove" data-wishlist-toggle="' + esc(p.id) + '">&times;</button>'
        +   '<a class="c-wishlist__thumbnail-link" href="' + href + '">'
        +     (p.image ? '<img class="c-wishlist__thumb c-wishlist__thumb--crop" src="' + esc(p.image) + '" alt="" loading="lazy">' : '<span class="c-wishlist__thumb c-wishlist__thumb--crop"></span>')
        +   '</a></td>'
        + '<td class="c-wishlist__shop-td c-wishlist__shop-td--product-name"><a href="' + href + '">' + esc(p.name) + '</a></td>'
        + '<td class="c-wishlist__shop-td c-wishlist__shop-td--product-price">'
        +   '<span class="price">' + (from === null ? '—' : (prices.length > 1 ? 'From ' : '') + money(from)) + '</span></td>'
        + '<td class="c-wishlist__shop-td c-wishlist__shop-td--product-stock">' + (stock > 0 ? 'In stock' : 'Sold out') + '</td>'
        + '<td class="c-wishlist__shop-td c-wishlist__shop-td--product-actions">'
        +   '<span class="c-wishlist__button-wrap"><a class="button" href="' + href + '">View product</a></span></td>'
        + '</tr>';
    }).join('');
  }

  function refresh(){ paintButtons(); renderPage(); }
  refresh();
  window.addEventListener('therum:wishlist-changed', refresh);
  window.addEventListener('storage', function(e){ if (e.key === KEY) refresh(); });
})();
`;

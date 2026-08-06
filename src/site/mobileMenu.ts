// Full-screen mobile / tablet menu.
//
// The ported ideapark chrome ships a hamburger (`.js-mobile-menu-open`) and a
// hidden `.c-mobile-menu` holding the nav links — but the JavaScript that
// opened it was ideapark's, not part of this stack. So on a phone the button
// did nothing and there was no way to reach any page. This replaces that dead
// widget with a clean full-screen overlay built from the chrome's OWN data:
// the menu-bar links as big type, the footer's own columns beneath. Reading
// from the live DOM rather than a second hardcoded nav means it can never drift
// from what the header and footer actually show.

export const MOBILE_MENU_CSS = `
.th-mmenu{position:fixed;inset:0;z-index:99999;background:var(--sf,#fff);color:var(--tx,#0a0a0a);
  display:flex;flex-direction:column;overflow-y:auto;overscroll-behavior:contain;
  transform:translateY(-100%);transition:transform .34s cubic-bezier(.4,0,.2,1);visibility:hidden;
  -webkit-overflow-scrolling:touch}
.th-mmenu.is-open{transform:none;visibility:visible}
.th-mmenu__top{display:flex;align-items:center;justify-content:space-between;
  padding:18px 22px;border-bottom:1px solid var(--bd,rgba(0,0,0,.12));position:sticky;top:0;
  background:inherit}
.th-mmenu__brand{font-weight:800;letter-spacing:.14em;font-size:12px;text-transform:uppercase;color:var(--tx3,#8a8a8a)}
.th-mmenu__x{border:0;background:none;font-size:30px;line-height:1;cursor:pointer;color:inherit;
  padding:2px 6px;margin:-2px -6px}
.th-mmenu__links{display:flex;flex-direction:column;padding:10px 22px 6px}
.th-mmenu__link{display:block;padding:14px 0;font-size:clamp(30px,9vw,52px);font-weight:800;
  letter-spacing:-.03em;line-height:1;text-transform:uppercase;text-decoration:none;color:inherit;
  border-bottom:1px solid var(--bd,rgba(0,0,0,.08))}
.th-mmenu__link:last-child{border-bottom:0}
.th-mmenu__cols{display:grid;grid-template-columns:1fr 1fr;gap:26px 20px;padding:28px 22px 44px;
  border-top:1px solid var(--bd,rgba(0,0,0,.12));margin-top:auto}
.th-mmenu__col h4{margin:0 0 12px;font-size:11px;font-weight:700;letter-spacing:.12em;
  text-transform:uppercase;color:var(--tx3,#8a8a8a)}
.th-mmenu__col a{display:block;padding:6px 0;font-size:14px;text-decoration:none;color:inherit;opacity:.85}
.th-mmenu__col a:hover{opacity:1}
/* Body scroll is locked while the overlay is up, or the page scrolls behind it. */
html.th-mmenu-open,html.th-mmenu-open body{overflow:hidden}
/* No width media-query gates this overlay on purpose. The ported chrome shows
   the hamburger up to its own breakpoint (~1220), and hardcoding a different
   number here left a dead band on tablet where the hamburger showed but the
   overlay was display:none. The overlay only ever OPENS from the hamburger, so
   where there is no hamburger it never appears; a resize guard closes it if the
   viewport grows past the hamburger while it happens to be open. */
`;

export const MOBILE_MENU_RUNTIME = `
(function(){
  if (window.__thMmenu) return; window.__thMmenu = 1;
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }

  function navLinks(){
    // The chrome's own top menu. Fall back to any header anchors if the ported
    // markup ever changes class names.
    var set = document.querySelectorAll('.c-mobile-menu__list a, .c-header__menu a, #brx-header nav a');
    var seen = {}, out = [];
    [].forEach.call(set, function(a){
      var t = (a.textContent||'').replace(/\\s+/g,' ').trim(), h = a.getAttribute('href') || '';
      if (!t || !h || seen[t]) return;
      // Phone and email in the header are contact info, not navigation — a
      // giant "support@…" link is not what "the links in the menu bar" means.
      if (/^(tel:|mailto:)/i.test(h)) return;
      if (/^(cart|search|wishlist|account|sign in|log in|my account|0)$/i.test(t)) return;
      if (/^[+()\\d][\\d\\s()+.-]{5,}$/.test(t) || /@/.test(t)) return;
      seen[t] = 1; out.push({ t: t, h: h });
    });
    return out.slice(0, 10);
  }

  function footerCols(){
    var foot = document.querySelector('#brx-footer'); if (!foot) return [];
    // The footer's real link columns. The ported markup keeps each column's
    // links in a .th-icon-list-items list; its heading is NOT a sibling, so it
    // is found by walking up to the column container and reading the first
    // heading there. (A newsletter/customer-service block has a heading but no
    // link list, so keying off the LIST and back-filling the title skips them.)
    var lists = foot.querySelectorAll('.th-icon-list-items, .th-footer-col ul, [class*="menu"] ul');
    var out = [], seen = {};
    [].forEach.call(lists, function(ul){
      if (!ul.querySelector || !ul.querySelector('a')) return;
      var items = [];
      [].forEach.call(ul.querySelectorAll('a'), function(a){
        var t = (a.textContent||'').replace(/\\s+/g,' ').trim();
        if (t) items.push({ t: t, h: a.getAttribute('href') || '#' });
      });
      if (!items.length) return;
      var key = items.map(function(i){ return i.t; }).join('|');
      if (seen[key]) return; seen[key] = 1;
      // Title: the nearest heading in an ancestor column, if any.
      var title = '', node = ul.parentElement;
      for (var i = 0; i < 4 && node && !title; i++){
        var h = node.querySelector && node.querySelector('h1,h2,h3,h4,h5,h6,[class*="title"],[class*="heading"]');
        if (h){ var t = (h.textContent||'').replace(/\\s+/g,' ').trim(); if (t && t.length <= 22) title = t; }
        node = node.parentElement;
      }
      out.push({ title: title, items: items.slice(0, 8) });
    });
    return out.slice(0, 4);
  }

  var el = null;
  function build(){
    if (el) return;
    var L = navLinks(), C = footerCols();
    el = document.createElement('div');
    el.className = 'th-mmenu';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Menu');
    el.innerHTML =
      '<div class="th-mmenu__top"><span class="th-mmenu__brand">Menu</span>'
      + '<button class="th-mmenu__x" type="button" aria-label="Close menu">&times;</button></div>'
      + '<nav class="th-mmenu__links">'
      + L.map(function(x){ return '<a class="th-mmenu__link" href="' + esc(x.h) + '">' + esc(x.t) + '</a>'; }).join('')
      + '</nav>'
      + (C.length
          ? '<div class="th-mmenu__cols">'
            + C.map(function(c){
                return '<div class="th-mmenu__col">' + (c.title ? '<h4>' + esc(c.title) + '</h4>' : '')
                  + c.items.map(function(i){ return '<a href="' + esc(i.h) + '">' + esc(i.t) + '</a>'; }).join('')
                  + '</div>';
              }).join('')
            + '</div>'
          : '');
    document.body.appendChild(el);
    el.querySelector('.th-mmenu__x').addEventListener('click', close);
    // A link tap navigates; close first so the overlay is not frozen open
    // behind the next page during the transition.
    el.addEventListener('click', function(e){ var a = e.target.closest && e.target.closest('a'); if (a) close(); });
  }
  function open(){ build(); requestAnimationFrame(function(){ el.classList.add('is-open'); document.documentElement.classList.add('th-mmenu-open'); }); }
  function close(){ if (!el) return; el.classList.remove('is-open'); document.documentElement.classList.remove('th-mmenu-open'); }

  // Capture-phase so the ported chrome's own (dead) handlers cannot swallow it.
  document.addEventListener('click', function(e){
    var opener = e.target.closest && e.target.closest('.js-mobile-menu-open, .c-header__menu-button:not(.c-header__menu-back)');
    if (opener) { e.preventDefault(); e.stopPropagation(); open(); return; }
    var closer = e.target.closest && e.target.closest('.js-mobile-menu-close');
    if (closer) { e.preventDefault(); close(); }
  }, true);
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape' || e.keyCode === 27) close(); });

  // If the viewport grows past the hamburger (into desktop-nav territory) while
  // the overlay is open, close it — the page's real nav is back and a stuck
  // full-screen sheet over it is exactly the "goes weird on resize" bug.
  function hamburgerVisible(){
    var h = document.querySelector('.js-mobile-menu-open, .c-header__menu-button');
    return !!(h && h.getBoundingClientRect().width > 0 && h.offsetParent !== null);
  }
  var rzT;
  window.addEventListener('resize', function(){
    clearTimeout(rzT);
    rzT = setTimeout(function(){ if (el && el.classList.contains('is-open') && !hamburgerVisible()) close(); }, 120);
  });
})();
`;

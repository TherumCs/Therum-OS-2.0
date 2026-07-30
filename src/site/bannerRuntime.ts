// Homepage banner blocks — the two behaviours the imported markup expects.
//
// The pages ported from the old site carry Uncode/IdeaPark markup that is
// INERT on its own: `js-ip-banners-carousel` and `js-ip-banners-changing` are
// hooks, and all the movement lived in that theme's jQuery bundle (Owl
// Carousel plus a hand-rolled swap loop). We ship neither jQuery nor Owl, so
// the banners rendered as a static row with the overflow clipped — which is
// what "the scrolling banners are broken" looks like.
//
// Rebuilt here in plain DOM against the SAME class and data-attribute
// contract, so the imported markup keeps working untouched:
//
//   .js-ip-banners-carousel   data-count, data-autoplay, data-animation-timeout
//                             h-carousel--loop / --nav-hide / --dots-hide
//   .js-ip-banners-changing   data-animation, data-animation-timeout
//
// Deliberately NOT a port of Owl. Owl clones slides, rewrites the DOM and
// carries a decade of options nothing here uses; the actual requirement is
// "advance N items, wrap around, pause on hover". Reimplementing the surface
// we use is a fraction of the code and has no jQuery dependency.

export const BANNER_RUNTIME = `
(function(){
  // Respect the OS setting. These blocks auto-advance, which is exactly the
  // kind of motion this preference exists to stop.
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function itemsPerView(el, count){
    // Matches the theme's own breakpoints: 1 phone, 2 tablet, N desktop.
    var w = window.innerWidth;
    if (w < 768) return 1;
    if (w < 1190) return Math.min(2, count);
    return count;
  }

  function initCarousel(el){
    if (el.__ipInit) return;
    var items = Array.prototype.slice.call(el.querySelectorAll('.c-ip-banners__item'));
    if (items.length < 2) return;
    el.__ipInit = true;

    var count = parseInt(el.getAttribute('data-count') || '4', 10) || 4;
    var loop = el.classList.contains('h-carousel--loop');
    var autoplay = el.getAttribute('data-autoplay') === 'yes';
    var timeout = parseInt(el.getAttribute('data-animation-timeout') || '5000', 10) || 5000;
    var index = 0;

    // A horizontal scroller rather than transform juggling: it keeps native
    // touch/trackpad swiping, which a transform carousel has to reimplement
    // badly.
    el.style.overflowX = 'auto';
    el.style.scrollBehavior = 'smooth';
    el.style.scrollSnapType = 'x mandatory';
    el.style.scrollbarWidth = 'none';
    items.forEach(function(it){
      it.style.scrollSnapAlign = 'start';
      it.style.flex = '0 0 ' + (100 / itemsPerView(el, count)) + '%';
    });

    function layout(){
      var per = itemsPerView(el, count);
      items.forEach(function(it){ it.style.flex = '0 0 ' + (100 / per) + '%'; });
    }
    window.addEventListener('resize', layout);

    function go(to){
      var per = itemsPerView(el, count);
      var max = Math.max(0, items.length - per);
      if (to > max) to = loop ? 0 : max;
      if (to < 0) to = loop ? max : 0;
      index = to;
      var target = items[index];
      if (target) el.scrollTo({ left: target.offsetLeft - items[0].offsetLeft, behavior: 'smooth' });
    }

    if (!el.classList.contains('h-carousel--nav-hide')) {
      [['prev','‹',-1],['next','›',1]].forEach(function(spec){
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'ip-nav ip-nav--' + spec[0];
        b.setAttribute('aria-label', spec[0] === 'prev' ? 'Previous' : 'Next');
        b.textContent = spec[1];
        b.addEventListener('click', function(){ go(index + spec[2]); });
        el.parentNode.appendChild(b);
      });
    }

    if (autoplay && !reduced) {
      var timer = setInterval(function(){ go(index + 1); }, timeout);
      // Pausing on hover is the difference between a carousel and a thing that
      // yanks the item away as you reach for it.
      el.addEventListener('mouseenter', function(){ clearInterval(timer); timer = null; });
      el.addEventListener('mouseleave', function(){
        if (!timer) timer = setInterval(function(){ go(index + 1); }, timeout);
      });
    }
  }

  function initChanging(el){
    if (el.__ipInit) return;
    var items = Array.prototype.slice.call(el.querySelectorAll('.c-ip-banners__item'));
    if (items.length < 2) return;
    el.__ipInit = true;

    var timeout = parseInt(el.getAttribute('data-animation-timeout') || '3000', 10) || 3000;

    // Slots are MEASURED, not read off the --N class.
    //
    // That class describes the DESKTOP layout. Below the theme's breakpoint the
    // row only fits two, and this list is overflow-x:hidden — so four items
    // meant two were cut off with no way to reach them (measured: 2199px of
    // content in a 1100px box). Measuring makes the rotation pool "whatever
    // does not fit", at whatever width the visitor is actually on.
    function slotCount(){
      var listW = el.clientWidth;
      var itemW = items[0].getBoundingClientRect().width;
      if (!listW || !itemW) return items.length;
      return Math.max(1, Math.min(items.length, Math.round(listW / itemW)));
    }

    var slots = slotCount();
    var next = slots % items.length;

    function layout(){
      slots = slotCount();
      next = slots % items.length;
      items.forEach(function(it, i){
        it.style.display = i < slots ? '' : 'none';
        it.style.opacity = '';
        it.style.order = String(i);
      });
    }
    layout();

    // A resize changes how many fit, so this has to be recomputed or the block
    // quietly goes back to clipping.
    var rt = null;
    window.addEventListener('resize', function(){ clearTimeout(rt); rt = setTimeout(layout, 150); });

    if (reduced) return;

    // Only run while on screen — a timer swapping images in a block nobody is
    // looking at is pure battery and layout work.
    var timer = null;
    function start(){
      if (timer) return;
      timer = setInterval(function(){
        // EVERYTHING FITS: still animate. The source block does this too — it
        // cycles the ORDER of the visible banners rather than swapping any in
        // or out, so a 4-up row of 4 banners still moves. Gating this on
        // "more items than slots" is what silently stopped the desktop motion.
        if (slots >= items.length) {
          var first = items.slice().sort(function(a, b){
            return (parseInt(a.style.order || '0', 10)) - (parseInt(b.style.order || '0', 10));
          })[0];
          if (!first) return;
          var maxOrder = items.reduce(function(m, it){
            return Math.max(m, parseInt(it.style.order || '0', 10));
          }, 0);
          first.style.transition = 'opacity .45s ease';
          first.style.opacity = '0';
          setTimeout(function(){
            // Send it to the end of the row, then fade it back in there.
            first.style.order = String(maxOrder + 1);
            requestAnimationFrame(function(){ first.style.opacity = '1'; });
          }, 460);
          return;
        }
        var slot = items.findIndex(function(it){ return it.style.display !== 'none'; });
        if (slot < 0) return;
        var outgoing = items[slot];
        var incoming = items[next % items.length];
        next = (next + 1) % items.length;
        if (!incoming || incoming === outgoing) return;
        incoming.style.display = '';
        incoming.style.opacity = '0';
        incoming.style.transition = 'opacity .45s ease';
        outgoing.style.transition = 'opacity .45s ease';
        outgoing.style.opacity = '0';
        requestAnimationFrame(function(){ incoming.style.opacity = '1'; });
        setTimeout(function(){
          outgoing.style.display = 'none';
          outgoing.style.opacity = '';
        }, 460);
      }, timeout);
    }
    function stop(){ if (timer) { clearInterval(timer); timer = null; } }

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function(entries){
        entries[0].isIntersecting ? start() : stop();
      }, { threshold: 0.2 }).observe(el);
    } else {
      start();
    }
  }

  // ── Running line (the scrolling banner strip) ───────────────────────────
  //
  // THIS is the marquee strip, and it is a different component from the two
  // banner grids above — which is why fixing those did nothing for it.
  //
  // The theme's CSS is already complete: @keyframes c-ip-running-line-scroll
  // plus a rule that only animates .c-ip-running-line--active. Everything
  // missing was JavaScript, so the strip rendered as one short <ul> in a
  // full-width bar with the animation never switched on — a white band.
  //
  // Faithful port of ideapark_init_running_line: measure how many copies of
  // the content are needed to cover the bar, clone that many, then add the
  // --active class that starts the scroll. The +2 is the source's own margin
  // so the loop never shows a gap at the seam.
  function initRunningLine(line){
    if (line.__ipLine) return;
    var content = line.querySelector('.c-ip-running-line__content');
    if (!content) return;
    line.__ipLine = true;

    function fill(){
      // Drop previous clones before re-measuring, or a resize multiplies them
      // without bound.
      line.querySelectorAll('.c-ip-running-line__content[data-ip-clone]').forEach(function(c){ c.remove(); });
      var lineWidth = content.offsetWidth;
      var barWidth = line.clientWidth;
      if (!lineWidth || !barWidth) return;
      var count = Math.ceil(barWidth / lineWidth) + 2;
      for (var i = 0; i < count; i++) {
        var clone = content.cloneNode(true);
        clone.setAttribute('data-ip-clone', '1');
        clone.setAttribute('aria-hidden', 'true');
        line.appendChild(clone);
      }
      line.classList.add('c-ip-running-line--active');
    }

    fill();
    var rt = null;
    window.addEventListener('resize', function(){ clearTimeout(rt); rt = setTimeout(fill, 200); });
  }

  function init(){
    document.querySelectorAll('.js-ip-banners-carousel').forEach(initCarousel);
    document.querySelectorAll('.js-ip-banners-changing').forEach(initChanging);
    document.querySelectorAll('.js-ip-running-line').forEach(initRunningLine);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
`;

/** Styles the runtime needs — the nav buttons it injects, and hiding the scrollbar. */
export const BANNER_STYLES = `
/* Running line: each copy must size to its CONTENT, not to the bar.
   Measured: the ul was display:flex at the bar's full 1440px while its single
   item was 246px, so ~83% of every copy was empty space — the strip read as a
   white band with the text scrolled off the left edge. Sizing each copy to
   max-content makes the clones tile edge to edge, which is what the theme's
   scroll keyframes assume. */
.c-ip-running-line.c-ip-running-line{display:flex!important;flex-direction:row!important;
  flex-wrap:nowrap!important;align-items:center;overflow:hidden}
.c-ip-running-line.c-ip-running-line>.c-ip-running-line__content{
  flex:0 0 auto!important;width:max-content!important;margin:0}

/* Column widths for the imported banner grids.
   The theme's own stylesheet sizes .c-ip-banners__list--N; without it the
   items fell back to a wider default (480px), so a 4-up row measured 1920px
   inside a 1440px container and silently clipped the last banner. */
.c-ip-banners__list{display:flex;gap:0}
.c-ip-banners__list--2>.c-ip-banners__item{flex:0 0 50%;max-width:50%}
.c-ip-banners__list--3>.c-ip-banners__item{flex:0 0 33.3333%;max-width:33.3333%}
.c-ip-banners__list--4>.c-ip-banners__item{flex:0 0 25%;max-width:25%}
.c-ip-banners__list--5>.c-ip-banners__item{flex:0 0 20%;max-width:20%}
.c-ip-banners__list--6>.c-ip-banners__item{flex:0 0 16.6666%;max-width:16.6666%}
/* Below the theme's desktop breakpoint its OWN item rule (a third each) wins
   over a plain child selector, so four items measured 366px inside a 1100px
   row — 1465px total — and the list, which is overflow:hidden, silently ate
   the fourth. That is the "banners are broken" strip: a clipped row, not a
   missing image. Doubled class + !important to outrank it. */
@media (max-width:1189px){
  .c-ip-banners__list.c-ip-banners__list>.c-ip-banners__item{flex:0 0 50%!important;max-width:50%!important}
}
@media (max-width:767px){
  .c-ip-banners__list.c-ip-banners__list>.c-ip-banners__item{flex:0 0 100%!important;max-width:100%!important}
}
.c-ip-banners__item img{width:100%;height:100%;object-fit:cover;display:block}
.c-ip-banners__list-wrap{position:relative}
.js-ip-banners-carousel::-webkit-scrollbar{display:none}
.ip-nav{position:absolute;top:50%;transform:translateY(-50%);z-index:3;width:40px;height:40px;
  border:0;border-radius:50%;background:rgba(255,255,255,.92);color:#111;font-size:22px;line-height:1;
  cursor:pointer;opacity:0;transition:opacity .2s ease;box-shadow:0 2px 12px rgba(0,0,0,.18)}
.c-ip-banners__list-wrap:hover .ip-nav{opacity:1}
.ip-nav--prev{left:10px}.ip-nav--next{right:10px}
@media (max-width:767px){.ip-nav{display:none}}
`;

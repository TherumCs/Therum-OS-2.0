// Signal — the Meta Pixel, browser side. Injected into both page shells beside
// the popup runtime. Does nothing at all until the store has a pixel ID saved
// (one small GET, cached a minute), and nothing for crawlers.
//
// Events and the ids they carry — chosen to match the catalog feed, where each
// variant is an item (`g:id` = variant id) grouped by product
// (`g:item_group_id` = product id):
//   PageView          every page
//   ViewContent       product page     content_type product_group, the product id
//   AddToCart         any successful POST /api/cart/items, whatever button made it
//   InitiateCheckout  the checkout page
//   Purchase          the order-received page, event id `purchase-<number>` —
//                     the SAME id the server sends from the paid edge, so Meta
//                     keeps one of the two.

export const SIGNAL_RUNTIME = `
(function(){
  try{
    if (window.__thSignal) return; window.__thSignal = 1;
    if (/bot|crawl|spider|slurp|externalagent|facebookexternalhit|preview|headless|lighthouse/i.test(navigator.userAgent || '')) return;
    function boot(id){
      !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
      fbq('init', id);
      fbq('track', 'PageView');
      var path = location.pathname || '/';
      var cur = 'USD';
      var priceMeta = document.querySelector('meta[property="product:price:amount"]');
      var pid = document.querySelector('[data-product-id]');
      if (/^\\/product\\//.test(path) && pid) {
        var v = priceMeta ? parseFloat(priceMeta.getAttribute('content')) : undefined;
        fbq('track', 'ViewContent', { content_ids: [pid.getAttribute('data-product-id')], content_type: 'product_group', value: isNaN(v) ? undefined : v, currency: cur });
      }
      if (/^\\/checkout(\\/|$)/.test(path)) fbq('track', 'InitiateCheckout', { currency: cur });
      var ord = document.querySelector('[data-signal-order]');
      if (ord) {
        var items = [];
        try { items = JSON.parse(ord.getAttribute('data-signal-items') || '[]'); } catch (e) {}
        fbq('track', 'Purchase', {
          value: parseFloat(ord.getAttribute('data-signal-value')) || 0,
          currency: ord.getAttribute('data-signal-currency') || cur,
          content_type: 'product',
          content_ids: items.map(function(i){ return i.id; }),
          contents: items,
          num_items: items.reduce(function(n, i){ return n + (i.quantity || 0); }, 0)
        }, { eventID: 'purchase-' + ord.getAttribute('data-signal-order') });
      }
      // AddToCart from the one place every add goes through, not from buttons:
      // a theme can have any number of add buttons, but they all POST here.
      var of = window.fetch;
      if (of) window.fetch = function(u, o){
        var p = of.apply(this, arguments);
        try {
          var url = String(u && u.url || u);
          if (/\\/api\\/cart\\/items$/.test(url) && o && String(o.method || '').toUpperCase() === 'POST') {
            var body = {}; try { body = JSON.parse(o.body || '{}'); } catch (e) {}
            p.then(function(r){
              if (!r || !r.ok) return;
              r.clone().json().then(function(j){
                var lines = (j && j.totals && j.totals.lines) || [];
                var line = lines.filter(function(l){ return l.variantId === body.variantId; })[0] || {};
                var unit = line.unitPrice != null ? line.unitPrice : line.price;
                fbq('track', 'AddToCart', { content_ids: [body.variantId], content_type: 'product', contents: [{ id: body.variantId, quantity: body.quantity || 1 }], value: unit != null ? (unit * (body.quantity || 1)) / 100 : undefined, currency: cur });
              }).catch(function(){});
            }).catch(function(){});
          }
        } catch (e) {}
        return p;
      };
    }
    var load = function(){
      fetch('/api/shop/signal', { credentials: 'same-origin' })
        .then(function(r){ return r.ok ? r.json() : null; })
        .then(function(j){ if (j && j.pixelId) boot(String(j.pixelId)); })
        .catch(function(){});
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load); else load();
  }catch(e){}
})();`;

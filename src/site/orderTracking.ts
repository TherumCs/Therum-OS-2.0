// /order-tracking — the shopper's own view of where their parcel is.
//
// Immersive, in the sense Bam asked for on header search: the page IS the
// lookup. One big field, and on a match the form gets out of the way and the
// order takes over the whole page rather than appearing in a box beneath it.
//
// Everything shown comes from the order and its shipments. Where we have no
// carrier ETA the page SAYS so — a made-up "arrives in 3-5 days" is the kind
// of detail a shopper plans around and then blames the store for.

export const ORDER_TRACKING_CSS = `
.ot{max-width:820px;margin:0 auto;padding:90px 24px 120px;min-height:52vh}
.ot--found{max-width:1000px}
.ot__title{font-size:clamp(38px,7vw,86px);line-height:.95;letter-spacing:-.03em;margin:0 0 14px;font-weight:400}
.ot__sub{margin:0 0 40px;font-size:15px;line-height:1.6;opacity:.7;max-width:46ch}
.ot__form{display:flex;flex-direction:column;gap:16px;max-width:520px}
.ot__form label{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;display:block;margin-bottom:7px}
.ot__form input{width:100%;padding:15px 16px;font:inherit;font-size:17px;
  border:1px solid rgba(0,0,0,.2);background:transparent}
.ot__form input:focus{outline:0;border-color:currentColor}
.ot__go{align-self:flex-start;margin-top:6px;padding:15px 34px;background:#111;color:#fff;border:0;cursor:pointer;
  font:inherit;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
.ot__go[disabled]{opacity:.5;cursor:default}
.ot__err{font-size:13px;color:#c0392b;min-height:1.2em;margin:0}
.ot__hint{font-size:12px;opacity:.55;margin:4px 0 0;line-height:1.55}

/* The result takes the page. */
.ot__result{display:none}
.ot.is-found .ot__intro,.ot.is-found .ot__form{display:none}
.ot.is-found .ot__result{display:block;animation:otIn .45s cubic-bezier(.2,.7,.3,1) both}
@keyframes otIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}

.ot__back{background:none;border:0;padding:0;font:inherit;font-size:12px;font-weight:700;letter-spacing:.06em;
  text-transform:uppercase;cursor:pointer;opacity:.55;margin-bottom:26px}
.ot__back:hover{opacity:1}
.ot__no{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;opacity:.5;margin:0 0 6px}
.ot__state{font-size:clamp(30px,5vw,54px);line-height:1.05;letter-spacing:-.02em;margin:0 0 8px;font-weight:400}
.ot__when{font-size:14px;opacity:.7;margin:0 0 40px}

.ot__ship{border-top:1px solid rgba(0,0,0,.14);padding:28px 0}
.ot__ship-top{display:flex;justify-content:space-between;align-items:baseline;gap:20px;flex-wrap:wrap}
.ot__carrier{font-size:19px;font-weight:600;margin:0}
.ot__num{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;opacity:.65}
.ot__link{display:inline-flex;align-items:center;gap:9px;margin-top:14px;padding:12px 20px;
  border:1px solid currentColor;text-decoration:none;color:inherit;
  font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
.ot__link:hover{background:#111;border-color:#111;color:#fff}
.ot__dates{display:flex;gap:36px;flex-wrap:wrap;margin-top:20px}
.ot__date b{display:block;font-size:15px;font-weight:600}
.ot__date span{font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;opacity:.5}

.ot__items{list-style:none;margin:26px 0 0;padding:0;display:flex;flex-direction:column;gap:14px}
.ot__item{display:flex;gap:16px;align-items:center}
.ot__item img,.ot__item .ot__ph{width:60px;height:60px;flex:0 0 60px;object-fit:cover;background:rgba(0,0,0,.06)}
.ot__item-name{display:block;font-size:14px;font-weight:500}
.ot__item-meta{display:block;font-size:12px;opacity:.55;margin-top:2px}
.ot__sums{display:flex;flex-direction:column;gap:4px;padding:12px 0;border-top:1px solid var(--ln,#eee)}
.ot__sum{display:flex;justify-content:space-between;font-size:13px;color:var(--tx3,#6b7280);
  font-variant-numeric:tabular-nums}
.ot__foot{border-top:1px solid rgba(0,0,0,.14);margin-top:34px;padding-top:20px;
  display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap;font-size:14px}
.ot__foot b{font-weight:600}
@media(max-width:700px){.ot{padding:52px 20px 80px}}
`;

export function orderTrackingMarkup(): string {
  return `
<div class="ot" data-ot>
  <div class="ot__intro">
    <h1 class="ot__title">TRACK YOUR ORDER</h1>
    <p class="ot__sub">Your order number is on your confirmation email. We ask for the email too, so nobody but you can see where your parcel is.</p>
  </div>

  <form class="ot__form" data-ot-form novalidate>
    <div>
      <label for="ot-number">Order number</label>
      <input id="ot-number" name="number" placeholder="THR-…" autocomplete="off" spellcheck="false" required>
    </div>
    <div>
      <label for="ot-email">Email on the order</label>
      <input id="ot-email" name="email" type="email" autocomplete="email" required>
      <p class="ot__hint" data-ot-hint>Signed in? Leave this blank and we will match it to your account.</p>
    </div>
    <p class="ot__err" data-ot-err></p>
    <button class="ot__go" type="submit">Track it</button>
  </form>

  <div class="ot__result" data-ot-result></div>
</div>`;
}

export const ORDER_TRACKING_RUNTIME = `
(function(){
  var root = document.querySelector('[data-ot]');
  if (!root) return;
  var form = root.querySelector('[data-ot-form]');
  var err = root.querySelector('[data-ot-err]');
  var out = root.querySelector('[data-ot-result]');
  var go = form.querySelector('.ot__go');

  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]; }); }
  function money(m, cur){ return (m/100).toLocaleString('en-US', { style:'currency', currency: cur || 'USD' }); }
  function day(d){ return d ? new Date(d).toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric' }) : null; }

  // What the shopper actually wants to read, from the status we hold.
  function headline(o){
    var s = (o.shipments || []).slice(-1)[0];
    if (s && s.deliveredAt) return 'Delivered';
    if (s && s.shippedAt) return 'On its way';
    if (o.status === 'cancelled') return 'Cancelled';
    if (o.status === 'failed') return 'Payment failed';
    if (o.status === 'processing') return 'Being packed';
    return 'Order received';
  }

  function itemRow(i){
    return '<li class="ot__item">'
      + (i.image ? '<img src="' + esc(i.image) + '" alt="" loading="lazy">' : '<span class="ot__ph"></span>')
      + '<span><span class="ot__item-name">'
      + (i.slug ? '<a href="/product/' + esc(i.slug) + '">' + esc(i.name) + '</a>' : esc(i.name))
      + '</span><span class="ot__item-meta">Qty ' + i.quantity + (i.sku ? ' · ' + esc(i.sku) : '') + '</span></span></li>';
  }

  function shipmentBlock(s){
    var dates = [
      s.shippedAt ? { k:'Shipped', v: day(s.shippedAt) } : null,
      s.estimatedDelivery ? { k:'Estimated arrival', v: day(s.estimatedDelivery) } : null,
      s.deliveredAt ? { k:'Delivered', v: day(s.deliveredAt) } : null,
    ].filter(Boolean);

    return '<div class="ot__ship">'
      + '<div class="ot__ship-top">'
      +   '<h2 class="ot__carrier">' + esc(s.carrier || 'Carrier to be confirmed') + '</h2>'
      +   (s.trackingNumber ? '<span class="ot__num">' + esc(s.trackingNumber) + '</span>' : '')
      + '</div>'
      + (dates.length
          ? '<div class="ot__dates">' + dates.map(function(d){
              return '<span class="ot__date"><b>' + esc(d.v) + '</b><span>' + esc(d.k) + '</span></span>';
            }).join('') + '</div>'
          : '')
      // Only when we hold a real one. An invented delivery window is a
      // promise the store did not make and cannot keep.
      + (!s.estimatedDelivery && s.shippedAt && !s.deliveredAt
          ? '<p class="ot__hint">The carrier has not given us a delivery estimate for this one — their tracking page will have the latest.</p>' : '')
      + (s.trackingUrl
          ? '<a class="ot__link" href="' + esc(s.trackingUrl) + '" target="_blank" rel="noopener noreferrer">Track with ' + esc(s.carrier) + ' <span aria-hidden="true">&rarr;</span></a>'
          : s.trackingNumber
            ? '<p class="ot__hint">We do not have a tracking link for this carrier — quote the number above on their site.</p>'
            : '')
      + '</div>';
  }

  function render(o){
    var ship = (o.shipments || []);
    out.innerHTML = '<button class="ot__back" type="button" data-ot-back>&larr; Track another</button>'
      + '<p class="ot__no">Order ' + esc(o.number) + '</p>'
      // h2, not h1 — the page already has one, and this is the state of the
      // order rather than the name of the page.
      + '<h2 class="ot__state">' + esc(headline(o)) + '</h2>'
      + '<p class="ot__when">Placed ' + esc(day(o.placedAt)) + (o.destination ? ' · heading to ' + esc(o.destination) : '') + '</p>'
      + (ship.length
          ? ship.map(shipmentBlock).join('')
          : '<div class="ot__ship"><h2 class="ot__carrier">Not shipped yet</h2>'
            + '<p class="ot__hint">Nothing has left us yet. This page will show the carrier and tracking link as soon as it does.</p></div>')
      + '<ul class="ot__items">' + (o.items || []).map(itemRow).join('') + '</ul>'
      // The full breakdown, not just the number that left their account: a
      // shopper reviewing an order should be able to see what each part cost.
      + '<div class="ot__sums">'
      + '<div class="ot__sum"><span>Subtotal</span><span>' + money(o.itemsSubtotal, o.currency) + '</span></div>'
      + (o.discountAmount > 0
          ? '<div class="ot__sum"><span>' + esc(o.discountLabel || 'Discount') + '</span><span>−' + money(o.discountAmount, o.currency) + '</span></div>'
          : '')
      + '<div class="ot__sum"><span>Shipping' + (o.shippingMethod ? ' · ' + esc(o.shippingMethod) : '') + '</span><span>'
      + (o.shippingTotal > 0 ? money(o.shippingTotal, o.currency) : 'Free') + '</span></div>'
      + (o.taxTotal > 0 ? '<div class="ot__sum"><span>Tax</span><span>' + money(o.taxTotal, o.currency) + '</span></div>' : '')
      + '</div>'
      + '<div class="ot__foot"><span>' + (o.items || []).reduce(function(n,i){ return n + i.quantity; }, 0) + ' item(s)</span>'
      + '<span><b>' + money(o.total, o.currency) + '</b></span></div>';
    root.classList.add('is-found');
    out.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  out.addEventListener('click', function(e){
    if (e.target.closest('[data-ot-back]')) {
      root.classList.remove('is-found');
      out.innerHTML = '';
      form.querySelector('#ot-number').focus();
    }
  });

  form.addEventListener('submit', function(e){
    e.preventDefault();
    err.textContent = '';
    var number = form.querySelector('#ot-number').value.trim();
    var email = form.querySelector('#ot-email').value.trim();
    if (!number) { err.textContent = 'Enter your order number.'; return; }
    go.disabled = true;
    go.textContent = 'Looking…';
    fetch('/api/orders/track', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(email ? { number: number, email: email } : { number: number }),
    }).then(function(r){ return r.json().then(function(b){ return { ok: r.ok, b: b }; }); })
      .then(function(res){
        if (!res.ok) throw new Error((res.b.error && res.b.error.message) || 'We could not find that order.');
        render(res.b.order);
      })
      .catch(function(ex){ err.textContent = ex.message; })
      .then(function(){ go.disabled = false; go.textContent = 'Track it'; });
  });
})();
`;

// One page, two modes: cart and checkout are the same surface.
//
// The old flow was two documents — /cart, then a full navigation to /checkout.
// Every step that reloads the page is a step a shopper can abandon, and the
// total disappeared from view exactly when they were deciding whether to pay.
//
// So: ONE container. The summary (total + count) is pinned at the top and
// never re-renders out of view; the panel underneath morphs between the item
// list and the payment step in place. No navigation, no re-fetch of the page,
// no losing scroll position.
//
// TWO PATHS, both landing in the same code:
//
//   Standard   /cart -> "Checkout" morphs the panel. /checkout deep-links
//              straight into the payment step, so the URL stays shareable and
//              the back button still works (history.pushState, not a hash).
//
//   Quick      A `data-quick-buy="<variantId>"` button on a PDP or a search
//              result adds that item and opens the SAME payment step inline,
//              skipping the cart page entirely. It is the identical component,
//              not a second checkout that will drift out of step with the
//              first one.
//
// Layout is fixed by the brief: price at top, items below, in both modes.

export const CHECKOUT_FLOW_CSS = `
/* Coupon row. Three states: an input, an applied code, or — for a member —
   no input at all and a line saying why. */
.co-field input{display:block;width:100%;box-sizing:border-box;margin-top:8px;padding:10px 12px;
  border:1px solid var(--ln,#e5e7eb);border-radius:8px;font:inherit;font-size:14px}
.co-row2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.co-shiprow{display:flex;align-items:center;gap:12px;padding:12px 14px;margin-top:8px;cursor:pointer;
  border:1px solid var(--ln,#e5e7eb);border-radius:10px}
.co-shiprow.active{border-color:var(--tx,#111);box-shadow:inset 0 0 0 1px var(--tx,#111)}
.co-shipl{display:flex;flex-direction:column;flex:1;min-width:0}
.co-shipname{font-weight:600;font-size:14px}
.co-shipsub{font-size:12px;color:var(--tx3,#6b7280)}
.co-shipprice{font-variant-numeric:tabular-nums;font-size:14px}
.co-sums{display:flex;flex-direction:column;gap:2px;margin-left:auto;padding-right:14px}
.co-sumrow{display:flex;gap:14px;justify-content:space-between;font-size:12px;color:var(--tx3,#6b7280);
  font-variant-numeric:tabular-nums}
@media (max-width:820px){.co-sums{display:none}}
@media (max-width:520px){.co-row2{grid-template-columns:1fr}}
.co-coupon{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:14px 0 4px;padding:12px 0;
  border-top:1px solid var(--ln,#e5e7eb)}
.co-coupon input{flex:1;min-width:140px;border:1px solid var(--ln,#e5e7eb);border-radius:9px;
  padding:10px 12px;font:inherit;font-size:14px}
.co-coupon__go{border:0;background:var(--tx,#111);color:#fff;border-radius:9px;padding:10px 16px;
  font:inherit;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;cursor:pointer}
.co-coupon__err{flex:1 0 100%;font-size:12px;color:var(--err,#ef4444)}
.co-coupon__err:empty{display:none}
.co-coupon__on{font-size:13px;font-weight:600}
.co-coupon__x{border:0;background:none;color:var(--tx3,#6b7280);font:inherit;font-size:12px;
  text-decoration:underline;cursor:pointer;padding:0}
.co-coupon--member{flex-direction:column;align-items:flex-start;gap:2px}
.co-coupon__lock{font-size:13px;font-weight:600}
.co-coupon__note{font-size:12px;color:var(--tx2,#666)}

.co-flow{max-width:860px;margin:0 auto}
/* WHERE THE TOTAL STICKS, and why it differs by device:
   DESKTOP — top. It sits on the natural eye line, and a fixed bottom bar on a
   wide screen reads like a cookie banner, which people are trained to ignore.
   MOBILE  — bottom. It is in thumb reach, it is the platform convention for
   commerce, and it carries the primary action so "Checkout" / "Place order"
   is never a scroll away. */
.co-summary{position:sticky;top:0;z-index:5;background:var(--sf,#fff);border:1px solid var(--ln,#e5e7eb);
  border-radius:14px;padding:18px 20px;display:flex;align-items:baseline;justify-content:space-between;
  gap:16px;margin-bottom:16px;box-shadow:0 1px 10px rgba(0,0,0,.04)}
.co-summary .co-total{font-size:28px;font-weight:700;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.co-summary .co-meta{font-size:12px;color:var(--tx3,#6b7280);text-transform:uppercase;letter-spacing:.06em}
.co-summary .co-sub{font-size:12px;color:var(--tx3,#6b7280)}
#co-cta{display:none}
@media(max-width:767px){
  .co-summary{position:fixed;left:0;right:0;bottom:0;top:auto;border-radius:14px 14px 0 0;
    border-left:0;border-right:0;border-bottom:0;box-shadow:0 -4px 24px rgba(0,0,0,.12);
    padding:12px 16px calc(12px + env(safe-area-inset-bottom));align-items:center}
  .co-summary .co-total{font-size:20px}
  /* The action rides in the bar, so the thing they came to press is always
     under the thumb rather than at the end of the item list. */
  #co-cta{display:inline-block;margin-left:auto;padding:11px 20px;border:0;border-radius:10px;
    background:var(--ac-btn,#4f46e5);color:#fff;font:inherit;font-weight:600;font-size:14px;cursor:pointer}
  #co-cta[disabled]{opacity:.5}
  .co-summary>div:first-child{flex:0 0 auto}
  /* Clear the fixed bar so the last item is never trapped under it. */
  .co-flow{padding-bottom:84px}
  .co-act{display:none}
}
.co-panel{border:1px solid var(--ln,#e5e7eb);border-radius:14px;background:var(--sf,#fff);padding:20px}
.co-step{display:none}.co-step.on{display:block}
.co-line{display:flex;gap:14px;align-items:center;padding:14px 0;border-bottom:1px solid var(--ln,#eee)}
.co-line:last-child{border-bottom:0}
.co-line img{width:64px;height:64px;object-fit:cover;border-radius:8px;background:var(--sf2,#f4f4f5);flex:0 0 64px}
.co-line .co-nm{font-weight:600;font-size:14px}
.co-line .co-vr{font-size:12px;color:var(--tx3,#6b7280)}
.co-line .co-amt{margin-left:auto;font-weight:600;font-variant-numeric:tabular-nums}
.co-qty{display:inline-flex;align-items:center;border:1px solid var(--ln,#e5e7eb);border-radius:8px;overflow:hidden}
.co-qty button{border:0;background:transparent;padding:5px 10px;cursor:pointer;font-size:15px;line-height:1}
.co-qty span{min-width:26px;text-align:center;font-size:13px}
.co-act{display:flex;gap:10px;margin-top:18px}
.co-act .btn{flex:1}
.co-back{background:transparent;border:0;color:var(--tx3,#6b7280);font:inherit;font-size:13px;cursor:pointer;padding:0;margin-bottom:14px}
.co-back:hover{color:var(--tx,#111)}
.co-field{margin-bottom:16px}
.co-field label{display:block;font-size:12px;font-weight:600;margin-bottom:6px}
.co-field input{width:100%;padding:11px 13px;border:1px solid var(--ln,#e5e7eb);border-radius:9px;font:inherit}
/* Quick buy opens the same flow in a sheet rather than navigating away. */
.co-quick{position:fixed;inset:0;z-index:80;display:none}
.co-quick.on{display:block}
.co-quick__veil{position:absolute;inset:0;background:rgba(0,0,0,.4)}
.co-quick__sheet{position:absolute;right:0;top:0;bottom:0;width:min(460px,100%);background:var(--sf,#fff);
  overflow-y:auto;padding:22px;box-shadow:-14px 0 44px rgba(0,0,0,.18)}
@media(max-width:600px){.co-quick__sheet{top:auto;width:100%;max-height:88vh;border-radius:16px 16px 0 0}}
`;

/** Server-rendered shell. Everything inside is filled by the runtime. */
export function checkoutFlowMarkup(): string {
  return `
<div class="co-flow" id="co-flow">
  <div class="co-summary">
    <div>
      <div class="co-meta" id="co-mode-label">Cart</div>
      <div class="co-sub" id="co-count">—</div>
    </div>
    <div class="co-sums" id="co-sums" hidden>
      <div class="co-sumrow"><span>Subtotal</span><span id="co-sum-sub">—</span></div>
      <div class="co-sumrow"><span>Shipping</span><span id="co-sum-ship">—</span></div>
      <div class="co-sumrow" id="co-sum-taxrow" hidden><span>Tax</span><span id="co-sum-tax">—</span></div>
    </div>
    <div class="co-total" id="co-total">—</div>
    <button id="co-cta" type="button">Checkout</button>
  </div>
  <div class="co-panel">
    <div class="co-step on" id="co-step-cart"><p class="page-sub">Loading…</p></div>
    <div class="co-step" id="co-step-pay"></div>
  </div>
</div>
${quickBuySheetMarkup()}`;
}

/**
 * The quick-buy sheet on its own.
 *
 * Any page that renders a data-quick-buy control needs this markup present —
 * the shop grid does, and did not have it, so every "Quick buy" on a card was
 * a button that ran and then had no sheet to open. CHECKOUT_FLOW_RUNTIME is
 * safe to ship alongside it anywhere: its boot() returns early without
 * #co-flow, and the quick-buy click handler is registered outside boot.
 */
export function quickBuySheetMarkup(): string {
  return `
<div class="co-quick" id="co-quick">
  <div class="co-quick__veil" data-quick-close></div>
  <div class="co-quick__sheet">
    <button class="co-back" data-quick-close type="button">← Keep shopping</button>
    <div id="co-quick-body"></div>
  </div>
</div>`;
}

export const CHECKOUT_FLOW_RUNTIME = `
(function(){
  var F = {}; // selected payment method
  var fmt = function(m){ return (m/100).toLocaleString('en-US',{style:'currency',currency:'USD'}); };
  // A coupon code and a milieu name are both operator-authored strings that
  // reach this markup by concatenation — they get escaped like anything else.
  var esc = function(v){ return String(v == null ? '' : v).replace(/[&<>"']/g, function(c){
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]; }); };
  var el = function(id){ return document.getElementById(id); };

  // The mobile bar's button mirrors the in-panel action rather than being a
  // second implementation of it — one of them drifting is how a "Place order"
  // button ends up doing nothing.
  function setCta(label, handler, disabled){
    var cta = el('co-cta');
    if (!cta) return;
    cta.textContent = label;
    cta.disabled = !!disabled;
    cta.onclick = handler || null;
  }

  function setSummary(t, mode){
    if (!el('co-total')) return;
    el('co-total').textContent = fmt(t.total);
    var sums = el('co-sums');
    if (sums) {
      // Shown only once an address exists — before that, shipping and tax are
      // genuinely unknown, and a breakdown reading "Free" would be a guess.
      var known = mode === 'pay' && (t.shipping > 0 || t.tax > 0 || SHIP_QUOTED);
      sums.hidden = !known;
      if (known) {
        el('co-sum-sub').textContent = fmt(t.subtotal);
        el('co-sum-ship').textContent = t.shipping > 0 ? fmt(t.shipping) : 'Free';
        el('co-sum-taxrow').hidden = !(t.tax > 0);
        if (t.tax > 0) el('co-sum-tax').textContent = fmt(t.tax);
      }
    }
    var n = t.lines.reduce(function(a,l){ return a + l.quantity; }, 0);
    el('co-count').textContent = n + (n === 1 ? ' item' : ' items');
    el('co-mode-label').textContent = mode === 'pay' ? 'Checkout' : 'Cart';
  }

  function lineRow(l){
    return '<div class="co-line">'
      + (l.image ? '<img src="' + l.image + '" alt="">' : '<img alt="">')
      + '<div><div class="co-nm">' + l.productName + '</div>'
      + '<div class="co-vr">' + [l.color, l.size, l.sku].filter(Boolean).join(' · ') + '</div></div>'
      + '<span class="co-qty"><button data-dec="' + l.variantId + '" aria-label="Decrease">−</button>'
      + '<span>' + l.quantity + '</span>'
      + '<button data-inc="' + l.variantId + '" data-q="' + l.quantity + '" aria-label="Increase">+</button></span>'
      + '<span class="co-amt">' + fmt(l.lineTotal) + '</span></div>';
  }

  function empty(){
    return '<div class="empty-state"><div class="big">🛒</div><p>Your cart is empty.</p>'
      + '<p style="margin-top:14px"><a class="btn" href="/shop">Browse the shop</a></p></div>';
  }

  async function load(){
    if (!tok()) return null;
    try { return await api('/cart', { useToken: true }); } catch (e) { setTok(null); return null; }
  }

  async function renderCart(){
    var c = await load();
    var step = el('co-step-cart');
    if (!c || !c.totals.lines.length) { step.innerHTML = empty(); return; }
    var t = c.totals;
    setSummary(t, 'cart');
    // Coupon row. A member never sees the input at all — offering a box that
    // is guaranteed to refuse is worse than not offering one, and the reason
    // is stated instead. Their price already IS the floor.
    var couponRow = t.discount
      ? '<div class="co-coupon co-coupon--member">'
        + '<span class="co-coupon__lock">' + esc(t.discount.label) + ' applied</span>'
        + '<span class="co-coupon__note">' + esc(t.couponBlocked || 'Codes do not stack on top of your member price.') + '</span>'
        + '</div>'
      : t.coupon
        ? '<div class="co-coupon">'
          + '<span class="co-coupon__on">Code ' + esc(t.coupon.code) + ' applied</span>'
          + '<button class="co-coupon__x" type="button" id="co-coupon-remove">Remove</button>'
          + '</div>'
        : '<form class="co-coupon" id="co-coupon-form">'
          + '<input id="co-coupon-code" name="code" placeholder="Discount code" autocomplete="off" spellcheck="false">'
          + '<button class="co-coupon__go" type="submit">Apply</button>'
          + '<span class="co-coupon__err" id="co-coupon-err"></span>'
          + '</form>';

    step.innerHTML = t.lines.map(lineRow).join('')
      + couponRow
      + '<div class="co-act"><button class="btn" id="co-go-pay" type="button">Checkout</button></div>';

    var couponForm = el('co-coupon-form');
    if (couponForm) couponForm.addEventListener('submit', async function(e){
      e.preventDefault();
      var code = el('co-coupon-code').value.trim();
      if (!code) return;
      var err = el('co-coupon-err');
      err.textContent = '';
      try {
        await api('/cart/coupon', { method:'POST', body: JSON.stringify({ cartToken: tok(), code: code }) });
        renderCart();
      } catch (ex) {
        // The server's own words — it knows whether this was a member block,
        // an expired code or an unknown one, and says so uniformly where it
        // must (see coupon.service.ts on enumeration).
        err.textContent = ex.message;
      }
    });
    var couponX = el('co-coupon-remove');
    if (couponX) couponX.addEventListener('click', async function(){
      await api('/cart/coupon', { method:'DELETE' }).catch(function(){});
      renderCart();
    });

    step.querySelectorAll('[data-inc]').forEach(function(b){
      b.addEventListener('click', async function(){
        await api('/cart/items/' + b.dataset.inc, { method:'PATCH', body: JSON.stringify({ cartToken: tok(), quantity: Number(b.dataset.q) + 1 }) }).catch(function(e){ alert(e.message); });
        renderCart(); refreshCount();
      });
    });
    step.querySelectorAll('[data-dec]').forEach(function(b){
      b.addEventListener('click', async function(){
        var l = t.lines.find(function(x){ return x.variantId === b.dataset.dec; });
        await api('/cart/items/' + b.dataset.dec, { method:'PATCH', body: JSON.stringify({ cartToken: tok(), quantity: l.quantity - 1 }) }).catch(function(e){ alert(e.message); });
        renderCart(); refreshCount();
      });
    });
    var go = el('co-go-pay');
    if (go) go.addEventListener('click', function(){ toPay(true); });
    setCta('Checkout', function(){ toPay(true); }, false);
  }

  async function payMarkup(){
    var c = await load();
    if (!c || !c.totals.lines.length) return empty();
    var reg = await api('/checkout/methods').catch(function(){ return { methods: [], groups: [] }; });
    var t = c.totals;
    setSummary(t, 'pay');
    var avail = reg.methods.filter(function(m){ return m.available; });
    if (!F.id && avail.length) F = { id: avail[0].id, provider: avail[0].provider, label: avail[0].label };

    // Items stay visible on the payment step: the brief is price at top, items
    // below, in BOTH modes — hiding what they are buying at the moment they pay
    // is where doubt creeps in.
    var items = t.lines.map(function(l){
      return '<div class="co-line"><div><div class="co-nm">' + l.quantity + ' × ' + l.productName + '</div>'
        + '<div class="co-vr">' + [l.color, l.size].filter(Boolean).join(' · ') + '</div></div>'
        + '<span class="co-amt">' + fmt(l.lineTotal) + '</span></div>';
    }).join('');

    var methods = reg.methods.map(function(m){
      var on = F.id === m.id;
      return '<label class="co-line" style="cursor:' + (m.available ? 'pointer' : 'default') + ';opacity:' + (m.available ? 1 : .5) + '">'
        + '<input type="radio" name="co-method" value="' + m.id + '" data-p="' + (m.provider || '') + '" data-l="' + m.label + '"'
        + (on ? ' checked' : '') + (m.available ? '' : ' disabled') + '>'
        + '<div><div class="co-nm">' + m.label + '</div>'
        + (m.sub ? '<div class="co-vr">' + m.sub + '</div>' : '') + '</div>'
        + (m.available ? '' : '<span class="co-amt" style="font-size:11px">Setup required</span>')
        + '</label>';
    }).join('');

    return '<button class="co-back" id="co-back" type="button">← Back to cart</button>'
      + items
      + '<div class="co-field" style="margin-top:18px"><label for="co-email">Email for your receipt</label>'
      + '<input id="co-email" type="email" placeholder="you@example.com" autocomplete="email"></div>'
      + '<div class="co-field"><label>Shipping address</label>'
      + '<input id="co-name" placeholder="Full name" autocomplete="shipping name">'
      + '<input id="co-line1" placeholder="Street address" autocomplete="shipping address-line1">'
      + '<input id="co-line2" placeholder="Apartment, suite (optional)" autocomplete="shipping address-line2">'
      + '<div class="co-row2"><input id="co-city" placeholder="City" autocomplete="shipping address-level2">'
      + '<input id="co-region" placeholder="State / region" autocomplete="shipping address-level1"></div>'
      + '<div class="co-row2"><input id="co-postal" placeholder="Postal code" autocomplete="shipping postal-code">'
      + '<input id="co-country" placeholder="Country (US)" maxlength="2" autocomplete="shipping country"></div>'
      + '</div>'
      + '<div class="co-field" id="co-ship-field" hidden><label>Shipping method</label>'
      + '<div id="co-ship-rows"></div></div>'
      + '<div class="co-field"><label>Payment</label>' + (methods || '<p class="co-vr">No payment methods are connected yet.</p>') + '</div>'
      + '<div class="co-act"><button class="btn" id="co-place" type="button"' + (avail.length ? '' : ' disabled') + '>Place order · ' + fmt(t.total) + '</button></div>'
      + '<div id="co-msg"></div>';
  }

  var SHIP_QUOTED = false;

  function shipFieldsFrom(scope){
    function v(id){ var n = scope.querySelector(id); return n && n.value ? n.value.trim() : ''; }
    var a = { name: v('#co-name'), line1: v('#co-line1'), city: v('#co-city'), country: v('#co-country').toUpperCase() };
    var l2 = v('#co-line2'); if (l2) a.line2 = l2;
    var rg = v('#co-region'); if (rg) a.region = rg;
    var pc = v('#co-postal'); if (pc) a.postalCode = pc;
    return a;
  }

  function shipComplete(a){ return !!(a.name && a.line1 && a.city && a.country.length === 2); }

  // Ask for rates once the address is complete enough to quote against. The
  // server picks the cheapest when no method is passed, so the first render
  // already has a selection rather than an empty picker.
  async function quoteShipping(scope, methodId){
    var addr = shipFieldsFrom(scope);
    if (!shipComplete(addr)) return;
    var field = scope.querySelector('#co-ship-field');
    var rows = scope.querySelector('#co-ship-rows');
    if (!rows) return;
    try {
      var body = { cartToken: tok(), shipAddress: addr };
      if (methodId) body.methodId = methodId;
      var out = await api('/cart/shipping', { method:'POST', body: JSON.stringify(body) });
      SHIP_QUOTED = true;
      rows.innerHTML = (out.rates || []).map(function(r){
        return '<label class="co-shiprow' + (r.id === out.selected ? ' active' : '') + '">'
          + '<input type="radio" name="co-ship" value="' + r.id + '"' + (r.id === out.selected ? ' checked' : '') + '>'
          + '<span class="co-shipl"><span class="co-shipname">' + r.name + '</span>'
          + '<span class="co-shipsub">' + (r.detail || '') + '</span></span>'
          + '<span class="co-shipprice">' + (r.amount > 0 ? fmt(r.amount) : 'Free') + '</span></label>';
      }).join('');
      if (field) field.hidden = false;
      rows.querySelectorAll('input[name=co-ship]').forEach(function(radio){
        radio.addEventListener('change', function(){ quoteShipping(scope, radio.value); });
      });
      setSummary(out.totals, 'pay');
      var place = scope.querySelector('#co-place');
      if (place && !place.disabled) {
        place.textContent = 'Place order · ' + fmt(out.totals.total);
        setCta(place.textContent, function(){ place.click(); }, false);
      }
    } catch (e) {
      // A quote that fails must not block checkout — the order still carries
      // the address, and shipping is settled at fulfillment.
    }
  }

  function wirePay(scope){
    var back = scope.querySelector('#co-back');
    if (back) back.addEventListener('click', function(){ toCart(true); });
    scope.querySelectorAll('input[name=co-method]').forEach(function(r){
      r.addEventListener('change', function(){ F = { id: r.value, provider: r.dataset.p, label: r.dataset.l }; });
    });
    ['#co-name','#co-line1','#co-line2','#co-city','#co-region','#co-postal','#co-country'].forEach(function(sel){
      var n = scope.querySelector(sel);
      if (n) n.addEventListener('change', function(){ quoteShipping(scope); });
    });
    var place = scope.querySelector('#co-place');
    if (place) setCta(place.textContent, function(){ place.click(); }, place.disabled);
    if (place) place.addEventListener('click', async function(){
      var email = (scope.querySelector('#co-email') || {}).value || '';
      var msg = scope.querySelector('#co-msg');
      function fieldVal(id){ var n = scope.querySelector(id); return n && n.value ? n.value.trim() : ''; }
      var ship = {
        name: fieldVal('#co-name'),
        line1: fieldVal('#co-line1'),
        city: fieldVal('#co-city'),
        country: fieldVal('#co-country').toUpperCase()
      };
      var line2 = fieldVal('#co-line2'); if (line2) ship.line2 = line2;
      var region = fieldVal('#co-region'); if (region) ship.region = region;
      var postal = fieldVal('#co-postal'); if (postal) ship.postalCode = postal;
      // Checked here so the shopper gets the message next to the button rather
      // than a 422 after the order attempt. The server validates it too.
      var missing = [];
      if (!ship.name) missing.push('name');
      if (!ship.line1) missing.push('street address');
      if (!ship.city) missing.push('city');
      if (ship.country.length !== 2) missing.push('2-letter country code');
      if (missing.length) {
        if (msg) msg.innerHTML = '<p class="notice err">Add your ' + missing.join(', ') + '.</p>';
        return;
      }
      place.disabled = true; place.textContent = 'Placing…';
      try {
        if (email) await api('/cart/identity', { method:'POST', body: JSON.stringify({ cartToken: tok(), email: email }) });
        var out = await api('/cart/checkout', { method:'POST', body: JSON.stringify({ cartToken: tok(), method: F.id, provider: F.provider, shipAddress: ship }) });
        setTok(null); refreshCount();
        location.href = out.redirectUrl || ('/order-received/?order=' + out.number + '&token=' + out.accessToken);
      } catch (e) {
        place.disabled = false; place.textContent = 'Place order'; setCta('Place order', function(){ place.click(); }, false);
        if (msg) msg.innerHTML = '<p class="notice err">' + e.message + '</p>';
      }
    });
  }

  async function toPay(push){
    var step = el('co-step-pay');
    if (!step) return;
    step.innerHTML = await payMarkup();
    el('co-step-cart').classList.remove('on');
    step.classList.add('on');
    wirePay(step);
    // A real URL, so refresh and back both behave — a mode kept only in memory
    // strands anyone who reloads mid-checkout.
    if (push) history.pushState({ co:'pay' }, '', '/checkout');
  }
  async function toCart(push){
    el('co-step-pay').classList.remove('on');
    el('co-step-cart').classList.add('on');
    await renderCart();
    if (push) history.pushState({ co:'cart' }, '', '/cart');
  }

  window.addEventListener('popstate', function(e){
    if (!el('co-flow')) return;
    ((e.state && e.state.co) === 'pay') ? toPay(false) : toCart(false);
  });

  // ── Quick buy: same component, opened in a sheet from a PDP or a card ──
  async function quickBuy(variantId){
    var sheet = el('co-quick'), body = el('co-quick-body');
    if (!sheet || !body) return;
    try { await api('/cart/items', { method:'POST', body: JSON.stringify({ cartToken: tok(), variantId: variantId, quantity: 1 }) }).then(function(r){ if (r && r.token) setTok(r.token); }); }
    catch (e) { alert(e.message); return; }
    refreshCount();
    sheet.classList.add('on');
    body.innerHTML = '<div class="co-summary"><div><div class="co-meta">Checkout</div><div class="co-sub" id="co-count">—</div></div><div class="co-total" id="co-total">—</div></div><div id="co-quick-step"></div>';
    var step = document.getElementById('co-quick-step');
    step.innerHTML = await payMarkup();
    wirePay(step);
  }

  document.addEventListener('click', function(e){
    var q = e.target.closest && e.target.closest('[data-quick-buy]');
    if (q) { e.preventDefault(); quickBuy(q.getAttribute('data-quick-buy')); return; }
    if (e.target.closest && e.target.closest('[data-quick-close]')) {
      var s = el('co-quick'); if (s) s.classList.remove('on');
    }
  });

  // The ported page shell sets will-change:transform on #brx-content for its
  // page transitions, and a transformed ancestor becomes the containing block
  // for position:fixed — which pinned the bar 380px up the page instead of to
  // the viewport. Re-parenting it to body is the only reliable escape.
  function reparentBar(){
    var bar = document.querySelector('.co-summary');
    if (!bar) return;
    var mobile = window.matchMedia('(max-width: 767px)').matches;
    if (mobile && bar.parentNode !== document.body) document.body.appendChild(bar);
  }

  function boot(){
    if (!el('co-flow')) return;
    reparentBar();
    window.addEventListener('resize', reparentBar);
    // /checkout deep-links straight to the payment step; /cart starts on items.
    if (location.pathname.indexOf('/checkout') === 0) { history.replaceState({ co:'pay' }, '', location.pathname); toPay(false); }
    else { history.replaceState({ co:'cart' }, '', location.pathname); renderCart(); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
`;

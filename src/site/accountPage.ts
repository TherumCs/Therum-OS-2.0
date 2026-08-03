// The storefront account page.
//
// The customer auth API had existed for a while — register, password sign-in,
// emailed/SMS code, social sign-in, session listing, identity unlinking — with
// no page in front of it, so the header's account icon linked at /my-account/
// and 404'd. This is that page, and then the rest of what an account is for.
//
// SHAPE: a dashboard, not a settings screen. Bam's reference is the Xfinity
// account — the thing it gets right is that the landing view is a grid of
// cards, each showing real state and offering exactly one action, with the
// depth behind it rather than in front of it. So:
//
//   Overview   cards — offers waiting, your last order, saved items, picks
//   Orders     full history, with line items and thumbnails
//   Offers     coupons a merchant pushed to YOU; claim to reveal the code
//   Wishlist   the same list the header's heart keeps
//   For you    products picked from what you have actually bought
//
// It should read like a small storefront, so every card that CAN carry product
// imagery does. An account page that is five rows of grey text is where people
// go once and never return.
//
// The session token goes to BOTH localStorage and a `th_customer` cookie: the
// browser code reads the first, and the API accepts either an Authorization
// header or that cookie, so a server-rendered page already knows the shopper.
// It is not HttpOnly and cannot be — the same token is handed to this script in
// the sign-in response.
//
// The offer code is NOT in the offers payload until the shopper claims it.
// A "personal" discount whose code ships to the page unclaimed is a public
// discount with extra steps.

export const ACCOUNT_CSS = `
.th-acct{max-width:420px;margin:0 auto;padding:20px 0 60px}
.th-acct--wide{max-width:1100px}
.th-acct__tabs{display:flex;gap:0;margin-bottom:30px;border-bottom:solid 1px var(--border-color-light,rgba(0,0,0,.12));overflow-x:auto}
.th-acct__tab{flex:1 0 auto;padding:13px 14px;background:none;border:0;border-bottom:solid 2px transparent;cursor:pointer;
  font:inherit;font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--text-color-light,#888);white-space:nowrap}
.th-acct__tab[aria-selected="true"]{color:inherit;border-bottom-color:currentColor}
.th-acct__tab-count{display:inline-block;margin-left:6px;padding:0 5px;min-width:16px;height:16px;line-height:16px;
  border-radius:8px;font-size:9px;background:var(--accent-color,#c0392b);color:#fff;vertical-align:middle}
.th-acct__tab-count:empty{display:none}
.th-acct label{display:block;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;margin:16px 0 6px}
.th-acct input{width:100%;padding:12px 14px;border:solid 1px var(--border-color-light,rgba(0,0,0,.15));background:none;font:inherit;font-size:15px}
.th-acct input:focus{outline:0;border-color:currentColor}
/* --button-color is the theme's button FILL, not its text. */
.th-acct__submit{width:100%;margin-top:22px;padding:14px;background:var(--button-color,#111);color:var(--white-color,#fff);
  border:0;cursor:pointer;font:inherit;font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase}
.th-acct__submit[disabled]{opacity:.5;cursor:default}
.th-acct__msg{margin-top:16px;font-size:13px;line-height:1.5}
.th-acct__msg--bad{color:var(--accent-color,#c0392b)}
.th-acct__empty{padding:44px 0;text-align:center;font-size:13px;color:var(--text-color-light,#888)}
.th-acct__empty a{text-decoration:underline}
.th-acct__panel[hidden]{display:none}
.th-ph{background:var(--background-color-dark,#f2f2f2);display:block}

/* ── Dashboard ─────────────────────────────────────────────────────────── */
.th-hello{margin-bottom:26px}
.th-hello__hi{font-size:24px;font-weight:600;letter-spacing:-.01em}
.th-hello__sub{font-size:13px;color:var(--text-color-light,#888);margin-top:4px}
.th-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:18px}
.th-card{border:solid 1px var(--border-color-light,rgba(0,0,0,.12));padding:22px;display:flex;flex-direction:column}
.th-card--span{grid-column:1/-1}
.th-card__label{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text-color-light,#888);margin-bottom:14px}
.th-card__big{font-size:26px;font-weight:600;letter-spacing:-.01em;line-height:1.15}
.th-card__note{font-size:13px;color:var(--text-color-light,#888);margin-top:6px;line-height:1.5}
.th-card__act{margin-top:auto;padding-top:18px}
.th-card__act button,.th-card__act a{display:inline-block;padding:11px 18px;border:solid 1px currentColor;background:none;
  cursor:pointer;text-decoration:none;color:inherit;font:inherit;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.th-card__act .th-solid{background:var(--button-color,#111);color:var(--white-color,#fff);border-color:var(--button-color,#111)}
.th-strip{display:flex;gap:10px;flex-wrap:wrap}
.th-strip img,.th-strip .th-ph{width:62px;height:62px;object-fit:cover;flex:0 0 62px}
.th-strip__more{width:62px;height:62px;display:flex;align-items:center;justify-content:center;
  border:solid 1px var(--border-color-light,rgba(0,0,0,.12));font-size:12px;color:var(--text-color-light,#888)}
.th-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--accent-color,#c0392b);margin-right:7px;vertical-align:middle}

/* ── Orders ────────────────────────────────────────────────────────────── */
.th-order{border:solid 1px var(--border-color-light,rgba(0,0,0,.12));padding:18px 20px;margin-bottom:14px}
.th-order__head{display:flex;justify-content:space-between;align-items:baseline;gap:14px;flex-wrap:wrap;margin-bottom:14px}
.th-order__no{font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.th-order__when{font-size:12px;color:var(--text-color-light,#888)}
.th-order__status{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:4px 9px;border:solid 1px currentColor}
.th-order__total{margin-top:14px;padding-top:12px;border-top:solid 1px var(--border-color-light,rgba(0,0,0,.08));
  display:flex;justify-content:space-between;font-size:14px;font-weight:600}
.th-order__line{display:flex;gap:14px;align-items:center;padding:8px 0;font-size:13px}
.th-order__line img,.th-order__line .th-ph{width:46px;height:46px;flex:0 0 46px;object-fit:cover}
.th-order__line-amt{margin-left:auto;font-variant-numeric:tabular-nums}

/* ── Offers ────────────────────────────────────────────────────────────── */
.th-offer{border:solid 1px var(--border-color-light,rgba(0,0,0,.12));padding:20px;margin-bottom:14px}
.th-offer--claimed{border-color:currentColor}
.th-offer__title{font-size:15px;font-weight:600;margin-bottom:6px}
.th-offer__msg{font-size:13px;line-height:1.5;color:var(--text-color-light,#888)}
.th-offer__value{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin-bottom:10px}
.th-offer__foot{margin-top:16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.th-offer__foot button{padding:11px 18px;background:var(--button-color,#111);color:var(--white-color,#fff);border:0;
  cursor:pointer;font:inherit;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.th-offer__foot button.th-offer__skip{background:none;color:inherit;border:solid 1px var(--border-color-light,rgba(0,0,0,.15))}
.th-offer__code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:15px;font-weight:700;letter-spacing:.12em;
  padding:10px 16px;border:dashed 1px currentColor}
.th-offer__fine{font-size:11px;color:var(--text-color-light,#888)}

/* ── Product strips ────────────────────────────────────────────────────── */
.th-picks{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:24px}
.th-pick{text-decoration:none;color:inherit;display:block}
.th-pick img,.th-pick .th-ph{width:100%;aspect-ratio:1;object-fit:cover}
.th-pick__nm{font-size:13px;font-weight:500;margin-top:10px;line-height:1.35}
.th-pick__pr{font-size:12px;color:var(--text-color-light,#888);margin-top:3px}
.th-picks__basis{font-size:12px;color:var(--text-color-light,#888);margin-bottom:18px}

/* ── Details ───────────────────────────────────────────────────────────── */
.th-acct__row{display:flex;justify-content:space-between;align-items:baseline;gap:14px;padding:14px 0;
  border-bottom:solid 1px var(--border-color-light,rgba(0,0,0,.08));font-size:14px}
.th-acct__social{display:flex;flex-direction:column;gap:8px;margin-bottom:14px}
.th-acct__social button{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;
padding:11px 14px;border:1px solid var(--th-line,#d8dade);border-radius:10px;background:#fff;color:#3c4043;
cursor:pointer;font:inherit;font-size:13px;font-weight:600}
.th-acct__social button:hover{background:#f8f9fa}
.th-acct__or{display:flex;align-items:center;gap:10px;color:#9ca3af;font-size:11px;margin-bottom:14px;
text-transform:uppercase;letter-spacing:.08em}
.th-acct__or::before,.th-acct__or::after{content:"";flex:1;height:1px;background:var(--th-line,#e5e7eb)}
.th-acct__row span:first-child{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--text-color-light,#888)}
.th-acct__out{margin-top:26px;display:flex;gap:10px;flex-wrap:wrap}
.th-acct__out button{flex:1 1 auto;padding:12px 16px;border:solid 1px currentColor;background:none;cursor:pointer;
  font:inherit;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
`;

/**
 * @param wishlist the wishlist table markup, so the Wishlist tab reuses the
 * ONE implementation of that list (wishlist.ts) rather than growing a second.
 */
export function accountMarkup(wishlist: string, googleClientId = ''): string {
  return `
<div class="th-acct" data-account>
  <div data-acct-guest hidden>
    <div class="th-acct__tabs" role="tablist">
      <button class="th-acct__tab" type="button" role="tab" data-acct-authtab="signin" aria-selected="true">Sign in</button>
      <button class="th-acct__tab" type="button" role="tab" data-acct-authtab="register" aria-selected="false">Create account</button>
    </div>
    <!--
      Social sign-in. Rendered empty and filled by the runtime from
      /shop/account/oauth/providers, so a button only ever appears for a
      provider actually connected in Nexus — a button that does nothing is
      worse than no button.
    -->
    <div class="th-acct__social" data-acct-social hidden data-google-client-id="${googleClientId}"></div>
    <div class="th-acct__or" data-acct-or hidden><span>or</span></div>
    <form data-acct-form="signin">
      <label for="acct-email">Email</label>
      <input id="acct-email" name="email" type="email" autocomplete="email" required>
      <label for="acct-pass">Password</label>
      <input id="acct-pass" name="password" type="password" autocomplete="current-password" required>
      <button class="th-acct__submit" type="submit">Sign in</button>
    </form>
    <form data-acct-form="register" hidden>
      <label for="acct-name">Name</label>
      <input id="acct-name" name="name" type="text" autocomplete="name">
      <label for="acct-remail">Email</label>
      <input id="acct-remail" name="email" type="email" autocomplete="email" required>
      <label for="acct-rpass">Password</label>
      <input id="acct-rpass" name="password" type="password" autocomplete="new-password" minlength="8" required>
      <button class="th-acct__submit" type="submit">Create account</button>
    </form>
    <p class="th-acct__msg" data-acct-msg></p>
  </div>

  <div data-acct-user hidden>
    <div class="th-acct__tabs" role="tablist">
      <button class="th-acct__tab" type="button" role="tab" data-acct-tab="overview" aria-selected="true">Overview</button>
      <button class="th-acct__tab" type="button" role="tab" data-acct-tab="orders" aria-selected="false">Orders</button>
      <button class="th-acct__tab" type="button" role="tab" data-acct-tab="offers" aria-selected="false">Offers<span class="th-acct__tab-count" data-acct-offer-count></span></button>
      <button class="th-acct__tab" type="button" role="tab" data-acct-tab="wishlist" aria-selected="false">Wishlist</button>
      <button class="th-acct__tab" type="button" role="tab" data-acct-tab="picks" aria-selected="false">For you</button>
      <button class="th-acct__tab" type="button" role="tab" data-acct-tab="details" aria-selected="false">Details</button>
    </div>

    <div class="th-acct__panel" data-acct-panel="overview">
      <div class="th-hello">
        <div class="th-hello__hi" data-acct-hello></div>
        <div class="th-hello__sub" data-acct-since></div>
      </div>
      <div class="th-cards" data-acct-cards></div>
    </div>

    <div class="th-acct__panel" data-acct-panel="orders" hidden><p class="th-acct__empty">Loading…</p></div>
    <div class="th-acct__panel" data-acct-panel="offers" hidden><p class="th-acct__empty">Loading…</p></div>
    <div class="th-acct__panel" data-acct-panel="wishlist" hidden>${wishlist}</div>
    <div class="th-acct__panel" data-acct-panel="picks" hidden><p class="th-acct__empty">Loading…</p></div>

    <div class="th-acct__panel" data-acct-panel="details" hidden>
      <div class="th-acct__row"><span>Name</span><span data-acct-name></span></div>
      <div class="th-acct__row"><span>Email</span><span data-acct-email></span></div>
      <div class="th-acct__row" data-acct-identities-row hidden><span>Signed in with</span><span data-acct-identities></span></div>
      <div class="th-acct__out">
        <button type="button" data-acct-signout>Sign out</button>
        <button type="button" data-acct-signout-all>Sign out everywhere</button>
      </div>
      <p class="th-acct__msg" data-acct-msg2></p>
    </div>
  </div>
</div>`;
}

export const ACCOUNT_RUNTIME = `
(function(){
  var root = document.querySelector('[data-account]');
  if (!root) return;
  var KEY = 'therum_customer_token';
  var guest = root.querySelector('[data-acct-guest]');
  var user = root.querySelector('[data-acct-user]');
  var msg = root.querySelector('[data-acct-msg]');
  var msg2 = root.querySelector('[data-acct-msg2]');
  var loaded = {};

  /**
   * Social sign-in.
   *
   * Buttons are built from what the STORE says is connected, never hardcoded:
   * /shop/account/oauth/providers reports each provider's readiness, so a
   * button can only appear for one that will actually work. Google's script is
   * fetched lazily and only if Google is ready — no third-party request on a
   * page that has nothing to use it for.
   */
  var socialBox = root.querySelector('[data-acct-social]');
  var socialOr = root.querySelector('[data-acct-or]');

  function gsiScript(){
    return new Promise(function(resolve, reject){
      if (window.google && window.google.accounts) return resolve();
      var el = document.createElement('script');
      el.src = 'https://accounts.google.com/gsi/client';
      el.async = true;
      el.onload = resolve;
      el.onerror = function(){ reject(new Error('Google sign-in could not load.')); };
      document.head.appendChild(el);
    });
  }

  async function socialSignedIn(provider, token){
    msg.className = 'th-acct__msg';
    msg.textContent = 'Signing in…';
    try {
      var r = await api('/shop/account/oauth/' + provider, {
        method: 'POST', body: JSON.stringify({ token: token }),
      });
      setTok(r.token, r.expiresAt);
      msg.textContent = '';
      showUser(Object.assign({ identities: [] }, r.customer));
      // Same cart-adoption step the password path does — a basket started
      // before signing in belongs to the same person.
      var cartToken = localStorage.getItem('therum_cart_token');
      if (cartToken && r.customer && r.customer.email) {
        try { await api('/cart/identity', { method: 'POST', body: JSON.stringify({ cartToken: cartToken, email: r.customer.email }) }); }
        catch (err) {}
      }
    } catch (err) {
      msg.className = 'th-acct__msg th-acct__msg--bad';
      msg.textContent = err.message;
    }
  }

  async function initSocial(){
    if (!socialBox) return;
    var ready = [];
    try {
      var r = await api('/shop/account/oauth/providers');
      ready = (r.providers || []).filter(function(p){ return p.ready; });
    } catch (err) { return; }
    if (!ready.length) return;

    var hasGoogle = ready.some(function(p){ return p.provider === 'google'; });
    if (hasGoogle) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.innerHTML = '<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">'
        + '<path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/>'
        + '<path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/>'
        + '<path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"/>'
        + '<path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/>'
        + '</svg><span>Continue with Google</span>';
      btn.addEventListener('click', async function(){
        try {
          await gsiScript();
          var cid = socialBox.getAttribute('data-google-client-id');
          if (!cid) throw new Error('Google sign-in is not configured.');
          window.google.accounts.id.initialize({
            client_id: cid,
            callback: function(res){ socialSignedIn('google', res.credential); },
          });
          window.google.accounts.id.prompt();
        } catch (err) {
          msg.className = 'th-acct__msg th-acct__msg--bad';
          msg.textContent = err.message;
        }
      });
      socialBox.appendChild(btn);
    }

    if (socialBox.children.length) {
      socialBox.hidden = false;
      if (socialOr) socialOr.hidden = false;
    }
  }

  function tok(){ return localStorage.getItem(KEY); }
  function setTok(t, expiresAt){
    if (t) {
      localStorage.setItem(KEY, t);
      var maxAge = expiresAt ? Math.max(0, Math.floor((new Date(expiresAt) - new Date()) / 1000)) : 2592000;
      document.cookie = 'th_customer=' + encodeURIComponent(t) + ';path=/;max-age=' + maxAge + ';samesite=lax';
    } else {
      localStorage.removeItem(KEY);
      document.cookie = 'th_customer=;path=/;max-age=0;samesite=lax';
    }
  }
  async function api(path, opts){
    opts = opts || {};
    var headers = Object.assign({'content-type':'application/json'}, opts.headers || {});
    if (tok()) headers.authorization = 'Bearer ' + tok();
    var res = await fetch('/api' + path, Object.assign({}, opts, { headers: headers }));
    var body = await res.json().catch(function(){ return {}; });
    if (!res.ok) throw Object.assign(new Error((body.error && body.error.message) || 'Something went wrong.'), { status: res.status });
    return body;
  }
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]; }); }
  function money(m, cur){ return (m/100).toLocaleString('en-US',{ style:'currency', currency: cur || 'USD' }); }
  function when(d){ return new Date(d).toLocaleDateString('en-US',{ year:'numeric', month:'short', day:'numeric' }); }
  function panel(name){ return root.querySelector('[data-acct-panel="' + name + '"]'); }
  function go(tab){ var b = root.querySelector('[data-acct-tab="' + tab + '"]'); if (b) b.click(); }
  function wishIds(){
    try { var v = JSON.parse(localStorage.getItem('therum_wishlist') || '[]'); return Array.isArray(v) ? v : []; }
    catch (err) { return []; }
  }

  function showGuest(){ guest.hidden = false; user.hidden = true; root.classList.remove('th-acct--wide'); }
  function showUser(me){
    guest.hidden = true; user.hidden = false; root.classList.add('th-acct--wide');
    root.querySelector('[data-acct-name]').textContent = me.name || '—';
    root.querySelector('[data-acct-email]').textContent = me.email;
    root.querySelector('[data-acct-hello]').textContent = me.name ? ('Hey, ' + me.name.split(' ')[0]) : 'Your account';
    root.querySelector('[data-acct-since]').textContent = me.email;
    var ids = me.identities || [];
    if (ids.length) {
      root.querySelector('[data-acct-identities-row]').hidden = false;
      root.querySelector('[data-acct-identities]').textContent = ids.map(function(i){ return i.provider; }).join(', ');
    }
    loaded = {};
    dashboard();
  }

  async function load(){
    if (!tok()) return showGuest();
    try { showUser(await api('/shop/account/me')); }
    catch (err) { setTok(null); showGuest(); }
  }

  // ── Tabs ────────────────────────────────────────────────────────────────
  root.querySelectorAll('[data-acct-authtab]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var want = btn.getAttribute('data-acct-authtab');
      root.querySelectorAll('[data-acct-authtab]').forEach(function(b){ b.setAttribute('aria-selected', String(b === btn)); });
      root.querySelectorAll('[data-acct-form]').forEach(function(f){ f.hidden = f.getAttribute('data-acct-form') !== want; });
      msg.textContent = '';
    });
  });

  root.querySelectorAll('[data-acct-tab]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var want = btn.getAttribute('data-acct-tab');
      root.querySelectorAll('[data-acct-tab]').forEach(function(b){ b.setAttribute('aria-selected', String(b === btn)); });
      root.querySelectorAll('[data-acct-panel]').forEach(function(p){ p.hidden = p.getAttribute('data-acct-panel') !== want; });
      section(want);
    });
  });

  // Deep panels fetch once, on first view. The dashboard is the exception —
  // it is the landing view, so its data is what the page is FOR.
  function section(name){
    if (name === 'orders' && !loaded.orders) { loaded.orders = true; renderOrders(); }
    if (name === 'offers' && !loaded.offers) { loaded.offers = true; renderOffers(true); }
    if (name === 'picks' && !loaded.picks) { loaded.picks = true; renderPicks(); }
    if (name === 'wishlist') window.dispatchEvent(new CustomEvent('therum:wishlist-changed'));
  }

  // ── Dashboard ───────────────────────────────────────────────────────────
  async function dashboard(){
    var el = root.querySelector('[data-acct-cards]');
    var results = await Promise.all([
      api('/shop/account/offers').catch(function(){ return { offers: [] }; }),
      api('/shop/account/orders').catch(function(){ return { orders: [] }; }),
      api('/shop/account/recommendations').catch(function(){ return { basis: 'new', products: [] }; }),
    ]);
    var offers = results[0].offers || [];
    var orders = results[1].orders || [];
    var picks = results[2].products || [];
    var live = offers.filter(function(o){ return o.status === 'active'; });
    root.querySelector('[data-acct-offer-count]').textContent = live.length > 0 ? String(live.length) : '';

    var cards = [];

    // Offers first when there are any — it is the only card with something
    // waiting on the shopper, and burying it defeats pushing it at all.
    if (live.length) {
      cards.push('<div class="th-card">'
        + '<div class="th-card__label"><span class="th-dot"></span>' + live.length + (live.length === 1 ? ' offer waiting' : ' offers waiting') + '</div>'
        + '<div class="th-card__big">' + esc(offerValue(live[0])) + '</div>'
        + '<div class="th-card__note">' + esc(live[0].title) + '</div>'
        + '<div class="th-card__act"><button type="button" class="th-solid" data-go="offers">See offers</button></div></div>');
    } else if (offers.length) {
      cards.push('<div class="th-card">'
        + '<div class="th-card__label">Your codes</div>'
        + '<div class="th-card__big">' + offers.length + ' claimed</div>'
        + '<div class="th-card__note">Ready to use at checkout.</div>'
        + '<div class="th-card__act"><button type="button" data-go="offers">View codes</button></div></div>');
    }

    // Last order
    if (orders.length) {
      var o = orders[0];
      cards.push('<div class="th-card">'
        + '<div class="th-card__label">Latest order</div>'
        + '<div class="th-card__big">' + money(o.total, o.currency) + '</div>'
        + '<div class="th-card__note">' + esc(o.number) + ' · ' + esc(o.status) + ' · ' + when(o.placedAt) + '</div>'
        + '<div class="th-strip" style="margin-top:16px">'
        +   o.items.slice(0, 4).map(function(i){
              return i.image ? '<img src="' + esc(i.image) + '" alt="" loading="lazy">' : '<span class="th-ph" style="width:62px;height:62px"></span>';
            }).join('')
        +   (o.items.length > 4 ? '<span class="th-strip__more">+' + (o.items.length - 4) + '</span>' : '')
        + '</div>'
        + '<div class="th-card__act"><button type="button" data-go="orders">All ' + orders.length + ' orders</button></div></div>');
    } else {
      cards.push('<div class="th-card">'
        + '<div class="th-card__label">Orders</div>'
        + '<div class="th-card__big">Nothing yet</div>'
        + '<div class="th-card__note">Your order history shows up here once you have one.</div>'
        + '<div class="th-card__act"><a class="th-solid" href="/shop">Start shopping</a></div></div>');
    }

    // Saved items — hydrated client-side, since the wishlist lives in this
    // browser rather than on the account.
    var saved = wishIds();
    cards.push('<div class="th-card">'
      + '<div class="th-card__label">Saved items</div>'
      + '<div class="th-card__big">' + saved.length + (saved.length === 1 ? ' item' : ' items') + '</div>'
      + (saved.length
          ? '<div class="th-strip" style="margin-top:16px" data-acct-saved-strip></div>'
          : '<div class="th-card__note">Tap the heart on anything to keep it here.</div>')
      + '<div class="th-card__act">'
      +   (saved.length ? '<button type="button" data-go="wishlist">View wishlist</button>' : '<a href="/shop">Browse the shop</a>')
      + '</div></div>');

    el.innerHTML = cards.join('');
    // After the markup lands — the strip's host does not exist before it.
    if (saved.length) savedStrip(saved);

    // Picks run full width — this is the part that should feel like a store.
    if (picks.length) {
      el.insertAdjacentHTML('beforeend', '<div class="th-card th-card--span">'
        + '<div class="th-card__label">' + (results[2].basis === 'history' ? 'Picked for you' : 'New in') + '</div>'
        + '<div class="th-picks">'
        + picks.map(pickHtml).join('')
        + '</div>'
        + '<div class="th-card__act"><a href="/shop">Shop everything</a></div></div>');
    }
  }

  // Thumbnails for the saved-items card. One request per product, because the
  // ids are the only thing this browser knows about them.
  async function savedStrip(ids){
    var host = root.querySelector('[data-acct-saved-strip]');
    if (!host) return;
    var products = await Promise.all(ids.slice(0, 5).map(async function(id){
      try { var r = await fetch('/api/products/' + encodeURIComponent(id)); return r.ok ? await r.json() : null; }
      catch (err) { return null; }
    }));
    host.innerHTML = products.filter(Boolean).map(function(p){
      return '<a href="/product/' + esc(p.slug) + '">'
        + (p.image ? '<img src="' + esc(p.image) + '" alt="' + esc(p.name) + '" loading="lazy">' : '<span class="th-ph" style="width:62px;height:62px"></span>')
        + '</a>';
    }).join('') + (ids.length > 5 ? '<span class="th-strip__more">+' + (ids.length - 5) + '</span>' : '');
  }

  function pickHtml(p){
    var prices = (p.variants || []).map(function(v){ return v.price; }).filter(function(n){ return typeof n === 'number'; });
    var from = prices.length ? Math.min.apply(null, prices) : null;
    return '<a class="th-pick" href="/product/' + esc(p.slug) + '">'
      + (p.image ? '<img src="' + esc(p.image) + '" alt="" loading="lazy">' : '<span class="th-ph"></span>')
      + '<div class="th-pick__nm">' + esc(p.name) + '</div>'
      + (from === null ? '' : '<div class="th-pick__pr">' + (prices.length > 1 ? 'From ' : '') + money(from) + '</div>')
      + '</a>';
  }

  root.addEventListener('click', function(e){
    var jump = e.target.closest && e.target.closest('[data-go]');
    if (jump) go(jump.getAttribute('data-go'));
  });

  // ── Orders ──────────────────────────────────────────────────────────────
  async function renderOrders(){
    var el = panel('orders');
    try {
      var r = await api('/shop/account/orders');
      var orders = r.orders || [];
      if (!orders.length) {
        el.innerHTML = '<p class="th-acct__empty">No orders yet. <a href="/shop">Start shopping</a></p>';
        return;
      }
      el.innerHTML = orders.map(function(o){
        return '<div class="th-order">'
          + '<div class="th-order__head">'
          +   '<div><div class="th-order__no">Order ' + esc(o.number) + '</div>'
          +   '<div class="th-order__when">' + when(o.placedAt) + '</div></div>'
          +   '<span class="th-order__status">' + esc(o.status) + '</span>'
          + '</div>'
          + o.items.map(function(i){
              return '<div class="th-order__line">'
                + (i.image ? '<img src="' + esc(i.image) + '" alt="" loading="lazy">' : '<span class="th-ph" style="width:46px;height:46px"></span>')
                + '<span>' + (i.slug ? '<a href="/product/' + esc(i.slug) + '">' + esc(i.name) + '</a>' : esc(i.name)) + ' × ' + i.quantity + '</span>'
                + '<span class="th-order__line-amt">' + money(i.lineTotal, o.currency) + '</span></div>';
            }).join('')
          + '<div class="th-order__total"><span>' + (o.discountLabel ? esc(o.discountLabel) + ' applied' : 'Total') + '</span>'
          +   '<span>' + money(o.total, o.currency) + '</span></div>'
          + '</div>';
      }).join('');
    } catch (err) {
      el.innerHTML = '<p class="th-acct__empty">Could not load your orders.</p>';
    }
  }

  // ── Offers ──────────────────────────────────────────────────────────────
  function offerValue(o){
    var v = o.discount.type === 'percent' ? o.discount.amount + '% off' : money(o.discount.amount) + ' off';
    if (o.minimumAmount) v += ' · spend ' + money(o.minimumAmount) + '+';
    return v;
  }

  async function offerBadge(){
    try {
      var r = await api('/shop/account/offers');
      var live = (r.offers || []).filter(function(o){ return o.status === 'active'; }).length;
      root.querySelector('[data-acct-offer-count]').textContent = live > 0 ? String(live) : '';
    } catch (err) {}
  }

  async function renderOffers(markSeen){
    var el = panel('offers');
    try {
      var r = await api('/shop/account/offers');
      var offers = r.offers || [];
      if (!offers.length) {
        el.innerHTML = '<p class="th-acct__empty">No offers right now. We will put them here when there are.</p>';
        return;
      }
      el.innerHTML = offers.map(function(o){
        return '<div class="th-offer' + (o.status === 'claimed' ? ' th-offer--claimed' : '') + '">'
          + '<div class="th-offer__value">' + esc(offerValue(o)) + '</div>'
          + '<div class="th-offer__title">' + esc(o.title) + '</div>'
          + (o.message ? '<p class="th-offer__msg">' + esc(o.message) + '</p>' : '')
          + '<div class="th-offer__foot">'
          +   (o.status === 'claimed'
                ? '<span class="th-offer__code">' + esc(o.code || '') + '</span>'
                  + '<a class="th-offer__fine" href="/cart">Use it at checkout</a>'
                : '<button type="button" data-offer-claim="' + esc(o.id) + '">Claim offer</button>'
                  + '<button type="button" class="th-offer__skip" data-offer-dismiss="' + esc(o.id) + '">No thanks</button>')
          +   (o.expiresAt ? '<span class="th-offer__fine">Ends ' + when(o.expiresAt) + '</span>' : '')
          + '</div></div>';
      }).join('');
      if (markSeen) { api('/shop/account/offers/seen', { method: 'POST' }).then(offerBadge).catch(function(){}); }
    } catch (err) {
      el.innerHTML = '<p class="th-acct__empty">Could not load your offers.</p>';
    }
  }

  root.addEventListener('click', async function(e){
    var claim = e.target.closest && e.target.closest('[data-offer-claim]');
    var skip = e.target.closest && e.target.closest('[data-offer-dismiss]');
    if (!claim && !skip) return;
    var btn = claim || skip;
    var id = btn.getAttribute(claim ? 'data-offer-claim' : 'data-offer-dismiss');
    btn.disabled = true;
    try { await api('/shop/account/offers/' + encodeURIComponent(id) + (claim ? '/claim' : '/dismiss'), { method: 'POST' }); }
    catch (err) {}
    await renderOffers(false);
    offerBadge();
  });

  // ── For you ─────────────────────────────────────────────────────────────
  async function renderPicks(){
    var el = panel('picks');
    try {
      var r = await api('/shop/account/recommendations');
      var products = r.products || [];
      if (!products.length) {
        el.innerHTML = '<p class="th-acct__empty">Nothing to suggest yet.</p>';
        return;
      }
      el.innerHTML = '<p class="th-picks__basis">'
        + (r.basis === 'history' ? 'Based on what you have ordered.' : 'New arrivals — order something and this gets personal.')
        + '</p><div class="th-picks">' + products.map(pickHtml).join('') + '</div>';
    } catch (err) {
      el.innerHTML = '<p class="th-acct__empty">Could not load suggestions.</p>';
    }
  }

  // The saved-items card follows the heart wherever it is tapped.
  window.addEventListener('therum:wishlist-changed', function(){ if (!user.hidden) dashboard(); });

  // ── Auth forms ──────────────────────────────────────────────────────────
  root.querySelectorAll('[data-acct-form]').forEach(function(form){
    form.addEventListener('submit', async function(e){
      e.preventDefault();
      var mode = form.getAttribute('data-acct-form');
      var submit = form.querySelector('[type=submit]');
      var payload = {};
      new FormData(form).forEach(function(v, k){ if (String(v).trim()) payload[k] = v; });
      submit.disabled = true;
      msg.className = 'th-acct__msg';
      msg.textContent = 'Working…';
      try {
        var r = await api('/shop/account/' + (mode === 'register' ? 'register' : 'login'), {
          method: 'POST', body: JSON.stringify(payload),
        });
        setTok(r.token, r.expiresAt);
        msg.textContent = '';
        showUser(Object.assign({ identities: [] }, r.customer));
        // A cart started before signing in belongs to the same person.
        var cartToken = localStorage.getItem('therum_cart_token');
        if (cartToken && r.customer && r.customer.email) {
          try { await api('/cart/identity', { method: 'POST', body: JSON.stringify({ cartToken: cartToken, email: r.customer.email }) }); }
          catch (err) {}
        }
      } catch (err) {
        msg.className = 'th-acct__msg th-acct__msg--bad';
        msg.textContent = err.message;
      }
      submit.disabled = false;
    });
  });

  root.querySelector('[data-acct-signout]').addEventListener('click', async function(){
    try { await api('/shop/account/logout', { method: 'POST' }); } catch (err) {}
    setTok(null); showGuest();
  });
  root.querySelector('[data-acct-signout-all]').addEventListener('click', async function(){
    msg2.textContent = '';
    try {
      await api('/shop/account/logout-everywhere', { method: 'POST' });
      setTok(null); showGuest();
    } catch (err) {
      msg2.className = 'th-acct__msg th-acct__msg--bad';
      msg2.textContent = err.message;
    }
  });

  load();
  // Independent of load(): a signed-out visitor is exactly who needs these,
  // and a failure to reach the providers endpoint must not stop the page.
  void initSocial();
})();
`;

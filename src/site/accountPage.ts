import { countrySelect } from './countries.js';

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
.th-acct__tabs{display:flex;gap:2px;margin-bottom:26px;border-bottom:solid 1px var(--border-color-light,rgba(0,0,0,.12));overflow-x:auto}
/* First tab flush with the page edge so the row starts where the content does. */
.th-acct__tab:first-child{padding-left:0}
.th-acct__tab{flex:0 0 auto;padding:13px 16px;background:none;border:0;border-bottom:solid 2px transparent;cursor:pointer;
  font:inherit;font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--text-color-light,#888);white-space:nowrap}
.th-acct__tab[aria-selected="true"]{color:inherit;border-bottom-color:currentColor}
.th-acct__tab-count{display:inline-block;margin-left:6px;padding:0 5px;min-width:16px;height:16px;line-height:16px;
  border-radius:8px;font-size:9px;background:var(--accent-color,#c0392b);color:#fff;vertical-align:middle}
.th-acct__tab-count:empty{display:none}
.th-acct label{display:block;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;margin:16px 0 6px}
.th-acct input,.th-acct select{width:100%;padding:12px 14px;border:1px solid var(--border-color-light,rgba(0,0,0,.14));border-radius:10px;background:var(--input-bg,rgba(0,0,0,.02));font:inherit;font-size:14px;transition:border-color .15s ease,box-shadow .15s ease}
.th-acct input:focus,.th-acct select:focus{outline:0;border-color:var(--button-color,#111);box-shadow:0 0 0 3px rgba(0,0,0,.05)}
/* --button-color is the theme's button FILL, not its text. */
.th-acct__submit{width:100%;margin-top:22px;padding:14px;background:var(--button-color,#111);color:var(--white-color,#fff);
  border:0;cursor:pointer;font:inherit;font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase}
.th-acct__submit[disabled]{opacity:.5;cursor:default}
/* ── Details: addresses, cards, name ───────────────────────────────────── */
.th-acct__sub{margin-top:30px;padding-top:22px;border-top:solid 1px var(--border-color-light,rgba(0,0,0,.12))}
.th-acct__sub-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:14px}
.th-acct__sub-head h3{margin:0;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
.th-acct__addr{display:flex;align-items:center;gap:14px;padding:13px 0;
  border-bottom:solid 1px var(--border-color-light,rgba(0,0,0,.08));font-size:13px;flex-wrap:wrap}
.th-acct__addr:last-child{border-bottom:0}
.th-acct__addr-txt{flex:1 1 220px;min-width:0;line-height:1.5}
.th-acct__addr-acts{display:flex;gap:14px;flex:0 0 auto;margin-left:auto}
.th-acct__badge{display:inline-block;margin-left:8px;padding:2px 7px;font-size:9px;font-weight:700;letter-spacing:.08em;
  text-transform:uppercase;border:solid 1px currentColor;vertical-align:middle}
.th-acct__dim{color:var(--text-color-light,#888)}
.th-acct__link{background:none;border:0;padding:0;font:inherit;font-size:12px;cursor:pointer;color:inherit;
  text-decoration:underline;text-underline-offset:3px}
.th-acct__link--danger{color:var(--accent-color,#c0392b)}
.th-acct__btn{padding:10px 16px;background:var(--button-color,#111);color:var(--white-color,#fff);border:0;cursor:pointer;
  font:inherit;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.th-acct__editable{display:flex;align-items:center;gap:12px}
.th-acct__editrow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.th-acct__in{width:100%;padding:12px 14px;border:1px solid var(--border-color-light,rgba(0,0,0,.14));border-radius:10px;background:var(--input-bg,rgba(0,0,0,.02));font:inherit;font-size:14px;transition:border-color .15s ease,box-shadow .15s ease}
/* Profile block — consistent labelled fields, no more mismatched boxes. */
.th-acct__profile{display:flex;flex-direction:column;gap:14px;padding:2px 0 22px}
.th-acct__field{display:flex;flex-direction:column;gap:6px;margin:0}
.th-acct__field>span{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--text-color-light,#888)}
.th-acct__fieldrow{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:520px){.th-acct__fieldrow{grid-template-columns:1fr}}
.th-acct__addrform{display:flex;flex-direction:column;gap:9px;margin-top:16px;padding-top:16px;
  border-top:dashed 1px var(--border-color-light,rgba(0,0,0,.15))}
.th-acct__addrrow{display:grid;grid-template-columns:1fr 1fr;gap:9px}
.th-acct__check{display:flex!important;align-items:center;gap:8px;font-size:12px;letter-spacing:0;text-transform:none;font-weight:400;margin:4px 0!important}
.th-acct__check input{width:auto!important;padding:0!important}
/* Google renders its own button inside this host; it comes with its own
   dimensions, so all this does is centre it. */
.th-acct__gbtn{display:flex;justify-content:center;min-height:44px}
.th-acct__msg{margin-top:16px;font-size:13px;line-height:1.5}
.th-acct__msg--bad{color:var(--accent-color,#c0392b)}
.th-acct__empty{padding:44px 0;text-align:center;font-size:13px;color:var(--text-color-light,#888)}
.th-acct__empty a{text-decoration:underline}
.th-acct__panel[hidden]{display:none}
.th-ph{background:var(--background-color-dark,#f2f2f2);display:block}

/* ── Dashboard ─────────────────────────────────────────────────────────── */
.th-hello{margin-bottom:26px}
.th-hello__pills{display:flex;flex-direction:column;align-items:flex-start;gap:8px;margin-bottom:6px}
.th-pill{display:inline-flex;align-items:center;padding:6px 14px;border-radius:999px;font-weight:600;line-height:1}
.th-pill--level{background:var(--accent-color,#f5389a);color:#fff;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase}
.th-pill--hi{background:var(--tx,#0a0a0a);color:var(--white-color,#fff);font-size:15px;letter-spacing:-.01em}
.th-hello__sub{font-size:13px;color:var(--text-color-light,#888);margin-top:4px}
/* ── BENTO ──────────────────────────────────────────────────────────────
   A fixed four-column track rather than auto-fit, because a bento needs
   cards of DIFFERENT sizes and auto-fit makes every one the same. Spans are
   assigned per card by what it holds: a card with a picture strip earns two
   columns, a single number does not.
   grid-auto-flow:dense lets a small card backfill a hole a wide one left,
   so the wall stays solid instead of gap-toothed. */
.th-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));
  grid-auto-rows:auto;gap:14px;grid-auto-flow:dense;align-items:stretch}
.th-card{border:solid 1px var(--border-color-light,rgba(0,0,0,.12));border-radius:14px;
  padding:22px;min-height:168px;display:flex;flex-direction:column;background:var(--sf,#fff);
  transition:border-color .2s ease,transform .2s ease,box-shadow .2s ease}
.th-card:hover{border-color:var(--border-color-dark,rgba(0,0,0,.28))}
.th-card--w2{grid-column:span 2}
.th-card--w3{grid-column:span 3}
.th-card--h2{grid-row:span 2}
.th-card--span{grid-column:1/-1}
/* The one card that is an ACTION, not a number: it inverts so the eye lands
   on it first and the rest of the wall reads as context around it. */
.th-card--hero{background:var(--tx,#0a0a0a);color:var(--white-color,#fff);border-color:var(--tx,#0a0a0a)}
.th-card--hero .th-card__label,.th-card--hero .th-card__note{color:rgba(255,255,255,.66)}
.th-card--hero .th-card__act .th-solid{background:#fff;color:var(--tx,#0a0a0a);border-color:#fff}
.th-card--hero .th-card__act button:not(.th-solid),.th-card--hero .th-card__act a:not(.th-solid){color:#fff;border-color:rgba(255,255,255,.4)}
@media(max-width:1000px){
  .th-cards{grid-template-columns:repeat(2,minmax(0,1fr))}
  .th-card--w3{grid-column:span 2}
}
@media(max-width:620px){
  /* One column on a phone: a two-up bento at 320px is two cramped columns,
     not a layout. Spans collapse so nothing tries to be two of one. */
  .th-cards{grid-template-columns:1fr;grid-auto-rows:auto}
  .th-card--w2,.th-card--w3,.th-card--h2,.th-card--span{grid-column:auto;grid-row:auto}
}
@media(prefers-reduced-motion:reduce){.th-card{transition:none}}
.th-card__label{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--text-color-light,#888);margin-bottom:14px}
.th-card__big{font-size:26px;font-weight:600;letter-spacing:-.01em;line-height:1.15}
.th-card__note{font-size:13px;color:var(--text-color-light,#888);margin-top:6px;line-height:1.5}
/* ── THE MORPH ──────────────────────────────────────────────────────────
   The opened card takes the whole grid and its neighbours fall back rather
   than vanishing, so the shopper keeps sight of what they are returning to.
   grid-column:1/-1 with the others dimmed is deliberately NOT display:none —
   removing them would reflow the page under the reader's hands. */
.th-cards.is-morphed .th-card{opacity:.25;filter:saturate(.6);pointer-events:none;
  transition:opacity .3s ease,filter .3s ease}
.th-cards.is-morphed .th-card.is-open{opacity:1;filter:none;pointer-events:auto;
  grid-column:1/-1;grid-row:auto}
.th-card.is-open{box-shadow:0 10px 30px rgba(0,0,0,.10)}
.th-morph{margin-top:20px;padding-top:18px;border-top:solid 1px var(--border-color-light,rgba(0,0,0,.12))}
.th-morph__bar{margin-bottom:16px}
.th-morph__in{max-height:min(62vh,620px);overflow-y:auto}
/* The inner panel's own cards must not re-inherit the dimming above. */
.th-morph__in .th-card{opacity:1;filter:none;pointer-events:auto}
@media(prefers-reduced-motion:reduce){.th-cards.is-morphed .th-card{transition:none}}
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
/* Five to a row: four products and the shop. */
.th-picks--5{grid-template-columns:repeat(5,minmax(0,1fr))}
@media(max-width:1000px){.th-picks--5{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:640px){.th-picks--5{grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}}
.th-pick{text-decoration:none;color:inherit;display:flex;flex-direction:column}
.th-pick__link{text-decoration:none;color:inherit;display:block}
.th-pick img,.th-pick .th-ph{width:100%;aspect-ratio:1;object-fit:cover}
/* Buying from here is the point of surfacing products at all — someone in
   their account should not have to go to the shop to reorder. */
.th-pick__buy{margin-top:10px;width:100%;padding:11px 10px;border:solid 1px currentColor;background:none;
  color:inherit;text-align:center;text-decoration:none;display:block;cursor:pointer;
  font:inherit;font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;
  transition:background .16s ease,color .16s ease}
.th-pick__buy:hover{background:var(--button-color,#111);color:var(--white-color,#fff);border-color:var(--button-color,#111)}
.th-pick__buy:disabled{opacity:.6;cursor:default}
.th-pick__buy--ghost{color:var(--text-color-light,#888)}
/* The fifth tile. Deliberately not a product photo — it is a door, and a
   picture would make it read as one more thing to buy. */
.th-pick--all .th-pick__allbox{width:100%;aspect-ratio:1;display:flex;align-items:center;justify-content:center;
  border:dashed 1px var(--border-color-light,rgba(0,0,0,.28));background:var(--background-color-dark,#fafafa)}
.th-pick__allarrow{font-size:26px;line-height:1}
.th-pick--all:hover .th-pick__allbox{border-color:currentColor;border-style:solid}
.th-pick__nm{font-size:13px;font-weight:500;margin-top:10px;line-height:1.35}
.th-pick__pr{font-size:12px;color:var(--text-color-light,#888);margin-top:3px}
.th-pick__was{color:var(--text-color-light,#888);text-decoration:line-through;opacity:.7;margin-left:5px}
.th-pick__member{display:block;font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--text-color-light,#888);margin-top:3px}
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
      <button type="button" class="th-acct__link" data-acct-forgot-open style="margin-top:10px">Forgot password?</button>
    </form>
    <!-- Reset flow: request a 6-digit code by email, then set a new password
         and sign in. Wires the /shop/account/password/forgot + /reset routes
         that had no storefront entry point — a password customer who forgot
         was locked out entirely. -->
    <form data-acct-form="forgot" hidden>
      <label for="acct-femail">Email</label>
      <input id="acct-femail" name="email" type="email" autocomplete="email" required>
      <div data-acct-forgot-step2 hidden>
        <label for="acct-fcode">6-digit code (check your email)</label>
        <input id="acct-fcode" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6">
        <label for="acct-fpass">New password</label>
        <input id="acct-fpass" name="password" type="password" autocomplete="new-password" minlength="8">
      </div>
      <button class="th-acct__submit" type="submit" data-acct-forgot-submit>Send reset code</button>
      <button type="button" class="th-acct__link" data-acct-forgot-back style="margin-top:10px">Back to sign in</button>
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
        <div class="th-hello__pills">
          <span class="th-pill th-pill--level" data-acct-level hidden></span>
          <span class="th-pill th-pill--hi" data-acct-hello></span>
        </div>
        <div class="th-hello__sub" data-acct-since></div>
      </div>
      <div class="th-cards" data-acct-cards></div>
    </div>

    <div class="th-acct__panel" data-acct-panel="orders" hidden><p class="th-acct__empty">Loading…</p></div>
    <div class="th-acct__panel" data-acct-panel="offers" hidden><p class="th-acct__empty">Loading…</p></div>
    <div class="th-acct__panel" data-acct-panel="wishlist" hidden>${wishlist}</div>
    <div class="th-acct__panel" data-acct-panel="picks" hidden><p class="th-acct__empty">Loading…</p></div>

    <div class="th-acct__panel" data-acct-panel="details" hidden>
      <!-- Name is editable in place. Email is not: it is the login, so
           changing it belongs in a verification flow rather than a text
           field that a hijacked session could use to lock the owner out. -->
      <div class="th-acct__profile">
        <div class="th-acct__field"><span>Display name</span>
          <input class="th-acct__in" data-acct-name-input maxlength="120" placeholder="What we call you — change it anytime">
        </div>
        <div class="th-acct__fieldrow">
          <div class="th-acct__field"><span>First name</span>
            <input class="th-acct__in" data-acct-first-input maxlength="120" placeholder="First">
          </div>
          <div class="th-acct__field"><span>Last name</span>
            <input class="th-acct__in" data-acct-last-input maxlength="120" placeholder="Last">
          </div>
        </div>
        <div class="th-acct__field"><span>Email</span>
          <input class="th-acct__in" data-acct-email readonly disabled style="opacity:.65;cursor:not-allowed">
        </div>
        <div class="th-acct__editrow">
          <button type="button" class="th-acct__btn" data-acct-name-save>Save profile</button>
          <span class="th-acct__dim" style="font-size:12px" data-acct-profile-msg></span>
        </div>
      </div>
      <div class="th-acct__row" data-acct-identities-row hidden><span>Signed in with</span><span data-acct-identities></span></div>

      <!-- ── Addresses ──────────────────────────────────────────────────
           The Address table has existed since the schema was written with no
           way for a shopper to see or change what was stored for them. -->
      <div class="th-acct__sub">
        <div class="th-acct__sub-head">
          <h3>Addresses</h3>
          <button type="button" class="th-acct__link" data-acct-addr-new>Add address</button>
        </div>
        <div data-acct-addresses><p class="th-acct__empty">Loading…</p></div>
        <form class="th-acct__addrform" data-acct-addr-form hidden>
          <input type="hidden" data-acct-addr-id>
          <input class="th-acct__in" data-addr="line1" placeholder="Street address" autocomplete="shipping address-line1" required>
          <input class="th-acct__in" data-addr="line2" placeholder="Apt, suite (optional)" autocomplete="shipping address-line2">
          <div class="th-acct__addrrow">
            <input class="th-acct__in" data-addr="city" placeholder="City" autocomplete="shipping address-level2" required>
            <input class="th-acct__in" data-addr="region" placeholder="State" autocomplete="shipping address-level1">
          </div>
          <div class="th-acct__addrrow">
            <input class="th-acct__in" data-addr="postalCode" placeholder="ZIP" inputmode="numeric" autocomplete="shipping postal-code">
            ${countrySelect('class="th-acct__in" data-addr="country" autocomplete="shipping country" aria-label="Country"')}
          </div>
          <label class="th-acct__check"><input type="checkbox" data-addr="isDefault"> <span>Use as my default</span></label>
          <div class="th-acct__editrow">
            <button type="submit" class="th-acct__btn">Save address</button>
            <button type="button" class="th-acct__link" data-acct-addr-cancel>Cancel</button>
          </div>
        </form>
      </div>

      <!-- ── Security ───────────────────────────────────────────────────
           Email is the login, so changing it is a two-step with a code to
           the NEW address — a hijacked session must not be able to point the
           account somewhere the owner cannot reach. -->
      <div class="th-acct__sub">
        <div class="th-acct__sub-head"><h3>Security</h3></div>
        <div class="th-acct__addr">
          <div class="th-acct__addr-txt">Password</div>
          <div class="th-acct__addr-acts">
            <button type="button" class="th-acct__link" data-acct-pw-edit>Change</button>
          </div>
        </div>
        <form class="th-acct__addrform" data-acct-pw-form hidden>
          <input class="th-acct__in" data-pw="current" type="password" placeholder="Current password" autocomplete="current-password">
          <input class="th-acct__in" data-pw="next" type="password" placeholder="New password (8+ characters)" autocomplete="new-password">
          <div class="th-acct__editrow">
            <button type="submit" class="th-acct__btn">Save password</button>
            <button type="button" class="th-acct__link" data-acct-pw-cancel>Cancel</button>
          </div>
        </form>

        <div class="th-acct__addr">
          <div class="th-acct__addr-txt">Sign-in email <span class="th-acct__dim" data-acct-email2></span></div>
          <div class="th-acct__addr-acts">
            <button type="button" class="th-acct__link" data-acct-em-edit>Change</button>
          </div>
        </div>
        <form class="th-acct__addrform" data-acct-em-form hidden>
          <input class="th-acct__in" data-em="email" type="email" placeholder="New email address" autocomplete="email">
          <input class="th-acct__in" data-em="password" type="password" placeholder="Your password" autocomplete="current-password">
          <div class="th-acct__editrow">
            <button type="submit" class="th-acct__btn">Send code</button>
            <button type="button" class="th-acct__link" data-acct-em-cancel>Cancel</button>
          </div>
        </form>
        <form class="th-acct__addrform" data-acct-em-confirm hidden>
          <p class="th-acct__dim" style="font-size:12px;margin:0" data-acct-em-sent></p>
          <input class="th-acct__in" data-em="code" inputmode="numeric" placeholder="6-digit code" autocomplete="one-time-code">
          <div class="th-acct__editrow">
            <button type="submit" class="th-acct__btn">Confirm email</button>
            <button type="button" class="th-acct__link" data-acct-em-cancel>Cancel</button>
          </div>
        </form>
      </div>

      <!-- ── Saved cards ────────────────────────────────────────────────
           Adding a card without being able to remove it is a one-way door. -->
      <div class="th-acct__sub" data-acct-cards-wrap hidden>
        <div class="th-acct__sub-head"><h3>Payment methods</h3></div>
        <div data-acct-paymethods></div>
      </div>
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
  // The Details panel is a full screen of forms on a phone and this message
  // line sits at its bottom — an outcome nobody sees reads as a dead button.
  // One observer instead of touching all eleven write sites: any non-empty
  // write brings the words on screen. Instant, never smooth.
  if (msg2 && window.MutationObserver) {
    new MutationObserver(function(){
      if ((msg2.textContent || '').trim() && msg2.scrollIntoView) {
        try { msg2.scrollIntoView({ block: 'center' }); } catch (e) {}
      }
    }).observe(msg2, { childList: true, characterData: true, subtree: true });
  }
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
      // GOOGLE'S OWN RENDERED BUTTON, not a styled button that calls prompt().
      //
      // prompt() is One Tap, and One Tap only appears when the browser ALREADY
      // holds a live Google session. With no session, after a previous
      // dismissal, or under third-party-cookie restrictions it shows nothing
      // at all and logs "Not signed in with the identity provider" — which is
      // indistinguishable, to the person clicking, from a broken button.
      //
      // renderButton opens the full account chooser, so it works for someone
      // who has never signed into Google in this browser. That is the whole
      // requirement: it has to work for anyone.
      var host = document.createElement('div');
      host.className = 'th-acct__gbtn';
      socialBox.appendChild(host);
      (async function(){
        try {
          await gsiScript();
          var cid = socialBox.getAttribute('data-google-client-id');
          if (!cid) return;
          window.google.accounts.id.initialize({
            client_id: cid,
            callback: function(res){ socialSignedIn('google', res.credential); },
            // The popup keeps the shopper on this page; redirect mode would
            // throw away anything they had already typed.
            ux_mode: 'popup',
          });
          window.google.accounts.id.renderButton(host, {
            type: 'standard', theme: 'outline', size: 'large',
            text: 'continue_with', shape: 'rectangular', logo_alignment: 'center',
            width: Math.min(400, Math.max(200, socialBox.clientWidth || 320)),
          });
        } catch (err) {
          // Losing Google costs a shortcut, not the account — the email and
          // password form underneath still works, so this stays quiet.
          host.remove();
        }
      })();
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
    var nmI = root.querySelector('[data-acct-name-input]'); if (nmI) nmI.value = me.name || '';
    var fnI = root.querySelector('[data-acct-first-input]'); if (fnI) fnI.value = me.firstName || '';
    var lnI = root.querySelector('[data-acct-last-input]'); if (lnI) lnI.value = me.lastName || '';
    var emI = root.querySelector('[data-acct-email]'); if (emI) { if (emI.tagName === 'INPUT') emI.value = me.email; else emI.textContent = me.email; }
    var e2 = root.querySelector('[data-acct-email2]'); if (e2) e2.textContent = me.email;
    root.querySelector('[data-acct-hello]').textContent = me.name ? ('Hey, ' + me.name.split(' ')[0]) : 'Your account';
    var lvl = root.querySelector('[data-acct-level]');
    if (lvl) {
      if (me.membershipLevel) { lvl.textContent = me.membershipLevel; lvl.hidden = false; }
      else { lvl.hidden = true; }
    }
    root.querySelector('[data-acct-since]').textContent = me.email;
    var ids = me.identities || [];
    if (ids.length) {
      root.querySelector('[data-acct-identities-row]').hidden = false;
      root.querySelector('[data-acct-identities]').textContent = ids.map(function(i){ return i.provider; }).join(', ');
    }
    loaded = {};
    dashboard();
    loadAddresses();
    loadCards();
  }

  // ── Addresses ──────────────────────────────────────────────────────────
  var addrBox = root.querySelector('[data-acct-addresses]');
  var addrForm = root.querySelector('[data-acct-addr-form]');
  var addrIdEl = root.querySelector('[data-acct-addr-id]');
  function addrField(k){ return addrForm && addrForm.querySelector('[data-addr="' + k + '"]'); }

  async function loadAddresses(){
    if (!addrBox) return;
    try {
      var r = await api('/shop/account/addresses');
      var list = r.addresses || [];
      addrBox.innerHTML = list.length
        ? list.map(function(a){
            return '<div class="th-acct__addr' + (a.isDefault ? ' is-default' : '') + '">'
              + '<div class="th-acct__addr-txt">'
              + esc([a.line1, a.line2, a.city, a.region, a.postalCode, a.country].filter(Boolean).join(', '))
              + (a.isDefault ? '<span class="th-acct__badge">Default</span>' : '')
              + '</div><div class="th-acct__addr-acts">'
              + (a.isDefault ? '' : '<button type="button" class="th-acct__link" data-addr-default="' + esc(a.id) + '">Make default</button>')
              + '<button type="button" class="th-acct__link" data-addr-edit="' + esc(a.id) + '">Edit</button>'
              + '<button type="button" class="th-acct__link th-acct__link--danger" data-addr-del="' + esc(a.id) + '">Remove</button>'
              + '</div></div>';
          }).join('')
        : '<p class="th-acct__empty">No addresses saved yet.</p>';
      addrBox.__list = list;
    } catch (e) {
      addrBox.innerHTML = '<p class="th-acct__empty">Could not load addresses.</p>';
    }
  }

  function openAddr(a){
    if (!addrForm) return;
    addrIdEl.value = a ? a.id : '';
    ['line1','line2','city','region','postalCode','country'].forEach(function(k){
      var f = addrField(k); if (f) f.value = a ? (a[k] || '') : (k === 'country' ? 'US' : '');
    });
    var d = addrField('isDefault'); if (d) d.checked = a ? !!a.isDefault : false;
    addrForm.hidden = false;
    var first = addrField('line1'); if (first) first.focus();
  }

  root.addEventListener('click', async function(e){
    var t = e.target;
    if (t.matches('[data-acct-addr-new]')) return openAddr(null);
    if (t.matches('[data-acct-addr-cancel]')) { addrForm.hidden = true; return; }
    var ed = t.getAttribute && t.getAttribute('data-addr-edit');
    if (ed) return openAddr((addrBox.__list || []).filter(function(a){ return a.id === ed; })[0]);
    var mk = t.getAttribute && t.getAttribute('data-addr-default');
    if (mk) {
      await api('/shop/account/addresses/' + encodeURIComponent(mk), { method: 'PATCH', body: JSON.stringify({ isDefault: true }) }).catch(function(){});
      return loadAddresses();
    }
    var del = t.getAttribute && t.getAttribute('data-addr-del');
    if (del) {
      // Confirmed, because there is no undo — the row is gone from the
      // database, not archived.
      if (!window.confirm('Remove this address?')) return;
      await api('/shop/account/addresses/' + encodeURIComponent(del), { method: 'DELETE' }).catch(function(){});
      return loadAddresses();
    }
    var rm = t.getAttribute && t.getAttribute('data-card-del');
    if (rm) {
      if (!window.confirm('Remove this card? You can add it again at checkout.')) return;
      await api('/shop/account/payment-methods/' + encodeURIComponent(rm), { method: 'DELETE' }).catch(function(){});
      return loadCards();
    }
  });

  if (addrForm) addrForm.addEventListener('submit', async function(e){
    e.preventDefault();
    var body = {};
    ['line1','line2','city','region','postalCode','country'].forEach(function(k){
      var f = addrField(k); if (f) body[k] = f.value.trim();
    });
    var d = addrField('isDefault'); body.isDefault = !!(d && d.checked);
    var id = addrIdEl.value;
    try {
      await api(id ? '/shop/account/addresses/' + encodeURIComponent(id) : '/shop/account/addresses',
        { method: id ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      addrForm.hidden = true;
      loadAddresses();
    } catch (err) {
      if (msg2) msg2.textContent = (err && err.message) || 'Could not save that address.';
    }
  });

  // ── Saved cards ────────────────────────────────────────────────────────
  async function loadCards(){
    var wrap = root.querySelector('[data-acct-cards-wrap]');
    var box = root.querySelector('[data-acct-paymethods]');
    if (!wrap || !box) return;
    try {
      var r = await api('/shop/account/payment-methods');
      var cards = r.cards || [];
      // Hidden entirely when there are none: a "Payment methods" heading over
      // an empty box tells a shopper about a feature they have not used yet.
      wrap.hidden = cards.length === 0;
      box.innerHTML = cards.map(function(c){
        return '<div class="th-acct__addr"><div class="th-acct__addr-txt">'
          + '<strong>' + esc(String(c.brand).toUpperCase()) + '</strong> •••• ' + esc(c.last4)
          + ' <span class="th-acct__dim">' + esc(String(c.expMonth).padStart(2,'0')) + '/' + esc(String(c.expYear).slice(-2)) + '</span>'
          + '</div><div class="th-acct__addr-acts">'
          + '<button type="button" class="th-acct__link th-acct__link--danger" data-card-del="' + esc(c.id) + '">Remove</button>'
          + '</div></div>';
      }).join('');
    } catch (e) { wrap.hidden = true; }
  }

  // ── Password ───────────────────────────────────────────────────────────
  var pwForm = root.querySelector('[data-acct-pw-form]');
  var emForm = root.querySelector('[data-acct-em-form]');
  var emConfirm = root.querySelector('[data-acct-em-confirm]');
  var pendingEmail = '';
  function pwv(k){ var e = pwForm && pwForm.querySelector('[data-pw="' + k + '"]'); return e ? e.value : ''; }
  function emv(k){
    var e = (emForm && emForm.querySelector('[data-em="' + k + '"]'))
         || (emConfirm && emConfirm.querySelector('[data-em="' + k + '"]'));
    return e ? e.value : '';
  }

  root.addEventListener('click', function(e){
    if (e.target.matches('[data-acct-pw-edit]')) { pwForm.hidden = false; pwForm.querySelector('[data-pw="current"]').focus(); }
    if (e.target.matches('[data-acct-pw-cancel]')) { pwForm.hidden = true; }
    if (e.target.matches('[data-acct-em-edit]')) { emForm.hidden = false; emConfirm.hidden = true; emForm.querySelector('[data-em="email"]').focus(); }
    if (e.target.matches('[data-acct-em-cancel]')) { emForm.hidden = true; emConfirm.hidden = true; }
  });

  if (pwForm) pwForm.addEventListener('submit', async function(e){
    e.preventDefault();
    if (pwv('next').length < 8) { if (msg2) msg2.textContent = 'Use at least 8 characters.'; return; }
    try {
      var out = await api('/shop/account/password', { method: 'POST',
        body: JSON.stringify({ current: pwv('current'), next: pwv('next') }) });
      // Changing the password drops every other session — including this tab's,
      // so the new token replaces it or the shopper is logged out by their own
      // security action.
      if (out.token) { try { localStorage.setItem(KEY, out.token); } catch (err) {} }
      pwForm.hidden = true;
      pwForm.querySelectorAll('input').forEach(function(i){ i.value = ''; });
      if (msg2) msg2.textContent = 'Password changed. Every other device has been signed out.';
    } catch (err) { if (msg2) msg2.textContent = err.message || 'Could not change that password.'; }
  });

  // ── Email ──────────────────────────────────────────────────────────────
  if (emForm) emForm.addEventListener('submit', async function(e){
    e.preventDefault();
    try {
      var out = await api('/shop/account/email', { method: 'POST',
        body: JSON.stringify({ email: emv('email'), password: emv('password') || undefined }) });
      pendingEmail = out.to;
      emForm.hidden = true; emConfirm.hidden = false;
      var note = root.querySelector('[data-acct-em-sent]');
      if (note) note.textContent = 'We sent a code to ' + out.to + '. Enter it to finish the change.';
      emConfirm.querySelector('[data-em="code"]').focus();
      if (msg2) msg2.textContent = '';
    } catch (err) { if (msg2) msg2.textContent = err.message || 'Could not start that change.'; }
  });

  if (emConfirm) emConfirm.addEventListener('submit', async function(e){
    e.preventDefault();
    try {
      var out = await api('/shop/account/email/confirm', { method: 'POST',
        body: JSON.stringify({ email: pendingEmail, code: emv('code') }) });
      emConfirm.hidden = true;
      root.querySelector('[data-acct-email]').textContent = out.email;
      var e2 = root.querySelector('[data-acct-email2]'); if (e2) e2.textContent = out.email;
      if (msg2) msg2.textContent = 'Email changed to ' + out.email + '.';
    } catch (err) { if (msg2) msg2.textContent = err.message || 'That code did not match.'; }
  });

  // ── Profile: display name (freely, unlimited) + first/last ───────────────
  root.addEventListener('click', async function(e){
    if (!e.target.matches('[data-acct-name-save]')) return;
    var nm = root.querySelector('[data-acct-name-input]');
    var fn = root.querySelector('[data-acct-first-input]');
    var ln = root.querySelector('[data-acct-last-input]');
    var pmsg = root.querySelector('[data-acct-profile-msg]');
    var name = nm ? (nm.value || '').trim() : '';
    if (!name) { if (pmsg) pmsg.textContent = 'Add a display name.'; return; }
    if (pmsg) pmsg.textContent = 'Saving…';
    try {
      var me = await api('/shop/account/profile', { method: 'PATCH', body: JSON.stringify({
        name: name,
        firstName: fn ? (fn.value || '').trim() : '',
        lastName: ln ? (ln.value || '').trim() : ''
      }) });
      root.querySelector('[data-acct-hello]').textContent = me.name ? ('Hey, ' + me.name.split(' ')[0]) : 'Your account';
      if (pmsg) pmsg.textContent = 'Saved.';
      setTimeout(function(){ if (pmsg) pmsg.textContent = ''; }, 2000);
    } catch (err) { if (pmsg) pmsg.textContent = 'Could not save.'; }
  });

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
      if (want === 'overview') closeMorph();
      section(want);
    });
  });

  // ── THE MORPH ───────────────────────────────────────────────────────────
  //
  // A bento card is a summary AND the door to its detail. Tapping "All 6
  // orders" used to jump to a separate tab, which threw away the one thing
  // the layout had just established — where that content lives. Instead the
  // card GROWS to the full grid and fills with the detail in place; the rest
  // fade back rather than disappearing, so the shopper can see what they are
  // returning to.
  //
  // The tab bar still works and stays in sync: it is the same content by
  // another route, not a second implementation.
  var MORPH = null;

  function closeMorph(){
    if (!MORPH) return;
    var host = root.querySelector('[data-acct-cards]');
    if (host) host.classList.remove('is-morphed');
    var card = root.querySelector('.th-card.is-open');
    if (card) {
      card.classList.remove('is-open');
      var body = card.querySelector('[data-morph-body]');
      if (body) body.remove();
      var keep = card.querySelector('[data-morph-keep]');
      if (keep) keep.hidden = false;
    }
    MORPH = null;
    root.querySelectorAll('[data-acct-tab]').forEach(function(b){
      b.setAttribute('aria-selected', String(b.getAttribute('data-acct-tab') === 'overview'));
    });
  }

  async function openMorph(name, card){
    if (MORPH === name) return closeMorph();
    closeMorph();
    MORPH = name;
    var host = root.querySelector('[data-acct-cards]');
    if (host) host.classList.add('is-morphed');
    card.classList.add('is-open');
    // The summary stays as the header of the expanded card — it is the
    // context for what is underneath, and removing it makes the expansion
    // feel like a different screen rather than the same card, larger.
    var keep = card.querySelector('.th-card__act');
    if (keep) { keep.setAttribute('data-morph-keep', ''); keep.hidden = true; }
    var body = document.createElement('div');
    body.setAttribute('data-morph-body', '');
    body.className = 'th-morph';
    body.innerHTML = '<div class="th-morph__bar">'
      + '<button type="button" class="th-acct__link" data-morph-close>← Back to overview</button></div>'
      + '<div class="th-morph__in"><p class="th-acct__empty">Loading…</p></div>';
    card.appendChild(body);
    // Scrolled into view because an expanding card can grow past the fold,
    // and a shopper who tapped a button should not have to hunt for what it
    // opened.
    try { card.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { /* older browsers */ }

    var into = body.querySelector('.th-morph__in');
    var src = root.querySelector('[data-acct-panel="' + name + '"]');
    // Render into the real panel first, then move its markup across, so the
    // morph and the tab show identical content from one code path.
    section(name);
    if (name === 'wishlist') { into.innerHTML = src ? src.innerHTML : ''; return; }
    for (var i = 0; i < 60 && src && /Loading…/.test(src.innerHTML); i++) {
      await new Promise(function(r){ setTimeout(r, 100); });
    }
    into.innerHTML = src ? src.innerHTML : '<p class="th-acct__empty">Nothing here yet.</p>';
    root.querySelectorAll('[data-acct-tab]').forEach(function(b){
      b.setAttribute('aria-selected', String(b.getAttribute('data-acct-tab') === name));
    });
  }

  root.addEventListener('click', function(e){
    if (e.target.closest('[data-morph-close]')) { closeMorph(); return; }
    var opener = e.target.closest('[data-morph]');
    if (!opener) return;
    var card = opener.closest('.th-card');
    if (card) openMorph(opener.getAttribute('data-morph'), card);
  });
  // Escape closes it, like every other expanded thing on the site.
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape') closeMorph(); });

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
      cards.push('<div class="th-card th-card--hero th-card--w2">'
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
      cards.push('<div class="th-card th-card--w2">'
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
      cards.push('<div class="th-card th-card--w2">'
        + '<div class="th-card__label">Orders</div>'
        + '<div class="th-card__big">Nothing yet</div>'
        + '<div class="th-card__note">Your order history shows up here once you have one.</div>'
        + '<div class="th-card__act"><a class="th-solid" href="/shop">Start shopping</a></div></div>');
    }

    // Saved items — hydrated client-side, since the wishlist lives in this
    // browser rather than on the account.
    var saved = wishIds();
    cards.push('<div class="th-card th-card--w2">'
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
        // Four, then a fifth tile that is the shop itself. Five across reads
        // as a row rather than a grid that ran out, and someone who wants
        // none of the four has somewhere to go from the same row.
        + '<div class="th-picks th-picks--5">'
        + picks.slice(0, 4).map(pickHtml).join('')
        + '<a class="th-pick th-pick--all" href="/shop">'
        +   '<span class="th-pick__allbox"><span class="th-pick__allarrow">&rarr;</span></span>'
        +   '<div class="th-pick__nm">Shop the store</div>'
        +   '<div class="th-pick__pr">Everything in the store</div>'
        + '</a>'
        + '</div></div>');
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
    var vs = (p.variants || []);
    var prices = vs.map(function(v){ return v.price; }).filter(function(n){ return typeof n === 'number'; });
    var from = prices.length ? Math.min.apply(null, prices) : null;
    // Quick buy only where there is nothing to choose. A single-variant
    // product can go straight to the bag; anything with a size or a colour
    // needs the PDP, and guessing one for the shopper is worse than a click.
    var only = vs.length === 1 ? vs[0] : null;
    var buyable = only && (only.available === undefined || only.available > 0);
    // Member pricing, shown the same way the shop grid does it: 'net' replaces
    // the number, 'was-now' shows the member price with the list price struck
    // beside it. A Friends & Family shopper must see their price here too.
    var memberPct = (p.memberDisplay && p.memberDisplay !== 'off') ? (p.memberPct || 0) : 0;
    var memberFrom = (memberPct > 0 && from !== null) ? Math.round(from * (1 - memberPct / 100)) : from;
    var showWas = memberPct > 0 && p.memberDisplay === 'was-now';
    return '<div class="th-pick">'
      + '<a class="th-pick__link" href="/product/' + esc(p.slug) + '">'
      +   (p.image ? '<img src="' + esc(p.image) + '" alt="" loading="lazy">' : '<span class="th-ph"></span>')
      +   '<div class="th-pick__nm">' + esc(p.name) + '</div>'
      +   (from === null ? '' : '<div class="th-pick__pr">' + (prices.length > 1 ? 'From ' : '') + money(memberFrom)
            + (showWas ? ' <del class="th-pick__was">' + money(from) + '</del>' : '')
            + (memberPct > 0 && p.memberLabel ? ' <span class="th-pick__member">' + esc(p.memberLabel) + '</span>' : '')
            + '</div>')
      + '</a>'
      + (buyable
          ? '<button type="button" class="th-pick__buy" data-pick-buy="' + esc(only.id) + '">Add to bag</button>'
          : '<a class="th-pick__buy th-pick__buy--ghost" href="/product/' + esc(p.slug) + '">Choose options</a>')
      + '</div>';
  }

  // Add to bag from the account page. The cart token is the same one the
  // header badge reads, so the count updates without a reload.
  root.addEventListener('click', async function(e){
    var b = e.target.closest && e.target.closest('[data-pick-buy]');
    if (!b) return;
    e.preventDefault();
    var was = b.textContent;
    b.disabled = true; b.textContent = 'Adding…';
    try {
      var tok = null;
      try { tok = localStorage.getItem('therum_cart_token'); } catch (err) {}
      var r = await fetch('/api/cart/items', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cartToken: tok || undefined, variantId: b.getAttribute('data-pick-buy'), quantity: 1 }),
      });
      var out = await r.json();
      if (!r.ok) throw new Error('could not add');
      if (out.token) { try { localStorage.setItem('therum_cart_token', out.token); } catch (err) {} }
      window.dispatchEvent(new CustomEvent('therum:cart-changed'));
      b.textContent = 'In your bag';
      setTimeout(function(){ b.disabled = false; b.textContent = was; }, 2200);
    } catch (err) {
      b.disabled = false; b.textContent = was;
    }
  });

  root.addEventListener('click', function(e){
    var jump = e.target.closest && e.target.closest('[data-go]');
    if (!jump) return;
    var name = jump.getAttribute('data-go');
    // A card's own button expands THAT card. Only a button outside the grid
    // falls back to switching tabs — the bento's whole point is that the
    // detail belongs to the tile you touched.
    var card = jump.closest('.th-card');
    if (card && root.querySelector('[data-acct-panel="' + name + '"]')) return openMorph(name, card);
    go(name);
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
    // The forgot-password form is a two-step flow with its own handler below.
    if (form.getAttribute('data-acct-form') === 'forgot') return;
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

  // Forgot-password: request a code, then set a new password and sign in.
  var forgotForm = root.querySelector('[data-acct-form="forgot"]');
  if (forgotForm) {
    var fStep2 = forgotForm.querySelector('[data-acct-forgot-step2]');
    var fSubmit = forgotForm.querySelector('[data-acct-forgot-submit]');
    var fSent = false;
    root.querySelectorAll('[data-acct-forgot-open]').forEach(function(b){
      b.addEventListener('click', function(){
        root.querySelectorAll('[data-acct-form]').forEach(function(f){ f.hidden = f.getAttribute('data-acct-form') !== 'forgot'; });
        root.querySelectorAll('[data-acct-authtab]').forEach(function(t){ t.setAttribute('aria-selected', 'false'); });
        msg.className = 'th-acct__msg'; msg.textContent = '';
      });
    });
    root.querySelectorAll('[data-acct-forgot-back]').forEach(function(b){
      b.addEventListener('click', function(){
        fSent = false; if (fStep2) fStep2.hidden = true; if (fSubmit) fSubmit.textContent = 'Send reset code';
        msg.className = 'th-acct__msg'; msg.textContent = '';
        var st = root.querySelector('[data-acct-authtab="signin"]'); if (st) st.click();
      });
    });
    forgotForm.addEventListener('submit', async function(e){
      e.preventDefault();
      var emailEl = forgotForm.querySelector('[name=email]');
      var email = emailEl ? emailEl.value : '';
      msg.className = 'th-acct__msg';
      if (fSubmit) fSubmit.disabled = true;
      try {
        if (!fSent) {
          msg.textContent = 'Sending…';
          await api('/shop/account/password/forgot', { method: 'POST', body: JSON.stringify({ email: email }) });
          fSent = true; if (fStep2) fStep2.hidden = false; if (fSubmit) fSubmit.textContent = 'Reset password & sign in';
          msg.textContent = 'If that email has an account, a 6-digit code is on its way. Enter it and a new password below.';
        } else {
          var codeEl = forgotForm.querySelector('[name=code]');
          var passEl = forgotForm.querySelector('[name=password]');
          var code = codeEl ? String(codeEl.value || '') : '';
          var pass = passEl ? String(passEl.value || '') : '';
          if (!/^[0-9]{6}$/.test(code)) throw new Error('Enter the 6-digit code from your email.');
          if (pass.length < 8) throw new Error('New password must be at least 8 characters.');
          msg.textContent = 'Resetting…';
          var r = await api('/shop/account/password/reset', { method: 'POST', body: JSON.stringify({ email: email, code: code, password: pass }) });
          setTok(r.token, r.expiresAt);
          msg.textContent = '';
          showUser(Object.assign({ identities: [] }, r.customer));
          var cartToken = localStorage.getItem('therum_cart_token');
          if (cartToken && r.customer && r.customer.email) {
            try { await api('/cart/identity', { method: 'POST', body: JSON.stringify({ cartToken: cartToken, email: r.customer.email }) }); } catch (err) {}
          }
        }
      } catch (err) {
        msg.className = 'th-acct__msg th-acct__msg--bad';
        msg.textContent = err.message;
      }
      if (fSubmit) fSubmit.disabled = false;
    });
  }

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
  // First-time / F&F setup link (?setup=1 from the welcome email): a migrated or
  // admin-created account has no password, so land them straight on "set your
  // password" instead of a sign-in they can't complete. They enter THEIR email,
  // the code goes to THEM.
  try {
    if (/[?&]setup=1/.test(location.search)) {
      var _sb = root.querySelector('[data-acct-forgot-open]');
      if (_sb) _sb.click();
      if (msg) { msg.className = 'th-acct__msg'; msg.textContent = 'Welcome — set a password below to finish setting up your account. Enter your email and we’ll send you a code.'; }
    }
  } catch (e) { /* setup hint is best-effort */ }
  // Independent of load(): a signed-out visitor is exactly who needs these,
  // and a failure to reach the providers endpoint must not stop the page.
  void initSocial();
})();
`;

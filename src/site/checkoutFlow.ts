import { countrySelect } from './countries.js';

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

/* ── TWO COLUMNS ────────────────────────────────────────────────────────
   Form left, order summary right. The total being visible while the form is
   filled is the whole point of the rail — a single 860px column put it in a
   bar at the top that scrolled out of mind the moment anyone started typing.
   Collapses to one column at 920px, and the summary moves ABOVE the form so
   what you are paying is the first thing on the page rather than the last. */
.co-flow{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:40px;
  align-items:start;width:100%}
/* Success screen: the form + summary columns are hidden, so collapse the grid
   to one column — otherwise .co-done (max-width:520, margin:auto) centres only
   within the old 1fr FORM column and sits left-of-centre, reading as a stray
   mobile column on a wide desktop. One column = it centres on the full width. */
body.th-co-done .co-flow{grid-template-columns:1fr;justify-items:center}
@media(max-width:920px){
  /* minmax(0,1fr), NOT 1fr: a bare 1fr column can never shrink below its
     content's min-content, and the nowrap payment tab row makes that ~600px —
     which blew the whole checkout wider than the phone, so the header read as
     not-full-width and the fields ran off the edge. minmax(0,1fr) lets the
     column fit the screen and the tab row scroll inside it. */
  .co-flow{grid-template-columns:minmax(0,1fr);gap:22px}
  .co-flow > .co-summary{order:-1;border-left:0;padding-left:0;
    padding-bottom:22px;border-bottom:1px solid var(--ln,#e5e7eb)}
}

/* ── Numbered sections ──────────────────────────────────────────────────
   The number is not decoration: it says how many steps exist, which is the
   single thing that most reduces abandonment on a form nobody asked to fill
   in. It fills once the section is done. */
.co-sec{padding:0 0 26px;margin-bottom:26px;border-bottom:1px solid var(--ln,#e5e7eb)}
.co-sec:last-child{border-bottom:0;margin-bottom:0;padding-bottom:0}
.co-sec__head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}
.co-sec__head h2{margin:0;font-size:15px;font-weight:700;letter-spacing:-.005em;display:flex;align-items:center;gap:10px}
.co-sec__n{width:22px;height:22px;border-radius:50%;background:var(--bg2,#f3f4f6);color:var(--tx3,#6b7280);
  display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;
  transition:background .22s ease,color .22s ease}
.co-sec.is-focus .co-sec__n,.co-sec.is-done .co-sec__n{background:var(--tx,#111);color:var(--sf,#fff)}
.co-sec__status{font-size:11px;color:var(--tx3,#6b7280);letter-spacing:.04em;text-transform:uppercase;
  font-variant-numeric:tabular-nums}
.co-sec.is-done .co-sec__status{color:var(--ok,#10b981)}
@media(prefers-reduced-motion:reduce){.co-sec,.co-sec__n{transition:none}}

/* Method tiles: an icon, a name, and a line saying what the thing actually
   IS. A grid of bare logos asks the shopper to already know. */
.co-methods{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px}
.co-method{display:flex;align-items:flex-start;gap:11px;padding:13px 14px;text-align:left;
  border:1.5px solid var(--ln,#e5e7eb);border-radius:10px;background:var(--sf,#fff);
  cursor:pointer;font:inherit;transition:border-color .2s ease,background .2s ease}
.co-method:hover{border-color:var(--tx2,#374151)}
.co-method.on{border-color:var(--tx,#111);background:var(--bg2,#f8f8f7)}
.co-method:disabled{opacity:.45;cursor:default}
.co-method__ico{flex:0 0 30px;height:30px;border-radius:8px;background:var(--bg2,#f3f4f6);
  display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700}
.co-method__nm{font-size:13px;font-weight:600;line-height:1.25}
.co-method__sub{font-size:11px;color:var(--tx3,#6b7280);line-height:1.35;margin-top:3px}
.co-secure{margin:10px 0 0;font-size:11px;color:var(--tx3,#6b7280);text-align:center;line-height:1.4}
/* ── THE CARD ───────────────────────────────────────────────────────────
   The gateway's iframe mounts INSIDE a rendered card rather than in a plain
   box beside one. A decorative card above a separate input would be two cards
   on screen, only one of which responds to typing — this is the field, drawn
   as the object it represents.
   The chrome is ours; everything inside the strip is Stripe's own frame, so
   no card number touches this origin. */
.co-cardwrap{margin-top:14px}
.co-cardwrap[hidden]{display:none}
.co-card{position:relative;border-radius:16px;padding:20px 22px 18px;color:#fff;
  background:linear-gradient(135deg,#1b1b1f 0%,#2e2e36 52%,#141417 100%);
  box-shadow:0 10px 30px rgba(0,0,0,.22);overflow:hidden}
/* A guilloche-ish sheen, cheap and non-repeating enough not to read as a
   texture tile. */
.co-card::after{content:"";position:absolute;inset:-40% -10% auto auto;width:70%;height:180%;
  background:radial-gradient(closest-side,rgba(255,255,255,.10),transparent 70%);pointer-events:none}
.co-card__top{display:flex;align-items:center;justify-content:space-between;margin-bottom:26px}
.co-card__chip{width:34px;height:25px;border-radius:5px;
  background:linear-gradient(135deg,#e6c67a,#b8912f 55%,#f0d999);
  box-shadow:inset 0 0 0 1px rgba(0,0,0,.18)}
.co-card__brand{font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;opacity:.85}
/* The live field sits on the card face. Stripe styles its own text, so this
   only clears a lane for it. */
.co-card__field{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16);
  border-radius:9px;padding:12px 14px;min-height:20px}
.co-card__foot{display:flex;gap:26px;margin-top:18px;font-size:9px;letter-spacing:.1em;
  text-transform:uppercase;opacity:.6}
.co-card__note{margin:9px 2px 0;font-size:11px;color:var(--tx3,#6b7280)}
@media(max-width:520px){.co-card{padding:16px 16px 14px}.co-card__top{margin-bottom:18px}}
/* The chosen group's own methods as tap-select chips, not radios. */
.co-mpanel{margin-top:10px;display:flex;flex-wrap:wrap;gap:8px}
.co-mopt{display:flex;flex-direction:column;align-items:flex-start;gap:2px;text-align:left;cursor:pointer;
  padding:10px 14px;border:1px solid var(--ln,#e5e7eb);border-radius:10px;background:var(--sf,#fff);
  font:inherit;color:inherit;transition:border-color .15s ease,background .15s ease}
.co-mopt:hover{border-color:var(--tx2,#374151)}
.co-mopt.on{border-color:var(--tx,#111);background:var(--tx,#111);color:var(--sf,#fff)}
.co-mopt .co-nm{font-size:13px;font-weight:600}
.co-mopt .co-vr{font-size:11px;opacity:.7}
/* Rail line items: the picture is what a shopper recognises, so it leads. */
.co-rail-items{display:flex;flex-direction:column;gap:10px;max-height:290px;overflow-y:auto}
.co-rail-line{display:flex;align-items:center;gap:11px;font-size:13px}
.co-rail-img{width:44px;height:44px;flex:0 0 44px;border-radius:8px;object-fit:cover;
  background:var(--bg2,#f3f4f6);display:block}
.co-rail-img--ph{display:block}
.co-rail-txt{display:flex;flex-direction:column;flex:1;min-width:0;gap:1px}
.co-rail-nm{font-weight:600;line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.co-rail-meta{font-size:11px;color:var(--tx3,#6b7280)}
.co-rail-amt{font-variant-numeric:tabular-nums;font-weight:600}
.co-sumrow--sub{padding-top:12px;border-top:1px solid var(--ln,#e5e7eb);font-size:13px;color:var(--tx2,#374151)}
/* WHERE THE TOTAL STICKS, and why it differs by device:
   DESKTOP — top. It sits on the natural eye line, and a fixed bottom bar on a
   wide screen reads like a cookie banner, which people are trained to ignore.
   MOBILE  — bottom. It is in thumb reach, it is the platform convention for
   commerce, and it carries the primary action so "Checkout" / "Place order"
   is never a scroll away. */
/* The rail. A COLUMN now, not a bar: totals stack, the price sits above the
   button, and the whole thing stays on screen while the form is filled. */
.co-summary{position:sticky;top:18px;z-index:5;background:none;border:0;
  border-radius:0;padding:0;
  display:flex;flex-direction:column;gap:16px;box-shadow:none}
.co-summary__top{display:flex;flex-direction:column;gap:12px}
.co-summary__bottom{display:flex;flex-direction:column;gap:10px;padding-top:14px;
  border-top:1px solid var(--ln,#e5e7eb)}
/* Overriding the old bar layout: in a column the totals are the content, not
   a block pushed to one end. */
.co-summary .co-sums{margin-left:0;padding-right:0;gap:6px}
.co-summary .co-sumrow{font-size:13px;color:var(--tx2,#374151)}
.co-summary #co-cta{display:block;width:100%;padding:14px;border:0;border-radius:10px;
  background:var(--tx,#111);color:var(--sf,#fff);font:inherit;font-size:13px;font-weight:600;
  letter-spacing:.04em;cursor:pointer}
.co-summary #co-cta:disabled{opacity:.45;cursor:default}
.co-summary .co-total{font-size:28px;font-weight:700;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.co-summary .co-meta{font-size:12px;color:var(--tx3,#6b7280);text-transform:uppercase;letter-spacing:.06em}
.co-summary .co-sub{font-size:12px;color:var(--tx3,#6b7280)}
#co-cta{display:none}
@media(max-width:767px){
  /* Back to a ROW down here. The desktop rail is a column; a fixed bottom bar
     that stacked would be half the screen tall. */
  /* SOLID. The base rule is background:none — right for a sticky column with the
     page behind it, fatal for a FIXED bar: without a ground the page shows
     straight through it and a bar full of cart lines reads as a second,
     transparent cart floating at the bottom. It gets the same surface as the
     form panel so it is opaque. */
  .co-summary{position:fixed;left:0;right:0;bottom:0;top:auto;background:var(--sf,#fff);border-radius:14px 14px 0 0;
    border-left:0;border-right:0;border-bottom:0;box-shadow:0 -4px 24px rgba(0,0,0,.12);
    padding:12px 16px calc(12px + env(safe-area-inset-bottom));
    flex-direction:row;align-items:center;gap:12px}
  /* The bar is an ACTION bar (total + button), not a copy of the bag — the item
     list already lives in section 1 above. Hiding it here keeps the bar the
     slim 56px it was designed to be instead of a full cart restated at the
     bottom. Content stays in the DOM so showDone can still read it. */
  .co-summary .co-rail-items{display:none}
  /* PAYMENT, mobile: a horizontally scrollable TAB ROW, not a tall stack. Tap a
     tab and its options render below (that behaviour already existed — this
     turns the group picker into a scroller so it stops eating the screen). */
  .co-methods{display:flex;flex-wrap:nowrap;overflow-x:auto;gap:8px;padding-bottom:2px;
    scrollbar-width:none;-webkit-overflow-scrolling:touch}
  .co-methods::-webkit-scrollbar{display:none}
  .co-method{flex:0 0 auto;align-items:center}
  .co-method__sub{display:none}
  /* The chosen group's options: full width and uniform, so Wallets and Pay
     later read the same instead of one row of pills and one stack of half
     tiles. Name on the left, the terms line on the right. */
  .co-mpanel{flex-direction:column}
  .co-mopt{width:100%;flex-direction:row;align-items:center;justify-content:space-between;gap:10px}
  .co-mopt .co-vr{text-align:right;flex:0 0 auto}
  /* Success screen: the reparented bar must be gone — it was scrolling over the
     footer. Force it from CSS in case a later render un-hides it inline. */
  body.th-co-done .co-summary{display:none!important}
  .co-summary__top{flex:0 1 auto;gap:2px}
  .co-summary__bottom{flex:1 1 auto;flex-direction:row;align-items:center;justify-content:flex-end;
    gap:12px;padding-top:0;border-top:0}
  .co-summary .co-meta{display:none}
  /* Bam: "show subtotal, then place order — that's it." The bar was speaking
     three prices (Subtotal, the big total, and the total again on the button).
     The button already carries the figure being paid, so the standalone total
     goes; it stays in the DOM because showDone reads it for the receipt. */
  .co-summary .co-total{display:none}
  .co-summary #co-cta{width:auto;padding:11px 20px}
  /* No room for reassurance copy in a 56px bar — it lives on the form above. */
  .co-secure{display:none}
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
/* No marketing footer on the focused cart/checkout flow, at ANY width — Bam:
   "it doesn't make sense to have the footer in a checkout anyway." On mobile it
   also sat under the fixed cart bar, which scrolled right over it. */
html.th-co-active #brx-footer, html.th-co-active footer.site{display:none}
.co-panel{border:1px solid var(--ln,#e5e7eb);border-radius:14px;background:var(--sf,#fff);padding:20px}
.co-step{display:none}.co-step.on{display:block}
.co-line{display:flex;gap:14px;align-items:center;padding:14px 0;border-bottom:1px solid var(--ln,#eee)}
.co-line:last-child{border-bottom:0}
.co-line img{width:64px;height:64px;object-fit:cover;border-radius:8px;background:var(--sf2,#f4f4f5);flex:0 0 64px}
.co-line .co-nm{font-weight:600;font-size:14px}
.co-line .co-vr{font-size:12px;color:var(--tx3,#6b7280)}
.co-line .co-amt{margin-left:auto;font-weight:600;font-variant-numeric:tabular-nums}
/* Per-line remove. Quiet until pointed at — the line's own price stays the
   loudest thing in the row. */
.co-rm{background:none;border:0;color:var(--tx3,#9ca3af);font:inherit;font-size:18px;line-height:1;
  cursor:pointer;padding:6px 2px 6px 6px}
.co-rm:hover{color:#b91c1c}
.co-qty{display:inline-flex;align-items:center;border:1px solid var(--ln,#e5e7eb);border-radius:8px;overflow:hidden}
.co-qty button{border:0;background:transparent;padding:5px 10px;cursor:pointer;font-size:15px;line-height:1}
.co-qty span{min-width:26px;text-align:center;font-size:13px}
/* Bag lines on a phone: one flex row can't hold image + a long product name +
   stepper + price + × at 375px — the name column crushed the stepper until its
   overflow:hidden clipped the count and the + off. Two rows on a grid: the name
   gets the full width up top, the controls get their own row under it.
   NOTE this block must sit AFTER the base .co-line rules — same specificity,
   so source order is the tiebreak (the first attempt sat before them and lost). */
@media(max-width:767px){
  .co-line{display:grid;grid-template-columns:64px minmax(0,1fr) auto auto;
    grid-template-rows:auto auto;gap:6px 12px;align-items:center}
  .co-line img{grid-row:1/3;grid-column:1;align-self:start}
  .co-line > div{grid-column:2/5;grid-row:1;min-width:0}
  .co-line .co-qty{grid-column:2;grid-row:2;justify-self:start}
  .co-line .co-amt{grid-column:3;grid-row:2;margin-left:0}
  .co-line .co-rm{grid-column:4;grid-row:2}
}
.co-act{display:flex;gap:10px;margin-top:18px}
.co-act .btn{flex:1}
.co-back{background:transparent;border:0;color:var(--tx3,#6b7280);font:inherit;font-size:13px;cursor:pointer;padding:0;margin-bottom:14px}
.co-back:hover{color:var(--tx,#111)}
.co-field{margin-bottom:16px}
.co-field label{display:block;font-size:12px;font-weight:600;margin-bottom:6px}
.co-field input,.co-field select{width:100%;padding:11px 13px;border:1px solid var(--ln,#e5e7eb);border-radius:9px;font:inherit;background:#fff;color:inherit;-webkit-appearance:none;appearance:none}
.co-field select{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;padding-right:34px}
/* Quick buy opens the same flow in a sheet rather than navigating away. */
.co-quick{position:fixed;inset:0;z-index:80;display:none}
.co-quick.on{display:block}
.co-quick__veil{position:absolute;inset:0;background:rgba(0,0,0,.4)}
.co-quick__sheet{position:absolute;right:0;top:0;bottom:0;width:min(460px,100%);background:var(--sf,#fff);
  overflow-y:auto;padding:22px;box-shadow:-14px 0 44px rgba(0,0,0,.18)}
@media(max-width:600px){.co-quick__sheet{top:auto;width:100%;max-height:88vh;border-radius:16px 16px 0 0}}
/* In-place success panel — processing beat, then the order review. */
/* width:100% + min-width:0: as a grid item, the panel's min-content (the
   one-line "Order SM-… · email" ref) otherwise forces it WIDER than its track
   and the receipt clips off both edges of a phone. Long refs wrap instead. */
.co-done{width:100%;min-width:0;max-width:520px;margin:24px auto;padding:24px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:12px}
.co-done__ref{overflow-wrap:anywhere}
/* The success panel sets display:flex, which BEATS the bare [hidden] attribute
   (same specificity, later in the sheet) — so before any order the spinner and
   "Thanks for your purchase" were on screen. Restore hidden as the winner, like
   .co-cardwrap above. Nothing in here shows until showDone() drops the attribute. */
.co-done[hidden],.co-done__body[hidden]{display:none!important}
.co-done__spinner{width:40px;height:40px;border-radius:50%;border:3px solid var(--ln,rgba(0,0,0,.12));border-top-color:var(--tx,#111);animation:co-spin .8s linear infinite}
@keyframes co-spin{to{transform:rotate(360deg)}}
.co-done__processing{font-size:14px;color:var(--tx3,#6b7280);letter-spacing:.02em}
.co-done__body{display:flex;flex-direction:column;align-items:center;gap:12px;width:100%}
.co-done__tick{width:48px;height:48px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--tx,#111);color:var(--sf,#fff);font-size:24px;line-height:1;animation:co-pop .34s cubic-bezier(.2,.8,.3,1)}
@keyframes co-pop{from{transform:scale(.5);opacity:0}to{transform:scale(1);opacity:1}}
.co-done__title{font-size:20px;font-weight:800;letter-spacing:-.01em}
.co-done__sub{font-size:13px;color:var(--tx3,#6b7280);line-height:1.5;max-width:380px}
.co-done__summary{width:100%;border:1px solid var(--ln,rgba(0,0,0,.12));border-radius:14px;padding:14px;text-align:left;margin-top:4px}
.co-done__total{display:flex;justify-content:space-between;font-weight:800;padding-top:12px;margin-top:10px;border-top:1px solid var(--ln,rgba(0,0,0,.1))}
.co-done__ref{font-size:13px;font-weight:700;letter-spacing:.02em}
.co-done__link{display:inline-block;width:100%;padding:14px;background:var(--tx,#111);color:var(--sf,#fff);text-decoration:none;text-align:center;font-weight:700;border-radius:10px;font-size:14px}
.co-done__more{background:none;border:0;color:var(--tx3,#6b7280);font:inherit;font-size:13px;cursor:pointer;text-decoration:underline;padding:4px}
`;

// Major US cities → state, for the checkout city autocomplete. Not exhaustive —
// a paid geocoding API is what handles every hamlet — but enough that the common
// destinations type-ahead and fill the state, which is the friction to remove.
const US_CITIES: [string, string][] = [
  ['New York','NY'],['Los Angeles','CA'],['Chicago','IL'],['Houston','TX'],['Phoenix','AZ'],
  ['Philadelphia','PA'],['San Antonio','TX'],['San Diego','CA'],['Dallas','TX'],['San Jose','CA'],
  ['Austin','TX'],['Jacksonville','FL'],['Fort Worth','TX'],['Columbus','OH'],['Charlotte','NC'],
  ['San Francisco','CA'],['Indianapolis','IN'],['Seattle','WA'],['Denver','CO'],['Washington','DC'],
  ['Boston','MA'],['El Paso','TX'],['Nashville','TN'],['Detroit','MI'],['Oklahoma City','OK'],
  ['Portland','OR'],['Las Vegas','NV'],['Memphis','TN'],['Louisville','KY'],['Baltimore','MD'],
  ['Milwaukee','WI'],['Albuquerque','NM'],['Tucson','AZ'],['Fresno','CA'],['Sacramento','CA'],
  ['Mesa','AZ'],['Kansas City','MO'],['Atlanta','GA'],['Omaha','NE'],['Colorado Springs','CO'],
  ['Raleigh','NC'],['Long Beach','CA'],['Virginia Beach','VA'],['Miami','FL'],['Oakland','CA'],
  ['Minneapolis','MN'],['Tulsa','OK'],['Bakersfield','CA'],['Wichita','KS'],['Arlington','TX'],
  ['Aurora','CO'],['Tampa','FL'],['New Orleans','LA'],['Cleveland','OH'],['Anaheim','CA'],
  ['Honolulu','HI'],['Henderson','NV'],['Stockton','CA'],['Lexington','KY'],['Corpus Christi','TX'],
  ['Riverside','CA'],['Santa Ana','CA'],['Orlando','FL'],['Irvine','CA'],['Cincinnati','OH'],
  ['Newark','NJ'],['Saint Paul','MN'],['Pittsburgh','PA'],['Greensboro','NC'],['St. Louis','MO'],
  ['Lincoln','NE'],['Plano','TX'],['Anchorage','AK'],['Durham','NC'],['Jersey City','NJ'],
  ['Chandler','AZ'],['Buffalo','NY'],['Chula Vista','CA'],['Fort Wayne','IN'],['Madison','WI'],
  ['Lubbock','TX'],['Scottsdale','AZ'],['Reno','NV'],['Glendale','AZ'],['Norfolk','VA'],
  ['Winston-Salem','NC'],['Irving','TX'],['Chesapeake','VA'],['Gilbert','AZ'],['Hialeah','FL'],
  ['Garland','TX'],['Fremont','CA'],['Richmond','VA'],['Boise','ID'],['Baton Rouge','LA'],
  ['Des Moines','IA'],['Spokane','WA'],['San Bernardino','CA'],['Tacoma','WA'],['Modesto','CA'],
  ['Fontana','CA'],['Santa Clarita','CA'],['Birmingham','AL'],['Oxnard','CA'],['Fayetteville','NC'],
  ['Moreno Valley','CA'],['Rochester','NY'],['Glendale','CA'],['Huntington Beach','CA'],['Salt Lake City','UT'],
  ['Grand Rapids','MI'],['Amarillo','TX'],['Yonkers','NY'],['Aurora','IL'],['Montgomery','AL'],
  ['Akron','OH'],['Little Rock','AR'],['Huntsville','AL'],['Augusta','GA'],['Port St. Lucie','FL'],
  ['Grand Prairie','TX'],['Columbus','GA'],['Tallahassee','FL'],['Overland Park','KS'],['Tempe','AZ'],
  ['McKinney','TX'],['Mobile','AL'],['Cape Coral','FL'],['Shreveport','LA'],['Frisco','TX'],
  ['Knoxville','TN'],['Worcester','MA'],['Brownsville','TX'],['Vancouver','WA'],['Fort Lauderdale','FL'],
  ['Sioux Falls','SD'],['Ontario','CA'],['Chattanooga','TN'],['Providence','RI'],['Newport News','VA'],
  ['Rancho Cucamonga','CA'],['Santa Rosa','CA'],['Peoria','AZ'],['Oceanside','CA'],['Elk Grove','CA'],
  ['Salem','OR'],['Pembroke Pines','FL'],['Eugene','OR'],['Garden Grove','CA'],['Cary','NC'],
  ['Fort Collins','CO'],['Corona','CA'],['Springfield','MO'],['Jackson','MS'],['Alexandria','VA'],
  ['Hayward','CA'],['Clarksville','TN'],['Lakewood','CO'],['Lancaster','CA'],['Salinas','CA'],
  ['Palmdale','CA'],['Hollywood','FL'],['Springfield','MA'],['Macon','GA'],['Kansas City','KS'],
  ['Sunnyvale','CA'],['Pomona','CA'],['Killeen','TX'],['Escondido','CA'],['Pasadena','TX'],
  ['Naperville','IL'],['Bellevue','WA'],['Joliet','IL'],['Murfreesboro','TN'],['Midland','TX'],
  ['Rockford','IL'],['Paterson','NJ'],['Savannah','GA'],['Bridgeport','CT'],['Torrance','CA'],
  ['McAllen','TX'],['Syracuse','NY'],['Surprise','AZ'],['Denton','TX'],['Roseville','CA'],
  ['Thornton','CO'],['Miramar','FL'],['Pasadena','CA'],['Mesquite','TX'],['Olathe','KS'],
  ['Dayton','OH'],['Carrollton','TX'],['Waco','TX'],['Orange','CA'],['Fullerton','CA'],
  ['Charleston','SC'],['West Valley City','UT'],['Visalia','CA'],['Hampton','VA'],['Gainesville','FL'],
  ['Warren','MI'],['Coral Springs','FL'],['Cedar Rapids','IA'],['Round Rock','TX'],['Sterling Heights','MI'],
  ['Kent','WA'],['Columbia','SC'],['Santa Clara','CA'],['New Haven','CT'],['Stamford','CT'],
  ['Concord','CA'],['Elizabeth','NJ'],['Athens','GA'],['Thousand Oaks','CA'],['Lafayette','LA'],
  ['Simi Valley','CA'],['Topeka','KS'],['Norman','OK'],['Fargo','ND'],['Wilmington','NC'],
  ['Abilene','TX'],['Odessa','TX'],['Columbia','MO'],['Pearland','TX'],['Victorville','CA'],
];
// City names are a hardcoded, controlled list with no HTML-special characters,
// so no escaping is needed (and esc is a runtime local, not in scope here).
export const CITY_DATALIST = '<datalist id="co-cities">'
  + US_CITIES.map(([c]) => `<option value="${c}"></option>`).join('') + '</datalist>';
// Country picker — a <select> from the shared full-ISO list (src/site/countries.ts),
// never a maxlength=2 text input (browser autofill overflows those with the full
// name and dead-ends checkout). The same module backs the on-card buy box and the
// account address book so the fix can't drift between surfaces again.
export const COUNTRY_SELECT = countrySelect('id="co-country" autocomplete="shipping country" aria-label="Country"');
/** city (lowercased) → state, as a JS object literal for the runtime. */
const CITY_MAP_JS = JSON.stringify(Object.fromEntries(US_CITIES.map(([c, s]) => [c.toLowerCase(), s])));

/** Server-rendered shell. Everything inside is filled by the runtime. */
export function checkoutFlowMarkup(): string {
  return `
<div class="co-flow" id="co-flow">
  <!-- THE FORM COLUMN. Numbered sections, so the shopper can see how much is
       left rather than discovering it one screen at a time. Every id the
       runtime drives is unchanged — this is the shell around it, not a
       rewrite of the machinery underneath. -->
  <div class="co-panel">
    <section class="co-sec" data-co-sec="cart">
      <div class="co-sec__head">
        <h2><span class="co-sec__n">1</span> Your bag</h2>
        <span class="co-sec__status" id="co-count">—</span>
      </div>
      <div class="co-step on" id="co-step-cart"><p class="page-sub">Loading…</p></div>
    </section>

    <div class="co-step" id="co-step-pay"></div>
    <span id="co-mode-label" hidden></span>
  </div>

  <!-- THE RAIL. Sticky on desktop so the total is on screen the whole way
       down the form; a fixed bottom bar on mobile, which is where the
       platform convention and the thumb both are. -->
  <aside class="co-summary">
    <div class="co-summary__top">
      <div class="co-meta">Order summary</div>
      <div class="co-rail-items" id="co-rail-items"></div>
      <!-- ONE subtotal row, always. It sits above the breakdown and is the
           same element whether or not shipping has been quoted, so the panel
           can never show the figure twice. -->
      <div class="co-sumrow co-sumrow--sub"><span>Subtotal</span><span id="co-rail-sub">—</span></div>
      <div class="co-sums" id="co-sums" hidden>
        <div class="co-sumrow"><span>Shipping</span><span id="co-sum-ship">—</span></div>
        <div class="co-sumrow" id="co-sum-taxrow" hidden><span>Tax</span><span id="co-sum-tax">—</span></div>
      </div>
    </div>
    <div class="co-summary__bottom">
      <div class="co-total" id="co-total">—</div>
      <button id="co-cta" type="button">Checkout</button>
      <p class="co-secure">Encrypted end to end · card details never touch this server</p>
    </div>
  </aside>

  <!-- SUCCESS, IN PLACE. The old flow hard-redirected to /order-received the
       instant the charge cleared, so the most important moment — it worked —
       happened on a different page the shopper did not choose to load. This
       replaces the checkout with a processing beat, then the order review, a
       link straight to the order, and the number to keep. Same shape as the
       product card's done step. -->
  <div class="co-done" id="co-done" hidden aria-live="polite">
    <div class="co-done__spinner" id="co-done-spinner" aria-hidden="true"></div>
    <div class="co-done__processing" id="co-done-processing">Processing your order…</div>
    <div class="co-done__body" id="co-done-body" hidden>
      <div class="co-done__tick" aria-hidden="true">✓</div>
      <div class="co-done__title">Thanks for your purchase</div>
      <div class="co-done__sub">Saved to your account and sent to your email — screenshot this or open your order below.</div>
      <div class="co-done__summary" id="co-done-summary"></div>
      <div class="co-done__ref" id="co-done-ref"></div>
      <a class="co-done__link" id="co-done-link" target="_blank" rel="noopener">View your order →</a>
      <button type="button" class="co-done__more" id="co-done-more">Continue shopping</button>
    </div>
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
  var G = null; // which payment GROUP tile is open
  // City -> state autofill. The <datalist> gives the type-ahead; when what was
  // typed matches a known city, the state (and country) fill themselves, unless
  // the shopper already put something there. Delegated because the checkout form
  // is rendered into the shell after this runs.
  var CITY_STATE = ${CITY_MAP_JS};
  document.addEventListener('input', function(e){
    var t = e.target; if (!t || t.id !== 'co-city') return;
    var st = CITY_STATE[(t.value || '').trim().toLowerCase()]; if (!st) return;
    var reg = document.getElementById('co-region'); if (reg && !reg.value.trim()) reg.value = st;
    var ctry = document.getElementById('co-country'); if (ctry && !ctry.value.trim()) ctry.value = 'US';
  });
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
    LAST_TOTAL = t.total;   // the wallet sheet charges this exact figure

    var sums = el('co-sums');
    if (sums) {
      // Shown only once an address exists — before that, shipping and tax are
      // genuinely unknown, and a breakdown reading "Free" would be a guess.
      var known = mode === 'pay' && (t.shipping > 0 || t.tax > 0 || SHIP_QUOTED);
      sums.hidden = !known;
      if (known) {
        el('co-sum-ship').textContent = t.shipping > 0 ? fmt(t.shipping) : 'Free';
        el('co-sum-taxrow').hidden = !(t.tax > 0);
        if (t.tax > 0) el('co-sum-tax').textContent = fmt(t.tax);
      }
    }
    var n = t.lines.reduce(function(a,l){ return a + l.quantity; }, 0);
    el('co-count').textContent = n + (n === 1 ? ' item' : ' items');
    var ml = el('co-mode-label');
    if (ml) ml.textContent = mode === 'pay' ? 'Checkout' : 'Cart';

    // WHAT IS IN THE RAIL, from the moment the page loads.
    // The rail used to hold a total and nothing else until the pay step, so
    // the most important column on the page was blank on arrival — the
    // shopper could not see what they were buying next to what it cost.
    var railItems = el('co-rail-items');
    if (railItems) {
      railItems.innerHTML = t.lines.map(function(l){
        var meta = [l.color, l.size].filter(Boolean).join(' · ');
        return '<div class="co-rail-line">'
          + (l.image
              ? '<img class="co-rail-img" src="' + l.image + '" alt="" loading="lazy">'
              : '<span class="co-rail-img co-rail-img--ph"></span>')
          + '<span class="co-rail-txt"><span class="co-rail-nm">' + l.productName + '</span>'
          + (meta ? '<span class="co-rail-meta">' + meta + '</span>' : '')
          + '<span class="co-rail-meta">Qty ' + l.quantity + '</span></span>'
          + '<span class="co-rail-amt">' + fmt(l.lineTotal) + '</span></div>';
      }).join('');
    }
    // Subtotal is knowable the instant there is a cart, so it shows straight
    // away; only shipping and tax wait for an address.
    var sub = el('co-rail-sub');
    if (sub) sub.textContent = fmt(t.subtotal);

    // Section state: the bag is done once it has something in it, and the
    // delivery section lights up when it is the one being worked on.
    var secCart = document.querySelector('[data-co-sec="cart"]');
    if (secCart) { secCart.classList.toggle('is-done', n > 0); secCart.classList.toggle('is-focus', mode !== 'pay'); }
    // Sections 2-4 are emitted by the pay step itself and manage their own
    // state there; nothing to reach for from here.
  }

  function lineRow(l){
    return '<div class="co-line">'
      + (l.image ? '<img src="' + l.image + '" alt="">' : '<img alt="">')
      + '<div><div class="co-nm">' + l.productName + '</div>'
      + '<div class="co-vr">' + [l.color, l.size, l.sku].filter(Boolean).join(' · ') + '</div></div>'
      + '<span class="co-qty"><button data-dec="' + l.variantId + '" aria-label="Decrease">−</button>'
      + '<span>' + l.quantity + '</span>'
      + '<button data-inc="' + l.variantId + '" data-q="' + l.quantity + '" aria-label="Increase">+</button></span>'
      + '<span class="co-amt">' + fmt(l.lineTotal) + '</span>'
      + '<button class="co-rm" type="button" data-rm="' + l.variantId + '" aria-label="Remove ' + l.productName + '">×</button></div>';
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
      await api('/cart/coupon', { method:'DELETE', useToken: true }).catch(function(){});
      renderCart();
    });

    step.querySelectorAll('[data-inc]').forEach(function(b){
      b.addEventListener('click', async function(){
        await api('/cart/items/' + b.dataset.inc, { method:'PATCH', body: JSON.stringify({ cartToken: tok(), quantity: Number(b.dataset.q) + 1 }) }).catch(function(e){ alert(e.message); });
        renderCart(); refreshCount();
        // The ported header's .js-cart-info badges update on this event only —
        // refreshCount() touches just the fallback #cart-count.
        try { window.dispatchEvent(new CustomEvent('therum:cart-changed')); } catch (e) {}
      });
    });
    step.querySelectorAll('[data-dec]').forEach(function(b){
      b.addEventListener('click', async function(){
        var l = t.lines.find(function(x){ return x.variantId === b.dataset.dec; });
        await api('/cart/items/' + b.dataset.dec, { method:'PATCH', body: JSON.stringify({ cartToken: tok(), quantity: l.quantity - 1 }) }).catch(function(e){ alert(e.message); });
        renderCart(); refreshCount();
        // The ported header's .js-cart-info badges update on this event only —
        // refreshCount() touches just the fallback #cart-count.
        try { window.dispatchEvent(new CustomEvent('therum:cart-changed')); } catch (e) {}
      });
    });
    // Explicit remove — quantity 0 is the server's "take this line out". The −
    // stepper reaching 0 does the same thing, but a visible × is the control a
    // shopper actually looks for.
    step.querySelectorAll('[data-rm]').forEach(function(b){
      b.addEventListener('click', async function(){
        await api('/cart/items/' + b.dataset.rm, { method:'PATCH', body: JSON.stringify({ cartToken: tok(), quantity: 0 }) }).catch(function(e){ alert(e.message); });
        renderCart(); refreshCount();
        // The ported header's .js-cart-info badges update on this event only —
        // refreshCount() touches just the fallback #cart-count.
        try { window.dispatchEvent(new CustomEvent('therum:cart-changed')); } catch (e) {}
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

    // Items stay visible on the payment step: the brief is price at top, items
    // below, in BOTH modes — hiding what they are buying at the moment they pay
    // is where doubt creeps in.
    var items = t.lines.map(function(l){
      return '<div class="co-line"><div><div class="co-nm">' + l.quantity + ' × ' + l.productName + '</div>'
        + '<div class="co-vr">' + [l.color, l.size].filter(Boolean).join(' · ') + '</div></div>'
        + '<span class="co-amt">' + fmt(l.lineTotal) + '</span></div>';
    }).join('');

    // ── PAYMENT: TILES BY GROUP, NOT A LIST OF EVERY METHOD ───────────────
    //
    // The flat list rendered one radio per method — every wallet, every
    // pay-later provider, every P2P app — which is a scroll of near-identical
    // rows at the exact moment someone is deciding to hand over money.
    //
    // Grouped, it is at most six choices, each with a line saying what the
    // thing actually is. Picking one opens its own methods beneath. A group
    // with nothing connected is rendered DISABLED rather than hidden, so the
    // shopper can see what the store supports without being offered something
    // that would fail at the point of payment.
    var byGroup = {};
    reg.methods.forEach(function(m){ (byGroup[m.group] = byGroup[m.group] || []).push(m); });
    if (!G) {
      // Open on the first group that can actually take a payment.
      var firstReady = (reg.groups || []).filter(function(g){
        return (byGroup[g.id] || []).some(function(m){ return m.available; });
      })[0];
      G = firstReady ? firstReady.id : ((reg.groups || [])[0] || {}).id;
    }
    var tiles = (reg.groups || []).map(function(g){
      var inG = byGroup[g.id] || [];
      var any = inG.some(function(m){ return m.available; });
      // The description is built from the group's OWN methods, so it can never
      // advertise a provider this store has not connected.
      var names = inG.filter(function(m){ return m.available; }).map(function(m){ return m.label; });
      var sub = names.length ? names.slice(0, 4).join(' · ')
        : (inG[0] && inG[0].sub) ? inG[0].sub : 'Not connected yet';
      return '<button type="button" class="co-method' + (G === g.id ? ' on' : '') + '"'
        + ' data-mgroup="' + g.id + '"' + (any ? '' : ' disabled')
        + (any ? '' : ' title="No provider connected for this yet"') + '>'
        + '<span class="co-method__ico">' + (g.ico || '') + '</span>'
        + '<span><span class="co-method__nm">' + g.label + '</span>'
        + '<span class="co-method__sub">' + sub + '</span></span>'
        + '</button>';
    }).join('');

    // The chosen group's actual methods. One option needs no chooser — the
    // tile already said what it is.
    var inChosen = (byGroup[G] || []).filter(function(m){ return m.available; });
    if (!F.id && inChosen.length) F = { id: inChosen[0].id, provider: inChosen[0].provider, label: inChosen[0].label };
    // Tap-select, not radios. Bam's call: the group tile is already a big tap
    // target, so a second column of radio dials beneath it is the exact
    // "buttony" clutter the quick checkout does not have. A single-method group
    // needs no chooser at all — F.id was set from inChosen[0] just above.
    var comingInG = (byGroup[G] || []).filter(function(m){ return !m.available && m.comingSoon; });
    var methods = '<div class="co-methods">' + tiles + '</div>'
      + (inChosen.length > 1
          ? '<div class="co-mpanel">' + inChosen.map(function(m){
              return '<button type="button" class="co-mopt' + (F.id === m.id ? ' on' : '') + '"'
                + ' data-method="' + m.id + '" data-p="' + (m.provider || '') + '" data-l="' + m.label + '">'
                + '<span class="co-nm">' + m.label + '</span>'
                + (m.sub ? '<span class="co-vr">' + m.sub + '</span>' : '') + '</button>';
            }).join('') + '</div>'
          : '')
      // Coming-soon rails (approval pending) render inert, so a shopper sees
      // they are on the way rather than missing entirely.
      + (comingInG.length
          ? '<div class="co-mpanel co-mpanel--soon">' + comingInG.map(function(m){
              return '<button type="button" class="co-mopt" disabled aria-disabled="true">'
                + '<span class="co-nm">' + m.label + '</span>'
                + '<span class="co-vr">Payment availability coming soon</span></button>';
            }).join('') + '</div>'
          : '');

    // THREE NUMBERED SECTIONS, not one long form.
    //
    // The step used to emit email, address, shipping and payment as four
    // unlabelled field groups in a row — no sense of how much was left, and
    // shipping buried between two bigger blocks. Numbering them is the single
    // change that most reduces abandonment on a form nobody wanted to fill in,
    // and it lets shipping be its own thing rather than a footnote of the
    // address.
    //
    // The bag is section 1, rendered outside this function, so these start
    // at 2. Every id below is unchanged — the wiring does not know or care
    // that the chrome around it moved.
    var sec = function(n, title, status, body, cls){
      return '<section class="co-sec' + (cls ? ' ' + cls : '') + '" data-co-sec="' + n + '">'
        + '<div class="co-sec__head"><h2><span class="co-sec__n">' + n + '</span> ' + title + '</h2>'
        + '<span class="co-sec__status">' + status + '</span></div>' + body + '</section>';
    };

    return '<button class="co-back" id="co-back" type="button">← Back to cart</button>'
      + sec(2, 'Your details', 'Where it goes',
          '<div class="co-field"><label for="co-email">Email for your receipt</label>'
          + '<input id="co-email" type="email" placeholder="you@example.com" autocomplete="email"></div>'
          + '<div class="co-field"><label for="co-phone">Phone <span class="co-vr" style="font-weight:400">(optional)</span></label>'
          + '<input id="co-phone" type="tel" inputmode="tel" placeholder="(555) 123-4567" autocomplete="tel"></div>'
          + '<div class="co-field"><label>Shipping address</label>'
          + '<input id="co-name" placeholder="Full name" autocomplete="shipping name">'
          + '<input id="co-line1" placeholder="Street address" autocomplete="shipping address-line1">'
          + '<input id="co-line2" placeholder="Apartment, suite (optional)" autocomplete="shipping address-line2">'
          + '<div class="co-row2"><input id="co-city" placeholder="City" autocomplete="shipping address-level2" list="co-cities">'
          + '<input id="co-region" placeholder="State / region" autocomplete="shipping address-level1"></div>'
          + '<div class="co-row2"><input id="co-postal" placeholder="Postal code" autocomplete="shipping postal-code">'
          + ${JSON.stringify(COUNTRY_SELECT)} + '</div>'
          // As-you-type city suggestions with the state auto-filled. A bundled
          // list of the major US cities rather than a paid geocoding API — no
          // key to leak, no request per keystroke, works offline. The native
          // <datalist> gives the type-ahead; the runtime fills the state.
          // Injected as a JS string literal (this whole block is the runtime).
          + ${JSON.stringify(CITY_DATALIST)}
          + '</div>')
      // Its own step, with the rows carrying carrier and timeframe rather
      // than a bare price. Hidden until an address exists, because a delivery
      // estimate without a destination is a guess.
      + sec(3, 'Shipping', 'Add an address first',
          '<div class="co-field" id="co-ship-field" hidden><div id="co-ship-rows"></div></div>'
          + '<p class="co-vr" id="co-ship-hint">Enter your address above and we will quote it.</p>')
      + sec(4, 'Payment', avail.length ? 'Pick a method' : 'Not connected',
          (methods || '<p class="co-vr">No payment methods are connected yet.</p>')
          + '<div class="co-cardwrap" id="co-cardwrap"' + (G === 'card' ? '' : ' hidden') + '>'
          + '<div class="co-card">'
          + '<div class="co-card__top"><span class="co-card__chip"></span>'
          + '<span class="co-card__brand" id="co-card-brand">Card</span></div>'
          + '<div class="co-card__field" id="co-cardfield"></div>'
          + '<div class="co-card__foot"><span>Card holder</span><span>Expires</span></div>'
          + '</div>'
          + '<p class="co-card__note">Handled by our payment provider. Your card number never reaches this site.</p>'
          + '</div>')
      + '<div class="co-act"><button class="btn" id="co-place" type="button"' + (avail.length ? '' : ' disabled') + '>Place order · ' + fmt(t.total) + '</button></div>'
      + '<div id="co-msg"></div>';
  }

  var SHIP_QUOTED = false;

  // ── The hosted card field ─────────────────────────────────────────────
  //
  // The main checkout had NO card entry at all. It created the order and
  // jumped straight to a receipt, so the only way it could ever have taken
  // money was a redirect that /cart/checkout does not return.
  //
  // The gateway's own iframe, exactly as the product card does it — raw card
  // numbers never reach this origin, which is what keeps the store out of PCI
  // scope.
  var CARD_EL = null;         // the mounted field, once it exists
  var PAY_PROVIDER = null;    // which gateway mounted it
  var LAST_TOTAL = 0;         // latest cart total (minor units) — what the wallet sheet charges
  var WALLET_IDS = { apple_pay: 1, google_pay: 1, link: 1 }; // Stripe payment-request wallets
  var BNPL_IDS = { klarna: 1, affirm: 1, afterpay: 1, cashapp: 1 }; // Stripe redirect rails
  var CARD_CFG = null;
  // Which account the Stripe-backed methods settle to. 'stripe' = the direct
  // Nexus key (default, unchanged). 'woopay' = confirm in-page against the
  // WooPayments merchant account. Set from /shop/wallets, which reflects the
  // server cardProvider flag; the method strip's data-p stays 'stripe' either
  // way, so this is the single source of truth for the rail on the client.
  var CARD_RAIL = 'stripe';
  // Resolve the rail ONCE, authoritatively, and let the place-order handler
  // await it — otherwise a fast tap could settle before mountCard/warm set
  // CARD_RAIL and BNPL money would leak to the direct account.
  var RAIL_READY = null;
  function resolveRail(){
    if (RAIL_READY) return RAIL_READY;
    RAIL_READY = (async function(){
      try {
        var data = await api('/shop/wallets', {});
        var wp = (data.providers || []).filter(function(p){ return p.provider === 'woopay' && p.ready; })[0];
        CARD_RAIL = wp ? 'woopay' : 'stripe';
      } catch (e) { /* leave the safe default */ }
      return CARD_RAIL;
    })();
    return RAIL_READY;
  }

  function loadSdk(src){
    return new Promise(function(res, rej){
      if ([].slice.call(document.scripts).some(function(s){ return s.src === src; })) return res();
      var el = document.createElement('script');
      // A CDN that never answers otherwise pins the flow on "Placing…" with no
      // way out. If the script lands after the timeout anyway, the next call
      // resolves instantly off the already-present check above.
      var t = setTimeout(function(){ rej(new Error('Payment is taking too long to load — try again.')); }, 15000);
      el.src = src; el.async = true;
      el.onload = function(){ clearTimeout(t); res(); };
      el.onerror = function(){ clearTimeout(t); rej(new Error('Payment SDK could not load.')); };
      document.head.appendChild(el);
    });
  }

  async function mountCard(scope){
    var host = scope.querySelector('#co-cardfield');
    if (!host || CARD_EL) return;
    try {
      var data = await (await fetch('/api/shop/wallets')).json();
      var provs = data.providers || [];
      // Prefer the WooPayments confirm rail when the flag exposes it; otherwise
      // the first ready token provider (Stripe/Square) exactly as before.
      var p = provs.filter(function(x){ return x.ready && x.provider === 'woopay'; })[0]
           || provs.filter(function(x){ return x.ready && x.kind === 'token'; })[0];
      if (!p) return;
      var c = p.client || {};
      PAY_PROVIDER = p.provider;
      CARD_CFG = c;
      if (p.provider === 'woopay' && c.publishableKey && c.stripeAccount) {
        CARD_RAIL = 'woopay';
        await loadSdk('https://js.stripe.com/v3/');
        // MUST be built against the connected account — the intent belongs to
        // it and confirm rejects otherwise.
        var wstripe = window.Stripe(c.publishableKey, { stripeAccount: c.stripeAccount });
        CARD_EL = wstripe.elements().create('card');
        CARD_EL._stripe = wstripe;
        CARD_EL.mount(host);
        CARD_EL.on('change', function(ev){
          var b = scope.querySelector('#co-card-brand');
          if (b) b.textContent = (ev.brand && ev.brand !== 'unknown') ? ev.brand.toUpperCase() : 'Card';
        });
      } else if (p.provider === 'stripe' && c.publishableKey) {
        CARD_RAIL = 'stripe';
        await loadSdk('https://js.stripe.com/v3/');
        var stripe = window.Stripe(c.publishableKey);
        CARD_EL = stripe.elements().create('card');
        CARD_EL._stripe = stripe;
        CARD_EL.mount(host);
        // Stripe writes into the card face, so the brand line can follow it.
        CARD_EL.on('change', function(ev){
          var b = scope.querySelector('#co-card-brand');
          if (b) b.textContent = (ev.brand && ev.brand !== 'unknown') ? ev.brand.toUpperCase() : 'Card';
        });
      } else if (p.provider === 'square' && c.publishableKey && c.locationId) {
        await loadSdk(c.environment === 'live'
          ? 'https://web.squarecdn.com/v1/square.js'
          : 'https://sandbox.web.squarecdn.com/v1/square.js');
        var payments = window.Square.payments(c.publishableKey, c.locationId);
        CARD_EL = await payments.card();
        await CARD_EL.attach(host);
      }
    } catch (e) { /* the field is optional; the error surfaces on Place order */ }
  }

  /** A token, or the string 'cancelled' when the shopper backed out. */
  async function tokenizeCard(){
    if (!CARD_EL) return null;
    if (PAY_PROVIDER === 'square') {
      var r = await CARD_EL.tokenize();
      if (r.status !== 'OK') {
        var m = (r.errors && r.errors[0] && r.errors[0].message) || '';
        if (/cancel|abort/i.test(m)) return 'cancelled';
        throw new Error(m || 'Card was not accepted.');
      }
      return r.token;
    }
    var out = await CARD_EL._stripe.createPaymentMethod({ type: 'card', card: CARD_EL });
    if (out.error) {
      if (/cancel|abort/i.test(out.error.message || '')) return 'cancelled';
      throw new Error(out.error.message);
    }
    return out.paymentMethod.id;
  }

  /* Settle an order through WooPayments: create the intent server-side, confirm
     it in the browser against the connected account. Card + wallets confirm
     in-page; BNPL confirms then redirects out and returns to /checkout/return.
     source is { cardEl } for the typed card, { pmId } for a wallet's
     payment-method, or {} for BNPL. Throws on decline; returns 'cancelled' when
     the shopper backs out of a 3DS/wallet step. */
  async function settleWoopay(num, tokn, method, source, ship, email){
    var started = await api('/shop/checkout/redirect-start', { method:'POST', body: JSON.stringify({
      orderNumber: num, accessToken: tokn, provider: 'woopay', method: method }) });
    if (!started.clientSecret || !started.publishableKey || !started.stripeAccount) {
      throw new Error('WooPayments could not start this charge. Refresh and try again, or pick another method.');
    }
    await loadSdk('https://js.stripe.com/v3/');
    var stripe = (source && source.cardEl && source.cardEl._stripe)
      || window.Stripe(started.publishableKey, { stripeAccount: started.stripeAccount });
    var returnUrl = location.origin + '/checkout/return?provider=woopay&order='
      + encodeURIComponent(num) + '&t=' + encodeURIComponent(tokn);
    var billing = { name: (ship && ship.name) || '', email: email || '' };
    if (ship) {
      billing.address = { line1: ship.line1 || '', city: ship.city || '', country: ship.country || '' };
      if (ship.line2) billing.address.line2 = ship.line2;
      if (ship.region) billing.address.state = ship.region;
      if (ship.postalCode) billing.address.postal_code = ship.postalCode;
    }
    var res;
    if (method === 'card' || WALLET_IDS[method]) {
      var pm = (source && source.pmId)
        ? source.pmId
        : { card: source.cardEl, billing_details: billing };
      res = await stripe.confirmCardPayment(started.clientSecret, { payment_method: pm });
    } else if (method === 'klarna') {
      res = await stripe.confirmKlarnaPayment(started.clientSecret, { payment_method: { billing_details: billing }, return_url: returnUrl });
    } else if (method === 'affirm') {
      res = await stripe.confirmAffirmPayment(started.clientSecret, { return_url: returnUrl });
    } else if (method === 'afterpay') {
      res = await stripe.confirmAfterpayClearpayPayment(started.clientSecret, { payment_method: { billing_details: billing }, return_url: returnUrl });
    } else if (method === 'cashapp') {
      res = await stripe.confirmCashappPayment(started.clientSecret, { return_url: returnUrl });
    } else {
      res = await stripe.confirmCardPayment(started.clientSecret, { payment_method: { card: source.cardEl, billing_details: billing } });
    }
    if (res && res.error) {
      if (/cancel|abort/i.test(res.error.message || '')) return 'cancelled';
      throw new Error(res.error.message);
    }
    // BNPL navigates away on success (no error) and never reaches here; card +
    // wallets resolve IN-PAGE, so nothing would settle them — the engine's
    // WCPay webhook does not reliably complete our custom intent. Settle right
    // here (poll the succeeded intent → markPaid) so the order flips to paid the
    // moment the card confirms; the webhook stays a backup and markPaid is
    // idempotent, so a later webhook is a no-op.
    if (method === 'card' || WALLET_IDS[method]) {
      try {
        await api('/shop/checkout/redirect-finish', { method: 'POST', body: JSON.stringify({
          orderNumber: num, accessToken: tokn, provider: 'woopay' }) });
      } catch (e) { /* webhook remains the backup */ }
    }
    return 'ok';
  }

  /** Stripe wallets (Apple Pay / Google Pay / Link) in the MAIN checkout.
   *
   *  PRE-WARMED, SYNC-SHOWN. iOS opens a wallet sheet only when show() runs
   *  synchronously inside the tap — the first version awaited the wallets
   *  fetch, the SDK load and canMakePayment between the tap and show(), which
   *  is the exact gesture-law bug the buy box shipped and fixed. So the
   *  PaymentRequest is built when the pay step renders (warmCheckoutWallet),
   *  and the tap only update()s the total and show()s.
   *
   *  The native sheet authorises FIRST; the order is written inside the
   *  paymentmethod callback — a dismissed sheet leaves no unpaid order.
   *  Charges through the same /shop/checkout/pay-token the card path uses. */
  var CO_PR = null;        // pre-warmed PaymentRequest
  // undefined = probe still running, null = resolved "nothing available",
  // object = presentable. The distinction matters at tap time: a fast tap
  // during the probe must hear "warming up, tap again" — not a false
  // "Apple Pay is not available on this device".
  var CO_PR_CAN;
  var CO_PENDING = null;   // {ship,msg,reset} for the tap in flight
  // Flight recorder — same as the buy box's: stage pings to the server log so
  // a sheet that dies on a real phone names its dying step.
  function wlog(stage){
    try {
      var body = JSON.stringify({ stage: stage, ua: (navigator.userAgent || '').slice(0, 90) });
      if (navigator.sendBeacon) navigator.sendBeacon('/api/shop/wallet-log', new Blob([body], { type: 'application/json' }));
      else fetch('/api/shop/wallet-log', { method: 'POST', headers: { 'content-type': 'application/json' }, body: body, keepalive: true });
    } catch (e) {}
  }
  function coNote(msg, text){
    if (!msg) return;
    msg.innerHTML = '<p class="notice err">' + text + '</p>';
    // Instant, never smooth: the whole point is a guarantee the words are on
    // screen, and smooth scrolling rides animation frames.
    try { msg.scrollIntoView({ block: 'center' }); } catch (x) {}
  }
  function warmCheckoutWallet(){
    if (CO_PR || warmCheckoutWallet.busy) return;
    warmCheckoutWallet.busy = true;
    (async function(){
      try {
        var data = await api('/shop/wallets', {});
        var provs = data.providers || [];
        // Prefer the WooPayments confirm rail when present, so wallet money lands
        // in the merchant account, not the direct key.
        var sp = provs.filter(function(p){ return p.provider === 'woopay' && p.ready; })[0]
              || provs.filter(function(p){ return p.provider === 'stripe' && p.ready; })[0];
        var wc = sp && sp.client;
        var key = wc && wc.publishableKey;
        if (!key) return;
        await loadSdk('https://js.stripe.com/v3/');
        // The PaymentRequest's payment method must belong to whichever account
        // will confirm it — build Stripe.js against the connected account for
        // WooPayments so the pm id is valid at confirm.
        var stripe = (sp.provider === 'woopay' && wc.stripeAccount)
          ? window.Stripe(key, { stripeAccount: wc.stripeAccount })
          : window.Stripe(key);
        if (sp.provider === 'woopay') CARD_RAIL = 'woopay';
        var pr = stripe.paymentRequest({
          country: 'US', currency: 'usd',
          total: { label: '${process.env.SITE_NAME || ''}', amount: Math.max(1, LAST_TOTAL || 100) },
          requestPayerName: true, requestPayerEmail: true
        });
        pr.on('paymentmethod', async function(ev){
          wlog('checkout:paymentmethod');
          var P = CO_PENDING || {};
          // ONE completion, never later than the sheet's own patience: three
          // sequential 15s-capped calls could outlive the ~30s iOS allows.
          // Same watchdog shape as the buy box — whichever side loses the race
          // is a no-op, and a late success still paints the receipt below,
          // because by then the charge has landed.
          var settled = false;
          function complete(state){ if (settled) return false; settled = true; try { ev.complete(state); } catch (x) {} return true; }
          var watchdog = setTimeout(function(){
            wlog('checkout:watchdog-fired');
            if (complete('fail')) coNote(P.msg, 'That took too long — check your email for an order confirmation before trying again.');
          }, 25000);
          try {
            var email = (el('co-email') || {}).value || ev.payerEmail || '';
            if (email) await api('/cart/identity', { method: 'POST', body: JSON.stringify({ cartToken: tok(), email: email }) });
            var out = await api('/cart/checkout', { method: 'POST', body: JSON.stringify({ cartToken: tok(), method: F.id, provider: F.provider, shipAddress: P.ship }) });
            var num = out.orderNumber, tokn = out.accessToken;
            if (CARD_RAIL === 'woopay') {
              // Confirm the wallet payment-method against the WooPayments intent.
              await settleWoopay(num, tokn, F.id, { pmId: ev.paymentMethod.id }, P.ship, email);
            } else {
              await api('/shop/checkout/pay-token', { method: 'POST', body: JSON.stringify({ orderNumber: num, accessToken: tokn, provider: 'stripe', token: ev.paymentMethod.id }) });
            }
            clearTimeout(watchdog);
            wlog('checkout:paid-ok');
            complete('success');
            CO_PENDING = null;
            // Capture the receipt before setTok clears the cart (see showDone note).
            var doneItems = el('co-rail-items') ? el('co-rail-items').innerHTML : '';
            var doneTotal = el('co-total') ? (el('co-total').textContent || '').trim() : '';
            setTok(null); refreshCount();
            showDone(num, tokn, doneItems, doneTotal);
          } catch (e) {
            clearTimeout(watchdog);
            wlog('checkout:settle-error:' + String(e && e.message || e).slice(0, 60));
            if (complete('fail')) {
              coNote(P.msg, e.message || 'Payment could not be completed.');
              if (P.reset) P.reset();
            }
            CO_PENDING = null;
          }
        });
        // Dismissing the sheet is not a failure — just put the button back.
        pr.on('cancel', function(){ wlog('checkout:cancel'); if (CO_PENDING && CO_PENDING.reset) CO_PENDING.reset(); CO_PENDING = null; });
        // canMakePayment can hang in some in-app browsers — cap it.
        CO_PR = pr;
        CO_PR_CAN = await Promise.race([
          pr.canMakePayment(),
          new Promise(function(res){ setTimeout(function(){ res(null); }, 8000); })
        ]);
        wlog('checkout:can:' + (CO_PR_CAN ? Object.keys(CO_PR_CAN).filter(function(k){ return CO_PR_CAN[k]; }).join('+') : 'none'));
      } catch (e) { /* card + others still sell */ }
      finally { warmCheckoutWallet.busy = false; }
    })();
  }
  /** SYNCHRONOUS — must be called with no await between the tap and here. */
  function payViaCheckoutWallet(ship, msg, reset){
    if (!CO_PR || CO_PR_CAN === undefined) {
      // No PaymentRequest yet, or the canMakePayment probe is still running —
      // either way "tap again", never a false "not available".
      warmCheckoutWallet();
      coNote(msg, 'One second — payment is warming up. Tap Place order again.');
      reset(); return;
    }
    if (!CO_PR_CAN) {
      coNote(msg, esc(F.label || 'That wallet') + ' is not available on this device — use card or another method.');
      reset(); return;
    }
    try { CO_PR.update({ total: { label: '${process.env.SITE_NAME || ''}', amount: Math.max(1, LAST_TOTAL) } }); } catch (e) {}
    CO_PENDING = { ship: ship, msg: msg, reset: reset };
    wlog('checkout:show');
    try { CO_PR.show(); } catch (e) {
      wlog('checkout:show-error:' + String(e && e.message || e).slice(0, 60));
      CO_PENDING = null;
      coNote(msg, e.message || 'Could not open the wallet — use card or another method.');
      reset();
    }
  }

  function shipFieldsFrom(scope){
    function v(id){ var n = scope.querySelector(id); return n && n.value ? n.value.trim() : ''; }
    var a = { name: v('#co-name'), line1: v('#co-line1'), city: v('#co-city'), country: v('#co-country').toUpperCase() };
    var l2 = v('#co-line2'); if (l2) a.line2 = l2;
    var rg = v('#co-region'); if (rg) a.region = rg;
    var pc = v('#co-postal'); if (pc) a.postalCode = pc;
    var ph = v('#co-phone'); if (ph) a.phone = ph;
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
      var hint = scope.querySelector('#co-ship-hint');
      if (hint) hint.remove();
      // The section header carries the chosen method, so a collapsed glance
      // down the form reads like a receipt rather than four open questions.
      var chosen = (out.rates || []).filter(function(r){ return r.id === out.selected; })[0];
      var shipSec = scope.querySelector('[data-co-sec="3"]');
      if (shipSec) {
        shipSec.classList.add('is-done');
        var st = shipSec.querySelector('.co-sec__status');
        if (st && chosen) st.textContent = chosen.name + ' · ' + (chosen.amount > 0 ? fmt(chosen.amount) : 'Free');
      }
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
    // Warm the wallet PaymentRequest NOW, so a later "Place order" tap can call
    // show() synchronously — see payViaCheckoutWallet on why that matters.
    warmCheckoutWallet();
    // Resolve the settle rail (stripe vs woopay) early so place-order never has
    // to guess it.
    resolveRail();
    var back = scope.querySelector('#co-back');
    if (back) back.addEventListener('click', function(){ toCart(true); });
    scope.querySelectorAll('.co-mopt').forEach(function(b){
      b.addEventListener('click', function(){
        F = { id: b.getAttribute('data-method'), provider: b.dataset.p, label: b.dataset.l };
        scope.querySelectorAll('.co-mopt').forEach(function(x){ x.classList.toggle('on', x === b); });
      });
    });
    // Choosing a group re-renders the payment step so its own methods show.
    // F is cleared first: keeping a card selected while the Wallets tile is
    // open is how someone ends up paying by a method they can no longer see.
    if (G === 'card') mountCard(scope);
    scope.querySelectorAll('[data-mgroup]').forEach(function(b){
      b.addEventListener('click', function(){
        if (b.disabled || G === b.getAttribute('data-mgroup')) return;
        G = b.getAttribute('data-mgroup');
        F = {};
        // The old field belongs to the old group's provider; leaving it
        // mounted would tokenise a card the shopper is no longer paying with.
        CARD_EL = null;
        toPay(true);
      });
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
      var phone = fieldVal('#co-phone'); if (phone) ship.phone = phone;
      // Checked here so the shopper gets the message next to the button rather
      // than a 422 after the order attempt. The server validates it too.
      var missing = [];
      var coEmail = fieldVal('#co-email');
      if (!coEmail || !/.+@.+\..+/.test(coEmail)) missing.push('email for your receipt');
      if (!ship.name) missing.push('name');
      if (!ship.line1) missing.push('street address');
      if (!ship.city) missing.push('city');
      if (ship.country.length !== 2) missing.push('2-letter country code');
      // US needs state + ZIP: Klarna, Affirm, Afterpay and Cash App all REQUIRE
      // a postal code (and Stripe wants the state), and refuse the charge without
      // one — so demand it here rather than let the method fail at redirect.
      if (ship.country === 'US') {
        if (!ship.region) missing.push('state');
        if (!ship.postalCode) missing.push('ZIP code');
      }
      if (missing.length) {
        coNote(msg, 'Add your ' + missing.join(', ') + '.');
        return;
      }
      if (!F.id) {
        coNote(msg, 'Choose a payment method.');
        return;
      }
      place.disabled = true; place.textContent = 'Placing…';

      // Stripe wallet (Apple Pay / Google Pay / Link): hand off to the native
      // sheet SYNCHRONOUSLY — before the identity await below, or iOS refuses
      // the sheet (gesture law; same bug the buy box shipped). The callback
      // posts identity itself, then authorises, writes and charges — nothing
      // below runs, so a dismissed sheet leaves no unpaid order.
      if (!CARD_EL && F.provider === 'stripe' && WALLET_IDS[F.id]) {
        // The wallet sheet (and Apple Pay) charges LAST_TOTAL. If shipping+tax
        // have not priced yet, that is the bare item subtotal — the shopper
        // would approve less than the server charges. Quote first, then let
        // them tap again so show() runs synchronously with the correct amount.
        if (!SHIP_QUOTED) {
          await quoteShipping(scope);
          coNote(msg, 'One second — finalizing your total. Tap Place order again.');
          reset();
          return;
        }
        payViaCheckoutWallet(ship, msg, reset);
        return;
      }

      // 'card' NEEDS the mounted card field. mountCard swallows its failures
      // (slow SDK, blocked script), and with CARD_EL null the old flow fell
      // through to the redirect branch below — which cannot settle a card, so
      // the shopper got a dead-end 422 AND a stranded pending order holding
      // stock (the Aug 15 jersey checkout). Retry the mount once, then stop
      // BEFORE any order is created.
      if (F.id === 'card' && !CARD_EL) {
        try { await mountCard(scope); } catch (x) {}
        if (!CARD_EL) {
          reset();
          coNote(msg, 'The secure card field could not load. Refresh the page and try again, or pick another payment method.');
          return;
        }
      }

      try {
        if (email) await api('/cart/identity', { method:'POST', body: JSON.stringify({ cartToken: tok(), email: email }) });

        // A CARD TOKEN IS TAKEN BEFORE THE ORDER IS WRITTEN.
        // Same ordering as the quick checkout, for the same reason: a shopper
        // who abandons the payment sheet should not leave a real order behind.
        // Make sure the rail is known before deciding how to settle — a fast tap
        // must not fall through to the direct-Stripe path when the flag is woopay.
        await resolveRail();

        // WooPayments confirms the card at SETTLE (from a client_secret), not by
        // tokenising here — so only tokenise on the Stripe/Square rail.
        var token = null;
        if (CARD_EL && CARD_RAIL !== 'woopay') {
          var tk = await tokenizeCard();
          if (tk === 'cancelled') { reset(); return; }
          token = tk;
        }

        // Fail-safe: a card with no token can neither redirect nor settle —
        // stop before the order exists rather than after. (WooPayments card has
        // no token by design; it is settled by the woopay branch below.)
        if (F.id === 'card' && !token && CARD_RAIL !== 'woopay') { throw new Error('The card could not be processed. Refresh the page and try again.'); }

        var out = await api('/cart/checkout', { method:'POST', body: JSON.stringify({ cartToken: tok(), method: F.id, provider: F.provider, shipAddress: ship }) });
        // orderNumber, NOT number. cartService.checkout returns
        // {orderId, orderNumber, accessToken, total} — reading .number gave
        // undefined, so every completed order redirected to a receipt URL of
        // "?order=undefined" and the shopper saw a not-found page for an order
        // they had just placed.
        var num = out.orderNumber, tokn = out.accessToken;

        // SETTLE IT. /cart/checkout only CREATES the order — it takes no
        // money and returns no redirect, so the old code cleared the cart and
        // jumped to the receipt for an order nobody had paid for.
        if (CARD_RAIL === 'woopay' && (F.id === 'card' || BNPL_IDS[F.id])) {
          // WooPayments rail: create the intent server-side, confirm in-page.
          // Card + Link resolve here; BNPL (Klarna/Affirm/Afterpay/Cash App)
          // confirms then navigates out and returns via /checkout/return, so the
          // showDone below only runs for the in-page card path.
          var wr = await settleWoopay(num, tokn, F.id, { cardEl: CARD_EL }, ship, email);
          if (wr === 'cancelled') { reset(); return; }
        } else if (token) {
          await api('/shop/checkout/pay-token', { method:'POST', body: JSON.stringify({
            orderNumber: num, accessToken: tokn, provider: PAY_PROVIDER, token: token }) });
        } else if (F.id !== 'card' && (F.provider === 'paypal' || F.provider === 'stripe')) {
          // PayPal/Venmo/Credit AND Stripe's redirect methods (Klarna, Affirm,
          // Afterpay, Cash App, ACH) settle the same way: the server starts the
          // intent, the provider returns an approval URL, we send the shopper
          // there, and /checkout/return finalizes. Without this branch these
          // methods created an order and showed success WITHOUT charging.
          // 'card' is EXCLUDED explicitly: a card with no token must never
          // reach redirect-start (it 422s and strands a pending order).
          var started = await api('/shop/checkout/redirect-start', { method:'POST', body: JSON.stringify({
            orderNumber: num, accessToken: tokn, provider: F.provider, method: F.id }) });
          if (started.redirectUrl) { setTok(null); refreshCount(); location.href = started.redirectUrl; return; }
          throw new Error((F.label || 'That method') + ' did not return an approval link. Try another method.');
        } else {
          // No settle branch matched (e.g. a Square-resolved wallet/BNPL). The
          // order was created but NOT charged — never fall through to the
          // success screen. Fail loud so the shopper picks another method.
          throw new Error((F.label || 'That method') + ' is not available for checkout yet — please choose another method.');
        }

        // Capture the receipt from the rail BEFORE clearing the cart. setTok +
        // refreshCount re-render the rail against the now-empty cart, so by the
        // time showDone read co-rail-items/co-total they were blank — which is
        // why the success screen's order-review box came up empty.
        var doneItems = el('co-rail-items') ? el('co-rail-items').innerHTML : '';
        var doneTotal = el('co-total') ? (el('co-total').textContent || '').trim() : '';
        setTok(null); refreshCount();
        showDone(num, tokn, doneItems, doneTotal);
      } catch (e) {
        reset();
        coNote(msg, e.message);
      }
      function reset(){
        place.disabled = false; place.textContent = 'Place order';
        setCta('Place order', function(){ place.click(); }, false);
      }
    });
  }

  // Success, in place: a processing beat, then the order review the rail was
  // already showing, the order number to keep, and a link straight to it.
  function showDone(num, tokn, itemsArg, totalArg){
    var done = el('co-done');
    if (!done) { location.href = '/order-received/?order=' + encodeURIComponent(num) + '&token=' + encodeURIComponent(tokn || ''); return; }
    var email = (el('co-email') || {}).value || '';
    var panel = document.querySelector('.co-panel'), back = el('co-back');
    if (panel) panel.style.display = 'none';
    if (back) back.style.display = 'none';
    // EVERY .co-summary, not just the first: on mobile the bar is reparented to
    // <body>, and it was surviving on the success screen — scrolling over the
    // footer. The th-co-done body class force-hides it from CSS as a backstop
    // against any later re-render setting display back.
    document.querySelectorAll('.co-summary').forEach(function(s){ s.style.display = 'none'; });
    document.body.classList.add('th-co-done');
    done.hidden = false;
    // The purchase consumed the cart. Refresh the header so its badge and drawer
    // stop showing the bought items (a lingering "second cart" behind the
    // receipt), and close the drawer if it is open so nothing overlaps.
    try {
      window.dispatchEvent(new CustomEvent('therum:cart-changed'));
      if (window.__thCartClose) window.__thCartClose();
      document.documentElement.classList.remove('th-cart-open');
      document.body.classList.remove('th-cart-open', 'th-cart-over');
    } catch (e) {}
    try { done.scrollIntoView({ block: 'start' }); } catch (e) {}
    // Prefer the receipt captured before the cart was cleared; fall back to the
    // rail if this was ever called without it.
    var items = itemsArg ? itemsArg : (el('co-rail-items') ? el('co-rail-items').innerHTML : '');
    var total = totalArg ? totalArg : (el('co-total') ? (el('co-total').textContent || '').trim() : '');
    setTimeout(function(){
      var sp = el('co-done-spinner'); if (sp) sp.hidden = true;
      var pr = el('co-done-processing'); if (pr) pr.hidden = true;
      var sum = el('co-done-summary');
      if (sum) sum.innerHTML = '<div class="co-done__items">' + items + '</div>'
        + (total ? '<div class="co-done__total"><span>Total paid</span><span>' + esc(total) + '</span></div>' : '');
      var ref = el('co-done-ref'); if (ref) ref.textContent = 'Order ' + num + (email ? ' · ' + email : '');
      var link = el('co-done-link');
      if (link) link.href = '/order-received/?order=' + encodeURIComponent(num) + '&token=' + encodeURIComponent(tokn || '');
      var body = el('co-done-body'); if (body) body.hidden = false;
    }, 1500);
    var more = el('co-done-more'); if (more) more.onclick = function(){ location.href = '/'; };
  }

  /** The pay step's "Your bag": the SAME editable lines as the cart step —
   *  stepper and a × on every row — so nobody has to leave checkout to change
   *  their mind about an item. Edits PATCH the cart, then refresh the bag, the
   *  rail, the summary and (if an address is in) the shipping quote — the form
   *  fields are never re-rendered, so nothing typed is lost. */
  function renderBag(t){
    var bag = el('co-step-cart');
    if (!bag) return;
    if (!t.lines.length) { bag.innerHTML = empty(); return; }
    bag.innerHTML = t.lines.map(lineRow).join('');
    bag.querySelectorAll('[data-inc],[data-dec],[data-rm]').forEach(function(b){
      b.addEventListener('click', async function(){
        var vid = b.dataset.inc || b.dataset.dec || b.dataset.rm;
        var line = t.lines.find(function(x){ return x.variantId === vid; });
        if (!line) return;
        var q = b.dataset.inc ? line.quantity + 1 : b.dataset.dec ? line.quantity - 1 : 0;
        try {
          var r = await api('/cart/items/' + vid, { method:'PATCH', body: JSON.stringify({ cartToken: tok(), quantity: q }) });
          try { window.dispatchEvent(new CustomEvent('therum:cart-changed')); } catch (x) {}
          refreshCount();
          setSummary(r.totals, 'pay');
          renderBag(r.totals);
          var scope = el('co-step-pay');
          if (scope) quoteShipping(scope);   // no-op until the address is complete
        } catch (e) { alert(e.message); }
      });
    });
  }

  async function toPay(push){
    var step = el('co-step-pay');
    if (!step) return;
    step.innerHTML = await payMarkup();
    // Section 1 stays open on the pay step, now carrying the editable lines.
    var c = await load();
    if (c && c.totals.lines.length) { renderBag(c.totals); el('co-step-cart').classList.add('on'); }
    else el('co-step-cart').classList.remove('on');
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
  var BAR_HOME = null; // marker at the bar's original spot, so it can go back
  function reparentBar(){
    var bar = document.querySelector('.co-summary');
    if (bar) {
      var mobile = window.matchMedia('(max-width: 767px)').matches;
      if (mobile && bar.parentNode !== document.body) {
        // Leave a marker so the move is reversible — rotating a big phone to
        // landscape crosses 767px, and a bar stranded on <body> under desktop
        // rules ends up a sticky column parked after the footer.
        if (!BAR_HOME) { BAR_HOME = document.createComment('co-summary-home'); bar.parentNode.insertBefore(BAR_HOME, bar); }
        document.body.appendChild(bar);
      } else if (!mobile && bar.parentNode === document.body && BAR_HOME && BAR_HOME.parentNode) {
        BAR_HOME.parentNode.insertBefore(bar, BAR_HOME.nextSibling);
      }
    }
    // The quick-buy sheet is position:fixed too — inside the ported shell's
    // transformed #brx-content it pins to the DOCUMENT bottom instead of the
    // viewport, so on mobile "Quick buy" added to the cart and visibly opened
    // nothing. Same escape the summary bar and the cart drawer use: body.
    // Unconditional — the containing-block trap exists at every width.
    var quick = el('co-quick');
    if (quick && quick.parentNode !== document.body) document.body.appendChild(quick);
  }

  function boot(){
    // BEFORE the co-flow guard: shop pages carry the quick-buy sheet but no
    // checkout flow, and the sheet still needs its escape from the shell.
    reparentBar();
    if (!el('co-flow')) return;
    // Marks the focused checkout/cart flow so its CSS (e.g. dropping the site
    // footer on mobile) applies only here, never on ordinary pages.
    document.documentElement.classList.add('th-co-active');
    reparentBar();
    window.addEventListener('resize', reparentBar);
    // /checkout deep-links straight to the payment step; /cart starts on items.
    if (location.pathname.indexOf('/checkout') === 0) { history.replaceState({ co:'pay' }, '', location.pathname); toPay(false); }
    else { history.replaceState({ co:'cart' }, '', location.pathname); renderCart(); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
`;

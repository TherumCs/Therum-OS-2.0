# Counter — 2.0 native commerce engine (the big one)

2026-07-23. Direction: "a WooCommerce replica in theory almost 1:1, but ours is
faster/smarter — same logic, better core." Source of truth: the real 1.x plugin at
`Therum OS/wordpress plugins/counter/` (253 PHP files; readme.txt is the product spec,
PSPGateway.php + PaymentIntent/WebhookEvent the payment contract, Services/ the feature
map: Cart, Checkout, Coupon, Refund, Reports, WooOrderMirror, bridges to
Nexus/Milieus/Cluster). Payments doctrine: NO CHECKS EVER; multi-gateway
(Whop/Braintree/Stripe/Square first-class); bank/ACH, P2P (Cash App via Square, Venmo
via Braintree/PayPal), BNPL (Zip/Sezzle), crypto wanted. See memory
therum-payments-doctrine.

## What 2.0 already has (don't rebuild)
Products/variants + inventory reservation state machine, orders + transitions,
customers/addresses, HMAC payment webhook receiver (generic), CSV import, Milieus
member discounts inside order create, admin Products/Orders pages, Nexus vault.

## The gap = this epic
Everything between "an order row exists" and "a customer paid for it on a page":
gateway layer, cart/checkout session, coupons, public storefront, refunds, receipts.

## Architecture decisions
- **Gateway contract ported 1:1** from 1.x PSPGateway: `id / displayName /
  supports(capability) / createIntent(order) → PaymentIntent / refund(order, amount,
  idempotencyKey) → refundId / verifyWebhook(raw, headers) / parseEvent(verified) →
  WebhookEvent`. Canonical event kinds: payment.succeeded/failed/refunded,
  refund.succeeded/failed, dispute.opened/lost/won. Webhook replay deduped on
  UNIQUE(provider, provider_event_id) ledger (1.x rule, provisions doc).
- **Credentials come from Nexus** (connectionService) — a gateway is "available,
  setup required" until its provider is connected; connect → it lights up. No
  Counter-side key storage (2.0 simplification; 1.x allowed both).
- **Unified cart/checkout session** (1.x's core differentiator): ONE state container,
  Redis-backed, created lazily on first add-to-cart. Guest receipts via
  `Order.accessToken` (provisions: 32-hex, hash_equals) — `/order-received?order=N&
  token=…` works for guests, no account needed.
- **`/checkout/return` endpoint** — the endpoint 1.x's redirect gateways
  (Zip/Sezzle/Crypto) build URLs to but which was NEVER REGISTERED in 1.x (provisions
  doc's own TODO). 2.0 ships it from day one: finalize → verify with provider →
  redirect to receipt with access token.
- **Storefront = server-rendered Fastify routes** (Folio's render pattern), tokened
  via shared therum-tokens.css — NOT a fourth Node app. /shop, /product/:slug, /cart,
  /checkout, /order-received. nginx bare-/ flips from redirect-to-admin to storefront
  when ready.
- **No checks. Ever.** Enforced at the catalog level — no check/eCheck gateway will
  exist to enable.

## Milestones
- **C1 — Gateway layer (start now):** PaymentGateway interface + DTOs, payment_events
  ledger + Refund model (+ Order.accessToken, refundedTotal), gateway registry
  resolving credentials from Nexus, MockGateway (full contract, for tests), Stripe
  provider (PaymentIntents create + webhook verify/parse + refunds), routes:
  POST /api/checkout/intent, POST /api/webhooks/psp/:provider, GET /checkout/return,
  refund route (admin, bundle-gated). Order state wiring: intent→paid via canonical
  events (replay-safe), partial/full refunds with restock rule.
- **C2 — Cart/checkout session:** session container (Redis), add/update/remove,
  totals pipeline (items → Milieus discount → coupon hook → shipping/tax provider
  stubs → grand total), lazy session creation, checkout draft-order handoff to C1.
- **C3 — Coupons:** CouponService port (codes, percent/fixed, expiry, usage limits,
  stacking-with-Milieus rule: best single discount wins — doctrine).
- **C4 — Storefront:** the five public surfaces, server-rendered, tokened; nginx
  takeover of bare /.
- **C5 — Provider fleet:** Square (Cash App Pay), Braintree (cards+PayPal+Venmo),
  Whop, PayPal, Zip + Sezzle ports (redirect path via C1's return endpoint), Plaid
  (ACH), Zelle, Crypto. Each = small standalone module against the C1 contract.
- **C6 — Money ops & polish:** refunds admin UI, receipt emails via notification
  service, Reports port (revenue/orders/top products), Woo import (from export files)
  as follow-up.

## Tests per milestone
C1: mock-gateway full lifecycle (intent→succeed→partial refund→full refund→restock),
webhook replay dedup, forged signature 401, unknown-kind ignored, return-endpoint
finalization, Nexus-credential gating (gateway unavailable until connected),
bundle/capability gates. Later milestones follow the same pattern.

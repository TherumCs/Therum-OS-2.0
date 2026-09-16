import type { OrderStatus } from '@prisma/client';
import { db } from '../lib/db.js';
import { routeOrder } from '../counter/fulfillmentRouting.js';
import { decryptSecret } from '../lib/crypto.js';
import { logger } from '../lib/logger.js';

// Fulfillment reliability — "every connected vendor actually gets its orders."
//
// Two delivery models coexist:
//   PUSH  (printful/printify/contrado): the store calls their Orders API. The
//         store OWNS delivery here — a missing/failed route is the store's bug,
//         and is retried.
//   PULL  (tapstitch/podpluser/gelato/… — store-pull-woo): the partner polls
//         the store's /wc/v3/orders and fulfills on their side. The store cannot
//         force a poll, but it CAN tell whether the partner has polled since the
//         order was placed — a partner that has gone quiet (PodPluser) is the
//         silent-stall this catches.
//   SELF  (no provider, no vendor): the operator fulfills it (e.g. Counter
//         jerseys). Never "stuck".
//
// auditAll() classifies every paid order's lines; retryStuckPushes() re-drives
// the push failures; sweep() runs both and logs a summary the worker/health can
// surface, so a stall becomes an alert instead of a customer noticing.

const PUSH_PROVIDERS = new Set(['printful', 'printify', 'contrado']);
const PAID = ['processing', 'shipped', 'delivered'] as unknown as OrderStatus[];

export type LineKind = 'push' | 'pull' | 'self';
export type LineState = 'ok' | 'stuck' | 'pending';
export interface LineReport {
  orderNumber: string;
  orderId: string;
  createdAt: Date;
  product: string;
  target: string; // provider or vendor name
  kind: LineKind;
  state: LineState;
  detail: string;
}

// Whether the store actually got each paid order OUT to its pull/webhook
// partners. The store's job for a pull partner is: fire the order webhook and
// have the partner's endpoint accept it (HTTP 2xx), and/or expose it on the
// /orders pull. It CANNOT observe whether the partner then prints — a partner
// ACKs with 200 and fulfils nothing if the payload is unmatchable (the wooId
// bug). So this measures delivery, and "delivered but not printed" is closed by
// sending the ids the partner mapped (product wooId), not by this check.
//
// Returns per-order: delivered = at least one order.* webhook 2xx; failed =
// a delivery exists but none succeeded.
//
// One company, several names/domains — the vendor ROW name and the webhook URL
// host often differ. Tapstitch's backend is HugePOD (api.service.hugepod.com),
// so a Tapstitch vendor row must match a hugepod hook. ALIASES maps known
// backend domains to the merchant-facing brand; registrable-domain extraction
// (below) also handles multi-level TLDs (api.podpartner.com.cn -> "podpartner",
// not "com") which the naive second-label split got wrong.
const BRAND_ALIASES: Record<string, string> = { hugepod: 'tapstitch' };
function normBrand(b: string): string { return BRAND_ALIASES[b] ?? b; }
// Brand token of a vendor NAME: first alnum word, aliased.
function brand(s: string | null | undefined): string {
  return normBrand(String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ')[0] ?? '');
}
// Brand token of a webhook URL: the registrable-domain label, aliased. Strips
// the public-suffix tail (handles .com, .co.uk, .com.cn, .com.au).
function hookBrand(url: string | null | undefined): string {
  try {
    const host = new URL(String(url)).hostname.toLowerCase();
    const parts = host.split('.').filter(Boolean);
    if (parts.length < 2) return normBrand(parts[0] ?? '');
    const secondLevelTlds = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac']);
    // If the second-to-last label is itself a public-suffix stub (com.cn),
    // the brand is one label further left.
    const idx = secondLevelTlds.has(parts[parts.length - 2] ?? '') ? parts.length - 3 : parts.length - 2;
    return normBrand(parts[Math.max(0, idx)] ?? '');
  } catch { return brand(url); }
}

// PER-(order, vendor) genuine acceptance from the LATEST attempt — NOT per-order,
// and NOT an OR over history. One vendor's genuine 200 must not mask another
// vendor's failure on the same order, and a stale pre-capture 200 must not mask
// the current rejection.
async function orderDeliveryStatus(orderIds: string[]): Promise<Map<string, { delivered: boolean; detail?: string }>> {
  const out = new Map<string, { delivered: boolean; detail?: string }>();
  if (!orderIds.length) return out;
  const hooks = await db.storeWebhook.findMany({ select: { id: true, deliveryUrl: true, name: true } });
  const hookBrandById = new Map(hooks.map((h) => [h.id, hookBrand(h.deliveryUrl) || brand(h.name)]));
  const rows = await db.webhookDelivery.findMany({
    where: { resourceId: { in: orderIds }, topic: { startsWith: 'order.' } },
    orderBy: { createdAt: 'desc' },
    select: { resourceId: true, webhookId: true, genuine: true, responseCode: true, responseBody: true },
  });
  for (const r of rows) {
    const key = `${r.resourceId}:${hookBrandById.get(r.webhookId) ?? 'vendor'}`;
    if (out.has(key)) continue; // only the newest attempt per (order, vendor)
    const ok = r.genuine === true || (r.genuine === null && (r.responseCode ?? 0) >= 200 && (r.responseCode ?? 0) < 300);
    out.set(key, ok ? { delivered: true } : { delivered: false, detail: (r.responseBody ?? '').slice(0, 80) });
  }
  return out;
}

// Verification at the VENDOR layer — the audit that actually catches "the store
// thinks it routed, the factory never got it". For push vendors we hold the
// token, so we can query THEIR backend and confirm the order is present by its
// external_id (our order number). `ok:false` means the query itself failed, so
// callers must NOT read an empty set as "order absent" (that would false-alarm
// every order whenever the vendor API blips).
async function pushBackendOrders(): Promise<{ printful: { ok: boolean; ids: Set<string> }; printify: { ok: boolean; ids: Set<string> } }> {
  const out = { printful: { ok: false, ids: new Set<string>() }, printify: { ok: false, ids: new Set<string>() } };
  const cons = await db.connection.findMany({ where: { category: 'fulfillment' }, select: { provider: true, credentialEncrypted: true } });
  const cred: Record<string, string | null> = {};
  for (const c of cons) { try { cred[c.provider] = decryptSecret(c.credentialEncrypted); } catch { cred[c.provider] = null; } }
  if (cred.printful) {
    const [t, s] = cred.printful.split('|');
    try {
      const r = await fetch('https://api.printful.com/orders?limit=100', { headers: { Authorization: `Bearer ${t}`, ...(s ? { 'X-PF-Store-Id': s } : {}) }, signal: AbortSignal.timeout(15000) });
      if (r.ok) { const j = (await r.json()) as { result?: { external_id?: string | null }[] }; for (const o of j.result ?? []) if (o.external_id) out.printful.ids.add(o.external_id); out.printful.ok = true; }
    } catch { /* ok stays false */ }
  }
  if (cred.printify) {
    const [t, s] = cred.printify.split('|');
    // Printify default page size is 10 — paginate so recent-but-not-newest
    // orders aren't falsely flagged missing. Cap at 5 pages (500 orders).
    try {
      let page = 1, ok = false;
      for (; page <= 5; page++) {
        const r = await fetch(`https://api.printify.com/v1/shops/${s}/orders.json?limit=100&page=${page}`, { headers: { Authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(15000) });
        if (!r.ok) break;
        ok = true;
        const j = (await r.json()) as { data?: { external_id?: string | null; metadata?: { order_number?: string } }[] };
        const rows = j.data ?? [];
        for (const o of rows) { const ext = o.metadata?.order_number ?? o.external_id; if (ext) out.printify.ids.add(String(ext)); }
        if (rows.length < 100) break;
      }
      out.printify.ok = ok;
    } catch { /* ok stays false */ }
  }
  return out;
}

export const fulfillmentAudit = {
  /**
   * Confirm each paid order line is ACTUALLY on its vendor's backend — verified
   * against the vendor's own API for push vendors. `missingPush` is the alarm
   * that matters: the store recorded a route but the factory has no such order.
   * Pull vendors (no token) can never be confirmed from here → `unverifiablePull`.
   */
  async reconcile(): Promise<{ verified: number; missingPush: { order: string; provider: string }[]; unknownPush: number; unverifiablePull: { order: string; vendor: string }[]; self: number }> {
    const backend = await pushBackendOrders();
    // Bound to what the vendor's order list can actually still contain: recent
    // orders only, and never the imported WP history (sourceId set — those were
    // fulfilled on the OLD store and were never pushed through this system, so
    // they'd flag as missingPush forever and drown the real signal).
    const orders = await db.order.findMany({
      where: { status: { in: PAID }, createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }, sourceId: null },
      select: { number: true, items: { select: { variant: { select: { product: { select: { fulfillmentProvider: true, vendorId: true, vendor: { select: { name: true } } } } } } } } },
    });
    let verified = 0, unknownPush = 0, self = 0;
    const missingPush: { order: string; provider: string }[] = [];
    const unverifiablePull: { order: string; vendor: string }[] = [];
    for (const o of orders) for (const it of o.items) {
      const p = it.variant?.product;
      if (!p) continue;
      const prov = p.fulfillmentProvider;
      if (prov === 'printful' || prov === 'printify') {
        const b = backend[prov];
        if (!b.ok) unknownPush++;               // vendor API unreachable — cannot judge
        else if (b.ids.has(o.number)) verified++;
        else missingPush.push({ order: o.number, provider: prov });
      } else if (p.vendorId || prov) {
        unverifiablePull.push({ order: o.number, vendor: p.vendor?.name ?? prov ?? 'vendor' });
      } else self++;
    }
    if (missingPush.length) logger.error({ missingPush }, 'RECONCILE: paid lines NOT on the push-vendor backend — store routed but factory has no order');
    return { verified, missingPush, unknownPush, unverifiablePull, self };
  },

  async auditAll(): Promise<LineReport[]> {
    const orders = await db.order.findMany({
      where: { status: { in: PAID } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, number: true, createdAt: true,
        items: { select: { variant: { select: { sourceId: true, product: { select: { name: true, fulfillmentProvider: true, vendorId: true, vendor: { select: { name: true } } } } } } } },
      },
    });
    const orderIds = orders.map((o) => o.id);
    const routes = orderIds.length
      ? await db.fulfillmentRoute.findMany({ where: { orderId: { in: orderIds } }, select: { orderId: true, provider: true, ok: true, error: true } })
      : [];
    const routeOk = new Set(routes.filter((r) => r.ok).map((r) => `${r.orderId}:${r.provider}`));
    const routeErr = new Map(routes.filter((r) => !r.ok).map((r) => [`${r.orderId}:${r.provider}`, r.error ?? 'failed']));
    const delivery = await orderDeliveryStatus(orderIds);

    const out: LineReport[] = [];
    for (const o of orders) {
      for (const it of o.items) {
        const p = it.variant?.product;
        if (!p) continue;
        const base = { orderNumber: o.number, orderId: o.id, createdAt: o.createdAt, product: p.name };
        const provider = p.fulfillmentProvider;
        if (provider && PUSH_PROVIDERS.has(provider)) {
          const key = `${o.id}:${provider}`;
          if (routeOk.has(key)) out.push({ ...base, target: provider, kind: 'push', state: 'ok', detail: 'pushed' });
          else if (!it.variant?.sourceId) out.push({ ...base, target: provider, kind: 'push', state: 'stuck', detail: 'variant has no provider sourceId — cannot push' });
          else if (routeErr.has(key)) out.push({ ...base, target: provider, kind: 'push', state: 'stuck', detail: `push failed: ${routeErr.get(key)}` });
          else out.push({ ...base, target: provider, kind: 'push', state: 'stuck', detail: 'never routed' });
        } else if ((p.vendorId && p.vendor) || provider) {
          // PULL/WEBHOOK partner: the store fires the order webhook and/or
          // exposes the order on /orders. "delivered" = the partner's endpoint
          // accepted it (2xx) or (no webhook sub) it is available to pull.
          const targetName = p.vendor?.name ?? provider ?? 'vendor';
          const d = delivery.get(`${o.id}:${brand(targetName)}`);
          if (d?.delivered) out.push({ ...base, target: targetName, kind: 'pull', state: 'ok', detail: 'partner genuinely accepted the order webhook' });
          else if (d) out.push({ ...base, target: targetName, kind: 'pull', state: 'stuck', detail: `partner rejected the webhook: ${d.detail || 'error body'}` });
          else out.push({ ...base, target: targetName, kind: 'pull', state: 'ok', detail: 'exposed to partner on /orders pull (no webhook)' });
        } else {
          out.push({ ...base, target: 'self', kind: 'self', state: 'ok', detail: 'self-fulfilled' });
        }
      }
    }
    return out;
  },

  /** For the worker/health: a compact summary of what is NOT ok. */
  async sweep(): Promise<{ stuckPush: number; stuckPull: number; failingPartners: string[]; total: number }> {
    const report = await this.auditAll();
    const stuckPush = report.filter((r) => r.kind === 'push' && r.state === 'stuck').length;
    const stuckPull = report.filter((r) => r.kind === 'pull' && r.state === 'stuck');
    const failingPartners = [...new Set(stuckPull.map((r) => r.target))];
    if (stuckPush || stuckPull.length) {
      logger.warn({ stuckPush, stuckPull: stuckPull.length, failingPartners }, 'fulfillment audit: undelivered vendor lines');
    }
    return { stuckPush, stuckPull: stuckPull.length, failingPartners, total: report.length };
  },

  /**
   * Self-healing retry for PUSH vendors (Printful/Printify/Contrado). A paid
   * order whose latest push route is ok:false (a transient blip at the paid
   * edge — Printful confirm timeout, Printify produce 500) is re-submitted via
   * submitPaidOrder, which is DUP-SAFE (skips a provider that already has a real
   * vendor order id). This is the retry the docs promised but no code did — the
   * old retryStuckPushes had zero callers and used the wrong (checkout) path.
   * Bounded: processing orders, last 14 days.
   */
  async retryStuckPushes(): Promise<{ retried: string[] }> {
    const { submitPaidOrder } = await import('../counter/fulfillmentRouting.js');
    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const orders = await db.order.findMany({
      where: { status: 'processing' as OrderStatus, createdAt: { gte: since } },
      select: { id: true, number: true, routes: { select: { provider: true, ok: true, reference: true, createdAt: true }, orderBy: { createdAt: 'desc' } }, items: { select: { variant: { select: { product: { select: { fulfillmentProvider: true } } } } } } },
    });
    const retried: string[] = [];
    // The checkout leaves a draft placeholder route; a real production is a route
    // with ok AND a genuine vendor reference (not this placeholder or empty).
    const DRAFT_REFS = new Set(['deferred-to-payment', '']);
    for (const o of orders) {
      const providers = new Set(o.items.map((i) => i.variant?.product?.fulfillmentProvider).filter((p): p is string => !!p && PUSH_PROVIDERS.has(p)));
      if (!providers.size) continue;
      let stuck = false;
      for (const prov of providers) {
        const provRoutes = o.routes.filter((r) => r.provider === prov);
        // STUCK unless there's a genuine CONFIRMED production route. The old check
        // (`latest && !latest.ok`) skipped a paid order still carrying only its
        // ok:true checkout DRAFT — so a Printful confirm that threw (a known live
        // condition) left the order unprinted forever with every net green (audit
        // R6 CRITICAL). Now: no confirmed-production route ⇒ re-drive it.
        const confirmed = provRoutes.some((r) => r.ok && r.reference != null && !DRAFT_REFS.has(r.reference));
        if (!confirmed) stuck = true;
      }
      if (!stuck) continue;
      const full = await db.order.findUnique({ where: { id: o.id }, include: { items: { include: { variant: { select: { id: true, sku: true, sourceId: true, product: { select: { fulfillmentProvider: true, sourceId: true } } } } } }, customer: { select: { email: true, name: true } } } });
      if (!full) continue;
      try { await submitPaidOrder(full as never); retried.push(o.number); }
      catch (err) { logger.error({ err, order: o.number }, 'retryStuckPushes: submit failed'); }
    }
    if (retried.length) logger.info({ retried }, 'fulfillment: retried stuck push-vendor orders');
    return { retried };
  },

  /**
   * Self-healing redelivery for WEBHOOK vendors only.
   *
   * A webhook is a notification, not an order-create call: partners dedup by
   * order id (a real Woo store re-sends order.updated on every edit), so
   * re-offering an order is safe — unlike push (Printful), which this NEVER
   * touches. The point: a partner that was down, mid-reconnect, or rejecting
   * (PODpartner 2002, Tapstitch pre-registration) starts receiving orders the
   * moment its side comes back, with no human in the loop. A newly registered
   * webhook (e.g. Tapstitch's daily self-registration finally succeeding) gets
   * the backlog on the next hourly run automatically.
   *
   * Bounds: processing orders from the last 14 days, at most one redelivery
   * per order per 6 hours, and only while some active order-hook has not
   * genuinely accepted that order.
   */
  async redeliverStuck(): Promise<{ redelivered: string[]; skipped: number }> {
    const { deliver, isTransient } = await import('../counter/webhookDelivery.js');
    const { orderWebhookPayload } = await import('../counter/orderWebhookPayload.js');
    const SIX_H = 6 * 60 * 60 * 1000;
    // Async-opaque vendors (PodPluser) ACK success/empty-data whether or not they
    // created the order — no create-confirmation, no API — so there is nothing to
    // gate a retry on. Re-push a BOUNDED number of times over a window instead.
    const PODPLUSER_BRAND = hookBrand('https://www.podpluser.com/');
    const ASYNC_MAX_ATTEMPTS = 4;
    const ASYNC_WINDOW_MS = 48 * 60 * 60 * 1000;
    // Split hooks by topic so redelivery re-offers each hook only on ITS topic
    // (an order.updated hook must not receive the action ping and vice-versa).
    const hooks = await db.storeWebhook.findMany({ where: { status: 'active', topic: { in: ['order.updated', 'action.woocommerce_order_status_processing'] } }, select: { id: true, topic: true, deliveryUrl: true } });
    if (!hooks.length) return { redelivered: [], skipped: 0 };
    const hookIds = new Set(hooks.map((h) => h.id));
    const topicOf = new Map(hooks.map((h) => [h.id, h.topic]));
    const brandOf = new Map(hooks.map((h) => [h.id, hookBrand(h.deliveryUrl)]));
    const orders = await db.order.findMany({
      where: { status: 'processing' as OrderStatus, createdAt: { gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) }, wooId: { not: null } },
      include: { customer: { select: { email: true, name: true } }, items: { include: { variant: { select: { id: true, wooId: true, sku: true, color: true, size: true, product: { select: { id: true, wooId: true, name: true, image: true, fulfillmentProvider: true, vendor: { select: { name: true } } } } } } } } },
    });
    const redelivered: string[] = [];
    let skipped = 0;
    for (const o of orders) {
      // Which vendor BRANDS does this order actually contain? A hook is only
      // offered an order that has a line for ITS vendor — otherwise an
      // all-Printful order gets re-offered to Tapstitch forever (Tapstitch
      // no-ops it with {code:200,data:null}, which now correctly reads as
      // not-genuine, so without this scoping it would redeliver endlessly).
      const orderBrands = new Set<string>();
      for (const it of o.items) { const p = it.variant?.product; if (p?.vendor?.name) orderBrands.add(brand(p.vendor.name)); if (p?.fulfillmentProvider) orderBrands.add(brand(p.fulfillmentProvider)); }
      const rows = await db.webhookDelivery.findMany({ where: { resourceId: o.id }, orderBy: { createdAt: 'desc' }, select: { webhookId: true, genuine: true, responseCode: true, responseBody: true, error: true, createdAt: true } });
      const latestPerHook = new Map<string, (typeof rows)[number]>();
      for (const r of rows) if (hookIds.has(r.webhookId) && !latestPerHook.has(r.webhookId)) latestPerHook.set(r.webhookId, r);
      // Decide PER HOOK whether to (re)offer this order to it:
      //  - vendor not in this order -> skip (never offer an order it can't fulfil)
      //  - never tried            -> offer (backlog to a freshly-registered hook)
      //  - last was genuine       -> skip (partner already took it — no spam)
      //  - last was a HARD reject  -> skip (deterministic HTTP reject; needs a human)
      //  - network fail / transient / 6h+ -> offer
      const targetHookIds = new Set<string>();
      for (const hid of hookIds) {
        const hb = brandOf.get(hid) ?? '';
        // A BRANDED hook is only offered an order that actually contains its
        // brand. Dropping the `orderBrands.size &&` guard closes the empty-set
        // hole: a self-fulfilled order (no vendor/provider line) has NO brands,
        // and an empty set must mean "matches no branded hook", not "matches
        // every branded hook" — which re-offered provider-less orders to every
        // vendor (audit). Non-branded hooks (hb === '') still get everything.
        if (hb && !orderBrands.has(hb)) continue;
        const last = latestPerHook.get(hid);
        if (!last) { targetHookIds.add(hid); continue; }
        // Async-opaque vendors (PodPluser): a "genuine" ACK does NOT mean the
        // order was created, so don't let genuine short-circuit the retry. Auto
        // re-push up to ASYNC_MAX_ATTEMPTS within ASYNC_WINDOW_MS (6h cooldown),
        // then stop. Partners dedup by order id, so re-offering a created order
        // is a harmless no-op; an order that missed (transient, or a size/variant
        // the vendor only adds later) gets picked up automatically — no manual push.
        if ((brandOf.get(hid) ?? '') === PODPLUSER_BRAND) {
          const attempts = rows.filter((r) => r.webhookId === hid).length;
          const withinWindow = Date.now() - o.createdAt.getTime() < ASYNC_WINDOW_MS;
          const cooled = Date.now() - (last.createdAt?.getTime() ?? 0) >= SIX_H;
          if (attempts < ASYNC_MAX_ATTEMPTS && withinWindow && cooled) targetHookIds.add(hid);
          continue;
        }
        const genuine = last.genuine === true || (last.genuine === null && (last.responseCode ?? 0) >= 200 && (last.responseCode ?? 0) < 300);
        if (genuine) continue;
        // A row with NO HTTP response (timeout / connection refused) is the
        // partner being DOWN — the #1 thing redelivery exists for. Treat it as
        // transient, not a hard reject.
        const networkFail = last.responseCode == null || /timeout|econn|network|refused|abort|fetch failed/i.test(last.error ?? '');
        const transient = networkFail || isTransient(last.responseCode ?? 0, last.responseBody ?? '');
        const cooled = Date.now() - (last.createdAt?.getTime() ?? 0) >= SIX_H;
        if (transient && cooled) targetHookIds.add(hid);
        // hard reject (real non-transient HTTP response) => leave for a human.
      }
      if (targetHookIds.size === 0) { skipped++; continue; }
      const updatedHooks = new Set([...targetHookIds].filter((h) => topicOf.get(h) === 'order.updated'));
      const actionHooks = new Set([...targetHookIds].filter((h) => topicOf.get(h) === 'action.woocommerce_order_status_processing'));
      if (updatedHooks.size) await deliver({ topic: 'order.updated', resourceId: o.id, payload: orderWebhookPayload(o) }, { onlyHookIds: updatedHooks });
      if (actionHooks.size) await deliver({ topic: 'action.woocommerce_order_status_processing', resourceId: o.id, payload: { action: 'woocommerce_order_status_processing', arg: o.wooId } }, { onlyHookIds: actionHooks });
      redelivered.push(o.number);
    }
    if (redelivered.length) logger.info({ redelivered }, 'fulfillment: re-offered stuck orders to non-accepting webhook vendors');
    return { redelivered, skipped };
  },
};

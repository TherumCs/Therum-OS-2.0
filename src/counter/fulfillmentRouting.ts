import { db } from '../lib/db.js';
import { connectionService } from '../services/connection.service.js';
import { toMajor } from './currency.js';

// Sending an order OUT to whoever prints it.
//
// There are two kinds of fulfilment partner and they need opposite mechanisms:
//
//   PULL partners (Tapstitch, PODpartner, Contrado, Merchize, JetPrint) connect
//   through the WooCommerce bridge and register a webhook. We deliver; that is
//   webhookDelivery.ts, and it is done.
//
//   PUSH partners (Printful, Printify) connect with an API token. They never
//   register anything, because in their model THEY are the client and this
//   store is the shop they read. Nothing tells them an order happened, so the
//   store has to call their Orders API. That is this file.
//
// Routing is per LINE, not per order: a basket can mix a Printful cap with a
// Printify tee, and each has to reach the right factory.

export interface RoutableOrder {
  id: string;
  number: string;
  currency: string;
  shipAddress?: unknown;
  guestEmail?: string | null;
  customer?: { email?: string | null; name?: string | null } | null;
  items: {
    quantity: number;
    priceAtTime: number;
    variant?: {
      sourceId?: string | null;
      sku?: string | null;
      // The provider lives on the PRODUCT, not the variant: sourceVendorId is a
      // foreign key to the marketplace `vendors` table and writing a provider
      // name into it violates the constraint.
      product?: { fulfillmentProvider?: string | null; sourceId?: string | null } | null;
    } | null;
  }[];
}

interface Ship {
  name?: string; line1?: string; line2?: string;
  city?: string; region?: string; postalCode?: string; country?: string;
}

export interface RouteResult {
  provider: string;
  lines: number;
  ok: boolean;
  reference?: string;
  error?: string;
}

/** Group an order's lines by the provider that owns them. */
export function linesByProvider(order: RoutableOrder): Map<string, RoutableOrder['items']> {
  const out = new Map<string, RoutableOrder['items']>();
  for (const item of order.items) {
    const provider = item.variant?.product?.fulfillmentProvider;
    // A line with no provider is a self-fulfilled product. Not an error — it
    // simply is not anyone else's to print.
    if (!provider || !item.variant?.sourceId) continue;
    const list = out.get(provider) ?? [];
    list.push(item);
    out.set(provider, list);
  }
  return out;
}

function recipient(order: RoutableOrder) {
  const a = (order.shipAddress ?? {}) as Ship;
  return {
    name: a.name ?? order.customer?.name ?? '',
    address1: a.line1 ?? '',
    address2: a.line2 ?? '',
    city: a.city ?? '',
    state_code: a.region ?? '',
    zip: a.postalCode ?? '',
    country_code: a.country ?? '',
    email: order.customer?.email ?? order.guestEmail ?? '',
  };
}

/**
 * Enough of an address to print a label.
 *
 * Checked BEFORE calling a provider: a rejected order at Printful is a support
 * ticket, while a refusal here is a row in the log naming the missing field.
 */
export function shippable(order: RoutableOrder): string | null {
  const r = recipient(order);
  const missing = (['address1', 'city', 'country_code'] as const).filter((k) => !r[k]);
  return missing.length ? `missing ${missing.join(', ')}` : null;
}

// ── Timeout recovery (audit C3) ──────────────────────────────────────────────
// A create POST that TIMES OUT after the vendor already created the order is the
// double-production hole: the throw records ok:false with no reference, and the
// hourly retry re-creates a SECOND billable/production order. These look the
// order up by our external_id (order.number) so a timed-out create can recover
// the real id and PRODUCE the existing order instead of re-creating it. Best-
// effort: a null return means "not found / lookup failed", and only then is a
// re-create safe.
// Recovery is a THREE-valued question, and conflating two of the answers was the
// live double-production hole (audit C3): 'found' (produce the existing order),
// 'absent' (confirmed no vendor order — a re-create is safe), and 'unknown' (the
// lookup itself failed / could not be completed — a re-create is NOT safe,
// because the order may exist and we simply couldn't see it). The old code
// returned null for BOTH 'absent' and 'unknown', so a transient Printify API
// error during recovery was read as "not there, go ahead and create" and printed
// a second billable order. Callers must create only on 'absent'.
type RecoverResult = { status: 'found'; id: string } | { status: 'absent' } | { status: 'unknown' };

async function printifyRecover(orderNumber: string): Promise<RecoverResult> {
  const credential = await connectionService.credentialFor('printify');
  if (!credential) return { status: 'unknown' }; // can't verify ⇒ must not assume absent
  const [token, shopId] = credential.split('|');
  if (!shopId) return { status: 'unknown' };
  try {
    for (let page = 1; page <= 5; page++) {
      const r = await fetch(`https://api.printify.com/v1/shops/${shopId}/orders.json?limit=100&page=${page}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
      if (!r.ok) return { status: 'unknown' }; // lookup FAILED — not the same as "not found"
      const j = (await r.json()) as { data?: { id?: string; external_id?: string | null; metadata?: { order_number?: string } }[] };
      const rows = j.data ?? [];
      const hit = rows.find((o) => (o.metadata?.order_number ?? o.external_id) === orderNumber);
      if (hit?.id) return { status: 'found', id: String(hit.id) };
      if (rows.length < 100) return { status: 'absent' }; // reached the end of the list without a hit
    }
    // Scanned the 500 most recent and never reached the end — the order COULD be
    // older/further down, so we genuinely don't know. Not 'absent'.
    return { status: 'unknown' };
  } catch { return { status: 'unknown' }; } // network/timeout — uncertain, never 'absent'
}

// THREE-valued, exactly like printifyRecover (audit C4). The old two-valued
// version returned null for BOTH "confirmed absent" AND "lookup failed", and the
// callers created a confirm=1 (billable, in-production) order on null — so a
// transient Printful API error during recovery printed a SECOND paid order. Now:
// 'found' (confirm/use it), 'absent' (safe to create), 'unknown' (defer, never
// create). Paginates past the first 100 so an older order is not misread as absent.
async function printfulRecover(orderNumber: string): Promise<RecoverResult> {
  const credential = await connectionService.credentialFor('printful');
  if (!credential) return { status: 'unknown' }; // can't verify ⇒ never assume absent
  const [token, storeId] = credential.split('|');
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (storeId) headers['X-PF-Store-Id'] = storeId;
  try {
    for (let offset = 0; offset < 500; offset += 100) {
      const r = await fetch(`https://api.printful.com/orders?limit=100&offset=${offset}`, { headers, signal: AbortSignal.timeout(15_000) });
      if (!r.ok) return { status: 'unknown' }; // lookup FAILED — not the same as "not found"
      const j = (await r.json()) as { result?: { id?: number; external_id?: string | null }[] };
      const rows = j.result ?? [];
      const hit = rows.find((o) => o.external_id === orderNumber);
      if (hit?.id) return { status: 'found', id: String(hit.id) };
      if (rows.length < 100) return { status: 'absent' }; // reached the end of the list
    }
    return { status: 'unknown' }; // scanned the 500 most recent, never reached the end
  } catch { return { status: 'unknown' }; }
}

async function pushPrintful(order: RoutableOrder, items: RoutableOrder['items'], opts?: { confirm?: boolean }): Promise<RouteResult> {
  const credential = await connectionService.credentialFor('printful');
  if (!credential) return { provider: 'printful', lines: items.length, ok: false, error: 'printful is not connected' };
  // "token|storeId" — the same shape the Nexus tester parses. The store id is
  // NOT optional here: a token with access to more than one store is refused
  // with "This endpoint requires `store_id`!", which reads as a malformed
  // request rather than a missing header.
  const [token, storeId] = credential.split('|');

  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };
  if (storeId) headers['X-PF-Store-Id'] = storeId;

  // confirm=1 submits the order straight to production. Set ONLY for orders
  // that are already paid (via the confirm step below). The checkout-time draft
  // leaves it off, so an unpaid or test cart is never printed.
  let res: Response;
  try {
    res = await fetch(`https://api.printful.com/orders${opts?.confirm ? '?confirm=1' : ''}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        // The store's own order number, so a human can match the two systems.
        external_id: order.number,
        recipient: recipient(order),
        items: items.map((i) => ({
          sync_variant_id: Number(i.variant!.sourceId),
          quantity: i.quantity,
          retail_price: String(toMajor(i.priceAtTime, order.currency)),
        })),
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    // Create THREW (timeout/network). On a CONFIRM (paid, confirm=1) the order
    // may already be in production on Printful's side — re-creating it on retry
    // is real-money double production (audit C3). Recover by external_id; if the
    // order exists, return its id ok:true so the retry never re-creates. A draft
    // (confirm off) costs nothing, so a re-draft on retry is harmless.
    if (opts?.confirm) {
      const recovered = await printfulRecover(order.number);
      if (recovered.status === 'found') return { provider: 'printful', lines: items.length, ok: true, reference: recovered.id };
      // 'absent' → the create genuinely didn't land (safe). 'unknown' → uncertain.
      // Either way ok:false with NO reference so the retry re-checks and never
      // blind-re-POSTs confirm=1 (double production).
      return { provider: 'printful', lines: items.length, ok: false, error: `create threw${recovered.status === 'unknown' ? ' (recovery uncertain)' : ''}: ${(err as Error).message.slice(0, 130)}` };
    }
    return { provider: 'printful', lines: items.length, ok: false, error: `create threw: ${(err as Error).message.slice(0, 150)}` };
  }
  const json = (await res.json().catch(() => ({}))) as { result?: { id?: number }; error?: { message?: string } };
  if (!res.ok) {
    return { provider: 'printful', lines: items.length, ok: false, error: json.error?.message ?? `HTTP ${res.status}` };
  }
  // At checkout this is a DRAFT (opts.confirm unset): reviewable, costs nothing,
  // and a test or unpaid cart never prints. The order is submitted to production
  // by confirmPrintfulOrder() once it is actually paid.
  return { provider: 'printful', lines: items.length, ok: true, reference: String(json.result?.id ?? '') };
}

async function pushPrintify(order: RoutableOrder, items: RoutableOrder['items']): Promise<RouteResult> {
  const credential = await connectionService.credentialFor('printify');
  if (!credential) return { provider: 'printify', lines: items.length, ok: false, error: 'printify is not connected' };
  // Printify is per-shop; the shop id is stored alongside the token.
  const [token, shopId] = credential.split('|');
  if (!shopId) return { provider: 'printify', lines: items.length, ok: false, error: 'printify shop id missing from the stored credential' };

  const r = recipient(order);
  let res: Response;
  try {
    res = await fetch(`https://api.printify.com/v1/shops/${shopId}/orders.json`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      external_id: order.number,
      label: order.number,
      line_items: items.map((i) => ({
        // Printify needs the PRODUCT id (the shop product), not the variant id.
        // The old code sent the variant id as BOTH and Printify rejected every
        // order — "Product with id … is missing". product.sourceId holds the
        // Printify product id; variant.sourceId holds the variant id.
        product_id: i.variant!.product!.sourceId,
        variant_id: Number(i.variant!.sourceId),
        quantity: i.quantity,
      })),
      shipping_method: 1,
      send_shipping_notification: false,
      address_to: {
        first_name: (r.name.split(' ')[0] ?? ''),
        last_name: r.name.split(' ').slice(1).join(' '),
        email: r.email,
        country: r.country_code,
        region: r.state_code,
        address1: r.address1,
        address2: r.address2,
        city: r.city,
        zip: r.zip,
      },
    }),
    signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    // Create THREW (timeout/network) — Printify may already have created the
    // order. Re-creating on the hourly retry is real-money double production
    // (audit C3). Recover by external_id; if found, PRODUCE the existing order
    // and return its reference so the retry never re-creates. Only a genuine
    // "not found" makes a re-create safe.
    const recovered = await printifyRecover(order.number);
    if (recovered.status === 'found') return printifyProduce(recovered.id, items.length);
    // 'absent' → the create genuinely didn't land (safe). 'unknown' → we can't
    // tell; either way return ok:false with NO reference so the retry re-checks,
    // and never blind-re-creates on this path.
    return { provider: 'printify', lines: items.length, ok: false, error: `create threw${recovered.status === 'unknown' ? ' (recovery uncertain)' : ''}: ${(err as Error).message.slice(0, 130)}` };
  }
  const json = (await res.json().catch(() => ({}))) as { id?: string; errors?: unknown };
  if (!res.ok) {
    return { provider: 'printify', lines: items.length, ok: false, error: `HTTP ${res.status}` };
  }
  const printifyOrderId = String(json.id ?? '');
  // CREATE alone leaves the order on-hold in Printify forever — it must be sent
  // to PRODUCTION or nothing prints (and no code did this: there was no
  // confirm/produce step anywhere). Only ever reached from the PAID edge now, so
  // producing here is correct (never on an unpaid cart). A produce failure is
  // non-fatal: the order exists in Printify and the worker retry re-produces.
  if (printifyOrderId) {
    try {
      const prod = await fetch(`https://api.printify.com/v1/shops/${shopId}/orders/${printifyOrderId}/send_to_production.json`, {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(30_000),
      });
      if (!prod.ok) return { provider: 'printify', lines: items.length, ok: false, error: `created but send_to_production HTTP ${prod.status}`, reference: printifyOrderId };
    } catch (err) {
      return { provider: 'printify', lines: items.length, ok: false, error: `created but produce failed: ${(err as Error).message.slice(0, 120)}`, reference: printifyOrderId };
    }
  }
  return { provider: 'printify', lines: items.length, ok: true, reference: printifyOrderId };
}

/**
 * Send an ALREADY-CREATED Printify order to production. Used on retry when the
 * create succeeded but send_to_production failed the first time — re-creating
 * would double-produce (real money). Idempotent: producing an already-in-
 * production order is a no-op on Printify's side.
 */
async function printifyProduce(reference: string, lines: number): Promise<RouteResult> {
  const credential = await connectionService.credentialFor('printify');
  if (!credential) return { provider: 'printify', lines, ok: false, error: 'printify is not connected', reference };
  const [token, shopId] = credential.split('|');
  if (!shopId) return { provider: 'printify', lines, ok: false, error: 'printify shop id missing', reference };
  try {
    const prod = await fetch(`https://api.printify.com/v1/shops/${shopId}/orders/${reference}/send_to_production.json`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(30_000),
    });
    if (!prod.ok && prod.status !== 400) return { provider: 'printify', lines, ok: false, error: `send_to_production HTTP ${prod.status}`, reference };
    // 400 here is typically "already in production" — treat as produced.
    return { provider: 'printify', lines, ok: true, reference };
  } catch (err) {
    return { provider: 'printify', lines, ok: false, error: `produce retry failed: ${(err as Error).message.slice(0, 120)}`, reference };
  }
}

/**
 * Contrado.
 *
 * NOT the Shopify route. Contrado's dropship integration installs from the
 * Shopify App Store and authenticates through Shopify's own OAuth servers, so
 * this store's Shopify compat bridge could never satisfy it — a bridge can look
 * like Shopify to a client that asks it directly, but it cannot make Shopify
 * vouch for the store. Their direct API has no such requirement.
 *
 * Shape taken from their published OpenAPI spec
 * (api.contrado.app/helix/swagger/v1/swagger.json), not guessed: auth is the
 * `X-API-KEY` header, and money is a NUMBER in major units, unlike Printful's
 * decimal strings.
 */
async function pushContrado(order: RoutableOrder, items: RoutableOrder['items']): Promise<RouteResult> {
  const key = await connectionService.credentialFor('contrado');
  if (!key) return { provider: 'contrado', lines: items.length, ok: false, error: 'contrado is not connected' };

  const a = (order.shipAddress ?? {}) as Ship;
  const r = recipient(order);
  const res = await fetch('https://api.contrado.app/helix/v1/orders/create', {
    method: 'POST',
    headers: { 'X-API-KEY': key, 'content-type': 'application/json' },
    body: JSON.stringify({
      // Their idempotency handle and the human's cross-reference: the store's
      // own order number, so a support conversation can name one thing.
      externalReferenceId: order.number,
      recipient: {
        name: r.name,
        address1: r.address1,
        address2: r.address2,
        city: r.city,
        stateCode: a.region ?? '',
        countryCode: r.country_code,
        postCode: r.zip,
        email: r.email,
      },
      lineItem: items.map((i) => ({
        // Their product id, as stored by the catalogue sync.
        storeProductId: Number(i.variant!.sourceId),
        externalReferenceId: i.variant?.sku ?? '',
        quantity: i.quantity,
        // A NUMBER in major units here — their spec types this as `number`,
        // where Printful takes a decimal string. Sending minor units would
        // report every order at 100x its real value.
        price: toMajor(i.priceAtTime, order.currency),
      })),
      totalAmount: toMajor(items.reduce((n, i) => n + i.priceAtTime * i.quantity, 0), order.currency),
      currencyCode: order.currency,
      // Left false deliberately: forceInsert bypasses their duplicate check,
      // and a retry after a timeout would then print the same order twice.
      forceInsert: false,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => ({}))) as { id?: number | string; orderId?: number | string; message?: string; title?: string };
  if (!res.ok) {
    return { provider: 'contrado', lines: items.length, ok: false, error: json.message ?? json.title ?? `HTTP ${res.status}` };
  }
  return { provider: 'contrado', lines: items.length, ok: true, reference: String(json.orderId ?? json.id ?? '') };
}

// Providers that create a REAL (billable, non-draft) order on push, so they are
// deferred from checkout to the PAID edge (submitPaidOrder). Printful is NOT
// here: it drafts at checkout and confirms at payment.
const DEFERRED_PROVIDERS = new Set(['printify', 'contrado']);

const PUSHERS: Record<string, (o: RoutableOrder, i: RoutableOrder['items']) => Promise<RouteResult>> = {
  printful: pushPrintful,
  printify: pushPrintify,
  contrado: pushContrado,
};

/**
 * Route one order to every provider that owns a line of it.
 *
 * Never throws. A provider being down must not fail a paid order — the result
 * is recorded and a human can retry. Providers with no pusher are skipped and
 * named, because silently doing nothing is how "why was this never printed"
 * starts.
 */
export async function routeOrder(order: RoutableOrder): Promise<RouteResult[]> {
  const groups = linesByProvider(order);
  if (!groups.size) return [];

  const blocked = shippable(order);
  if (blocked) {
    return [...groups.keys()].map((provider) => ({
      provider, lines: groups.get(provider)!.length, ok: false, error: `not shippable: ${blocked}`,
    }));
  }

  const results: RouteResult[] = [];
  for (const [provider, items] of groups) {
    // DEFERRED providers submit a REAL, billable order immediately (no draft
    // stage), so they must NOT be pushed at checkout on a still-unpaid order —
    // that either bills you for abandoned carts or (with auto-approve off)
    // strands paid orders on-hold. They are submitted at the PAID edge by
    // submitPaidOrder(). Recorded as deferred so the audit knows they're pending
    // payment, not missing.
    if (DEFERRED_PROVIDERS.has(provider)) {
      results.push({ provider, lines: items.length, ok: true, reference: 'deferred-to-payment' });
      continue;
    }
    const push = PUSHERS[provider];
    if (!push) {
      // A pull partner (Woo bridge) or one with no integration yet. Its lines
      // are reported rather than dropped.
      results.push({ provider, lines: items.length, ok: false, error: 'no push integration — this provider receives orders by webhook' });
      continue;
    }
    try {
      results.push(await push(order, items));
    } catch (err) {
      results.push({ provider, lines: items.length, ok: false, error: (err as Error).message.slice(0, 300) });
    }
  }

  // Recorded so the admin can answer "did the factory hear about this order?"
  // without reading a log file. Best-effort: routing history is not worth
  // failing a paid order over.
  await db.fulfillmentRoute.createMany({
    data: results.map((r) => ({
      orderId: order.id,
      provider: r.provider,
      lines: r.lines,
      ok: r.ok,
      reference: r.reference ?? null,
      error: r.error ?? null,
    })),
  }).catch(() => { /* see above */ });

  return results;
}

/**
 * Confirm a paid order's Printful draft — the "auto-confirm" step.
 *
 * routeOrder() creates every Printful order as a DRAFT at checkout, before the
 * money is in. This is the other half: once the order is PAID, submit that draft
 * to production so it actually prints. Confirming only paid orders is the whole
 * point — an unpaid draft simply expires unprinted, and a test checkout costs
 * nothing.
 *
 * Dup-safe: it confirms the draft by the Printful order id recorded when the
 * draft was made (fulfillment_routes.reference), not by re-creating. Only when
 * no draft was ever recorded — create-time routing was down, or the address was
 * incomplete then and is complete now — does it create the order already
 * confirmed. Never throws: a factory hiccup must not unwind a captured payment.
 */
export async function confirmPrintfulOrder(order: RoutableOrder): Promise<RouteResult | null> {
  const items = linesByProvider(order).get('printful');
  if (!items?.length) return null; // nothing on this order is a Printful line

  const credential = await connectionService.credentialFor('printful');
  if (!credential) return null;
  const [token, storeId] = credential.split('|');
  const headers: Record<string, string> = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  if (storeId) headers['X-PF-Store-Id'] = storeId;

  // The draft's Printful id, from when routeOrder() created it at checkout.
  const draft = await db.fulfillmentRoute.findFirst({
    where: { orderId: order.id, provider: 'printful', ok: true, reference: { not: null } },
    orderBy: { createdAt: 'desc' },
  });

  let result: RouteResult;
  if (draft?.reference) {
    try {
      const res = await fetch(`https://api.printful.com/orders/${encodeURIComponent(draft.reference)}/confirm`, {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok) {
        result = { provider: 'printful', lines: items.length, ok: true, reference: draft.reference };
      } else if (res.status === 404) {
        // The draft id is gone (deleted in Printful, or never really made). Before
        // re-creating confirm=1, RECOVER by external_id — the ORDER may already
        // exist even though this draft id 404s (a prior create whose response was
        // lost), and a blind re-create double-produces (audit C4).
        const rec = await printfulRecover(order.number);
        if (rec.status === 'found') result = { provider: 'printful', lines: items.length, ok: true, reference: rec.id };
        else if (rec.status === 'unknown') result = { provider: 'printful', lines: items.length, ok: false, error: 'printful recovery uncertain — deferring re-create to avoid double production' };
        else result = await pushPrintful(order, items, { confirm: true }); // 'absent' → safe to create
      } else {
        // A non-404 error is usually "already confirmed" — a re-confirm after a
        // confirm that actually succeeded (its response was lost to a timeout).
        // Recording ok:false here makes retryStuckPushes re-confirm every hour
        // forever and the audit show a printing order as stuck (audit). Check the
        // order's REAL status: if it is no longer a draft it is confirmed/in
        // production, so record ok:true and let the retry stop.
        const check = await fetch(`https://api.printful.com/orders/${encodeURIComponent(draft.reference)}`, { headers, signal: AbortSignal.timeout(15_000) }).catch(() => null);
        const cj = check && check.ok ? ((await check.json().catch(() => ({}))) as { result?: { status?: string } }) : null;
        const st = cj?.result?.status;
        if (st && st !== 'draft') {
          result = { provider: 'printful', lines: items.length, ok: true, reference: draft.reference };
        } else {
          const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
          result = { provider: 'printful', lines: items.length, ok: false, error: json.error?.message ?? `confirm HTTP ${res.status}` };
        }
      }
    } catch (err) {
      // A TIMEOUT/network throw here used to bubble out of this fire-and-forget
      // call and record NO route — so retryStuckPushes (which looks at the
      // latest route) still saw the ok:true DRAFT row and never re-drove it: the
      // paid order sat as an unconfirmed draft forever. Record an ok:false
      // confirm row (keeping the draft reference) so the retry re-confirms it.
      result = { provider: 'printful', lines: items.length, ok: false, error: `confirm threw: ${(err as Error).message.slice(0, 150)}`, reference: draft.reference };
    }
  } else {
    // No draft was recorded — the normal PayPal-express case (address arrives
    // post-payment, so no checkout draft). The order may ALREADY exist at Printful
    // from a prior confirm=1 create whose response was lost, or a paid retry.
    // RECOVER by external_id FIRST; a blind confirm=1 create here re-produces a
    // billable order, and the hourly retry would do it again (audit C4).
    const rec = await printfulRecover(order.number);
    if (rec.status === 'found') result = { provider: 'printful', lines: items.length, ok: true, reference: rec.id };
    else if (rec.status === 'unknown') result = { provider: 'printful', lines: items.length, ok: false, error: 'printful recovery uncertain — deferring confirm to avoid double production' };
    else result = await pushPrintful(order, items, { confirm: true }); // 'absent' → safe to create
  }

  // Leave a trail so the admin can see the order was confirmed, not just drafted.
  await db.fulfillmentRoute
    .create({
      data: {
        orderId: order.id,
        provider: 'printful',
        lines: result.lines,
        ok: result.ok,
        reference: result.reference ?? null,
        error: result.error ? `confirm: ${result.error}` : null,
      },
    })
    .catch(() => { /* history is best-effort, never fatal */ });

  return result;
}

/**
 * Submit a PAID order to every push vendor — the single paid-edge entry point.
 *
 * Printful: confirm its draft (confirmPrintfulOrder). Printify + Contrado:
 * create-and-produce NOW (deferred from checkout so an unpaid cart is never
 * billed and a paid order is never left on-hold), with the address that PayPal
 * express only supplies after payment. DUP-SAFE: a provider that already has a
 * real vendor order id (an ok route whose reference is a genuine id, not
 * 'deferred-to-payment') is skipped, so the hourly retry never double-orders.
 * Never throws — a factory hiccup must not unwind a captured payment.
 */
export async function submitPaidOrder(order: RoutableOrder): Promise<RouteResult[]> {
  const groups = linesByProvider(order);
  if (!groups.size) return [];
  const results: RouteResult[] = [];

  // Printful is idempotent via its own draft-reference confirm.
  if (groups.has('printful')) {
    const pf = await confirmPrintfulOrder(order).catch((err) => ({ provider: 'printful', lines: groups.get('printful')!.length, ok: false, error: (err as Error).message.slice(0, 200) } as RouteResult));
    if (pf) results.push(pf);
  }

  for (const provider of ['printify', 'contrado'] as const) {
    const items = groups.get(provider);
    if (!items?.length) continue;
    // Dedup on ANY route that already carries a real vendor id — ok true OR
    // false. A create that succeeded but whose send_to_production failed records
    // ok:false WITH the reference; re-running create would DOUBLE-PRODUCE (real
    // money). So: a genuine vendor id already exists ⇒ never create again.
    const prior = await db.fulfillmentRoute.findFirst({
      where: { orderId: order.id, provider, reference: { not: null, notIn: ['deferred-to-payment', ''] } },
      orderBy: { createdAt: 'desc' },
      select: { reference: true, ok: true },
    });
    if (prior?.ok) { results.push({ provider, lines: items.length, ok: true, reference: prior.reference! }); continue; }
    if (prior?.reference) {
      // Created before, produce failed — RE-PRODUCE the existing order, never
      // re-create. (Contrado has no separate produce step; its forceInsert:false
      // create is vendor-side idempotent, so re-calling push is safe for it.)
      if (provider === 'printify') { results.push(await printifyProduce(prior.reference, items.length)); continue; }
    }
    const blocked = shippable(order);
    if (blocked) { results.push({ provider, lines: items.length, ok: false, error: `not shippable: ${blocked}` }); continue; }
    // PRE-CREATE backend dedup (audit C3). No local reference does NOT guarantee
    // the vendor has no order: a checkout-time create whose response was lost to
    // a timeout leaves no reference, and pushPrintify's in-catch recovery can
    // miss (order past page 5, or the recovery GET itself timed out). Query the
    // vendor by external_id one more time here before creating — if it exists,
    // PRODUCE it instead of creating a second (double production, real money).
    if (provider === 'printify') {
      const existing = await printifyRecover(order.number);
      if (existing.status === 'found') { results.push(await printifyProduce(existing.id, items.length)); continue; }
      if (existing.status === 'unknown') {
        // Recovery could not confirm whether a prior create landed. Creating now
        // risks a SECOND billable production (audit C3). Defer: record ok:false so
        // retryStuckPushes re-checks next cycle (when the vendor API recovers, the
        // recover call returns 'found' and we produce, or 'absent' and we create).
        results.push({ provider, lines: items.length, ok: false, error: 'printify recovery uncertain — deferring create to avoid double production' });
        continue;
      }
      // 'absent' → confirmed no vendor order exists → the create below is safe.
    }
    const push = PUSHERS[provider];
    try { results.push(await push!(order, items)); }
    catch (err) { results.push({ provider, lines: items.length, ok: false, error: (err as Error).message.slice(0, 200) }); }
  }

  // Record the paid-edge attempts. Printful records its OWN route on a SUCCESSFUL
  // confirm (confirmPrintfulOrder), so we skip its ok rows to avoid a duplicate.
  // But if its confirm THREW (token/key drift is a known live condition), no route
  // is written at all — and dropping the ok:false printful result here left the
  // paid order with only its ok:true checkout draft, which retryStuckPushes skips
  // forever: money captured, nothing printed, every dashboard green (audit R6
  // CRITICAL). So record the FAILED printful result too, giving the hourly retry a
  // stuck row to re-drive.
  const toRecord = results.filter((r) => r.provider !== 'printful' || !r.ok);
  if (toRecord.length) {
    await db.fulfillmentRoute.createMany({
      data: toRecord.map((r) => ({ orderId: order.id, provider: r.provider, lines: r.lines, ok: r.ok, reference: r.reference ?? null, error: r.error ? `paid: ${r.error}` : null })),
    }).catch(() => { /* best-effort */ });
  }
  return results;
}

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
  const res = await fetch(`https://api.printful.com/orders${opts?.confirm ? '?confirm=1' : ''}`, {
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
  const res = await fetch(`https://api.printify.com/v1/shops/${shopId}/orders.json`, {
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
  const json = (await res.json().catch(() => ({}))) as { id?: string; errors?: unknown };
  if (!res.ok) {
    return { provider: 'printify', lines: items.length, ok: false, error: `HTTP ${res.status}` };
  }
  return { provider: 'printify', lines: items.length, ok: true, reference: String(json.id ?? '') };
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
    const res = await fetch(`https://api.printful.com/orders/${encodeURIComponent(draft.reference)}/confirm`, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(30_000),
    });
    if (res.ok) {
      result = { provider: 'printful', lines: items.length, ok: true, reference: draft.reference };
    } else if (res.status === 404) {
      // The draft is gone (deleted in Printful, or never really made) — create
      // it already confirmed. Any OTHER error (e.g. already confirmed) is left
      // as-is: re-creating would double-print.
      result = await pushPrintful(order, items, { confirm: true });
    } else {
      const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      result = { provider: 'printful', lines: items.length, ok: false, error: json.error?.message ?? `confirm HTTP ${res.status}` };
    }
  } else {
    // No draft was recorded — create it already confirmed.
    result = await pushPrintful(order, items, { confirm: true });
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

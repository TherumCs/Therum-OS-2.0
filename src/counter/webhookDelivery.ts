import { createHmac } from 'node:crypto';
import { db } from '../lib/db.js';
import { decryptSecret } from '../lib/crypto.js';

// Outbound webhooks: how a connected partner learns an order happened.
//
// Without this the bridge is read-only in practice — a partner syncs the
// catalogue, sells nothing, and never receives the order it is supposed to
// fulfil. Printful's WooCommerce plugin registers a webhook named "Printful
// Integration" and then waits; so does every other POD partner.
//
// Shaped to WooCommerce's delivery format because that is what partners
// already parse: the X-WC-Webhook-* headers below, and a signature that is the
// base64 HMAC-SHA256 of the exact bytes sent.

const TIMEOUT_MS = 15_000;

/** Woo signs the raw body, so the signature must be over the bytes we send. */
function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('base64');
}

/**
 * A 2xx is NOT proof a partner accepted the order. Partners return 200 with an
 * error envelope: Tapstitch `{code:200,data:null}` (a no-op), PODpartner
 * `{code:2002,"System is busy"}` (transient) and `{code:1,"参数无效"}` (rejected).
 * This reads the body and decides whether it was genuinely accepted, so
 * reconciliation and retry act on the truth instead of the status line.
 */
export function isGenuineAccept(status: number, body: string): boolean {
  if (status < 200 || status >= 300) return false;
  const t = (body ?? '').trim();
  if (!t) return true; // empty 2xx — accepted
  try {
    const j = JSON.parse(t) as Record<string, unknown>;
    const code = j.code;
    // Numeric error code that isn't a success sentinel (0 or 200).
    if (typeof code === 'number' && code !== 0 && code !== 200) return false;
    // Tapstitch/HugePOD return `{code:200,data:null}` when they matched ZERO of
    // the order's lines — a NO-OP, not an acceptance. Treating code===200 as
    // success (ignoring data) meant a paid order that matched nothing was
    // recorded as genuinely fulfilled while the factory made nothing. If the
    // vendor uses a code+data envelope and code says OK but data is null/empty,
    // that is "received, produced nothing" — not genuine.
    const hasEnvelope = typeof code === 'number';
    if (hasEnvelope && 'data' in j && (j.data === null || (Array.isArray(j.data) && j.data.length === 0))) return false;
    const msg = String(j.msg ?? j.message ?? '').toLowerCase();
    // Only read reject keywords out of the MESSAGE when the envelope code is not
    // a success value. A genuinely-accepted response often carries a success
    // message containing a reject substring ("0 failures", "nothing not found"),
    // and the old free-substring match recorded those as rejections — flagging a
    // fulfilled order as stuck (audit). Word-boundaried so 'fail' matches
    // failed/failure, not the middle of another word.
    const success = code === 0 || code === 200;
    if (!success && (/\b(?:busy|invalid|failed|failure|denied|unauthor\w*|not\s*found|reject\w*)\b/.test(msg) || /参数|错误/.test(msg))) return false;
  } catch {
    // non-JSON 2xx body — take the status at face value.
  }
  return true;
}

/** Transient partner conditions worth an automatic retry (vs a hard reject). */
export function isTransient(status: number, body: string): boolean {
  if (status === 429 || (status >= 500 && status < 600)) return true;
  try {
    const j = JSON.parse((body ?? '').trim()) as Record<string, unknown>;
    const msg = String(j.msg ?? j.message ?? '').toLowerCase();
    if (/busy|rate|throttle|timeout|again later/.test(msg)) return true;
    if (j.code === 2002) return true; // PODpartner "System is busy"
  } catch { /* ignore */ }
  return false;
}

export interface WebhookEvent {
  topic: string;              // "order.created"
  resourceId: string;
  payload: unknown;
}

/**
 * PII fence on the PUSH channel. order.created / order.updated / order.deleted
 * carry the FULL customer billing/shipping/email object (orderWebhookPayload).
 * deliver() otherwise selects hooks by topic alone, so any read_write partner
 * that subscribes to order.updated receives EVERY customer's PII — including
 * orders it has nothing to do with (audit: the same cross-partner leak the REST
 * order routes are fenced against, on the webhook side).
 *
 * A partner may receive an order's full payload ONLY if it OWNS a line in that
 * order, matched by the server-assigned vendorId its synced products carry
 * (writeProduct stamps vendorId = the Vendor row named after the partner's own
 * credential label). Ownership is keyed on that vendorId ALONE — deliberately
 * NOT on a brand token derived from the credential label. The label is
 * partner-supplied (the wc-auth app_name), so a brand match would be spoofable:
 * a rogue credential labelled "printful" would otherwise match every
 * fulfillmentProvider='printful' order, and two same-first-word labels would
 * cross-deliver. vendorId is a cuid tied to the ACTUAL products a credential
 * synced, so it cannot be forged to match another partner's lines.
 *
 * Fail CLOSED: a hook with no credential, whose credential resolves to no Vendor
 * row, or an order whose lines carry no vendorId (in-house / self-fulfilled)
 * receives nothing. Legit PODpartner/PodPluser (the only full-payload order.*
 * subscribers) sync AND register their hook under the same credential, so their
 * own orders match. Printful/Printify never subscribe to webhooks (pull/push
 * API). The action.* ping carries no PII ({action,arg:id}) and the partner then
 * PULLs the SCOPED /orders/:id, so it is exempt; product.* topics carry no PII.
 * NOTE: a first-party "all orders" webhook (analytics/CRM) is intentionally NOT
 * served here — that is an admin concern, not a partner store-key surface.
 */
// Brand token: first alnum word, aliased (hugepod→tapstitch). Same rule as
// fulfillmentAudit — used as the transition fallback when a hook/vendor has no
// credentialId link yet (existing prod data predates the credentialId column).
function brandToken(s: string | null | undefined): string {
  const f = String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ')[0] ?? '';
  return f === 'hugepod' ? 'tapstitch' : f;
}
function hookUrlBrand(url: string | null | undefined): string {
  try { return brandToken(new URL(String(url)).hostname.replace(/^www\./, '').split('.')[0]); } catch { return ''; }
}

async function scopeOrderDelivery<T extends { id: string; credentialId: string | null; name?: string; deliveryUrl?: string }>(
  hooks: T[],
  orderId: string,
  payload: unknown,
): Promise<Array<{ hook: T; body: string }>> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    // orderBy id asc so this list aligns positionally with the payload's
    // line_items (orderWebhookPayload maps order.items, also id asc via
    // orderInclude) — the per-line filter below matches by index, and an
    // OrderItem UPDATE must never re-order one list relative to the other and
    // hand a partner another vendor's line (audit R6).
    select: { items: { select: { variant: { select: { sku: true, product: { select: { id: true, vendorId: true } } } } }, orderBy: { id: 'asc' } } },
  });
  if (!order) return []; // can't attribute the order → push nothing
  const itemVendorIds = order.items.map((it) => it.variant?.product?.vendorId ?? null);
  const ownerVendorIds = new Set(itemVendorIds.filter((v): v is string => !!v));
  if (!ownerVendorIds.size) return []; // no partner owns this order (in-house)

  // Resolve each hook's vendor by credentialId (secure, audit C2). TRANSITION
  // FALLBACK: legacy hooks predate the credentialId column, so also resolve by
  // brand token (hook name / delivery host vs vendor name). A brand can map to
  // MORE THAN ONE vendor — a reconnect-by-add spawns a second "PodPluser" vendor —
  // so brand → a SET of vendorIds and a hook owns the order if ANY of them is on a
  // line. The old first-wins map (with no orderBy) picked an ARBITRARY winner and
  // silently darked every order tagged to the losing dup vendor (audit R6). Load
  // deterministically (orderBy) and keep all ids per brand.
  const vendors = await db.vendor.findMany({ select: { id: true, credentialId: true, name: true }, orderBy: { id: 'asc' } });
  const vendorIdByCred = new Map<string, string>();
  const vendorIdsByBrand = new Map<string, Set<string>>();
  for (const v of vendors) {
    if (v.credentialId) vendorIdByCred.set(v.credentialId, v.id);
    const b = brandToken(v.name);
    if (b) { const set = vendorIdsByBrand.get(b) ?? new Set<string>(); set.add(v.id); vendorIdsByBrand.set(b, set); }
  }

  const p = (payload ?? {}) as Record<string, unknown> & { line_items?: unknown[] };
  const lineItems = Array.isArray(p.line_items) ? p.line_items : null;
  const out: Array<{ hook: T; body: string }> = [];
  for (const hook of hooks) {
    // Candidate vendorIds for this hook: its credential's vendor PLUS every vendor
    // sharing its brand token (dup-vendor safe).
    const candidates = new Set<string>();
    const byCred = hook.credentialId ? vendorIdByCred.get(hook.credentialId) : undefined;
    if (byCred) candidates.add(byCred);
    // The brand-token fallback is for LEGACY hooks only — rows that predate the
    // credentialId column. A hook that carries a credential is scoped by that
    // credential and nothing else: its name and delivery URL are partner-typed,
    // so letting them widen ownership meant any partner key could register a
    // hook called "PodPluser" and receive PodPluser's customers' addresses.
    const b = hook.credentialId ? '' : brandToken(hook.name) || hookUrlBrand(hook.deliveryUrl);
    if (b) for (const id of vendorIdsByBrand.get(b) ?? []) candidates.add(id);
    // The vendorIds this hook actually owns on THIS order.
    const owned = new Set<string>([...candidates].filter((id) => ownerVendorIds.has(id)));
    if (!owned.size) continue; // not an owner of this order
    // Send this partner ONLY its own lines (any vendorId it owns), matched
    // positionally to the payload. A multi-vendor order otherwise reached each
    // partner with the WHOLE order (other partners' items), which a strict
    // receiver drops (PodPluser 200-no-create — audit / live).
    let scoped: unknown = payload;
    if (lineItems && lineItems.length === itemVendorIds.length) {
      const kept = lineItems
        .map((li, idx) => ({ li, idx }))
        .filter(({ idx }) => { const vid = itemVendorIds[idx]; return vid != null && owned.has(vid); });
      // The partner resolves product_id / variation_id against the integer ids
      // IT stored when it published — its own copy of the product in this
      // store — not against the branded product a merchant re-pointed to its
      // vendor. Order 100074 (Hunting Season Hoodie) was pushed 8× with the
      // branded ids and never created; the one push carrying PodPluser's own
      // ids (155/1782) was the one its handler actually processed. So when a
      // partner-owned twin with the same SKU exists, send the twin's ids.
      const twins = await partnerTwinIds(kept.map(({ idx }) => order.items[idx]!.variant), owned);
      const rewritten = kept.map(({ li, idx }) => {
        const v = order.items[idx]!.variant;
        const twin = v?.sku ? twins.get(v.sku) : undefined;
        if (!twin || !li || typeof li !== 'object') return li;
        return { ...(li as Record<string, unknown>), product_id: twin.productWooId, variation_id: twin.variantWooId };
      });
      scoped = { ...p, line_items: rewritten };
    }
    out.push({ hook, body: JSON.stringify(scoped) });
  }
  return out;
}

/**
 * For each line's SKU, the partner-owned twin variant (same SKU, a product
 * owned by one of the hook's vendors that is NOT the line's own product),
 * newest product first — the latest partner publish is the copy it remembers.
 * A line whose product is itself the partner's copy gets no entry (ids stand).
 */
async function partnerTwinIds(
  variants: Array<{ sku: string | null; product: { id: string; vendorId: string | null } | null } | null>,
  owned: Set<string>,
): Promise<Map<string, { productWooId: number; variantWooId: number }>> {
  const out = new Map<string, { productWooId: number; variantWooId: number }>();
  const skus = [...new Set(variants.map((v) => v?.sku).filter((s): s is string => !!s))];
  if (!skus.length || !owned.size) return out;
  const rows = await db.productVariant.findMany({
    where: { sku: { in: skus }, product: { vendorId: { in: [...owned] }, deletedAt: null } },
    select: { sku: true, wooId: true, product: { select: { id: true, wooId: true, createdAt: true } } },
    orderBy: { product: { createdAt: 'desc' } },
  });
  for (const v of variants) {
    if (!v?.sku || out.has(v.sku)) continue;
    const twin = rows.find((r) => r.sku === v.sku && r.product.id !== v.product?.id);
    if (twin && twin.wooId && twin.product.wooId) out.set(v.sku, { productWooId: twin.product.wooId, variantWooId: twin.wooId });
  }
  return out;
}

/**
 * Deliver one event to every active webhook subscribed to its topic.
 *
 * Never throws. An order must not fail because a partner's endpoint is down —
 * the delivery row records the failure and the order stands. Retries are
 * bounded and immediate-ish; a partner that is down for minutes needs the
 * replay endpoint, not an unbounded queue in the checkout path.
 */
export async function deliver(event: WebhookEvent, opts?: { onlyHookIds?: Set<string> }): Promise<void> {
  let hooks = await db.storeWebhook.findMany({
    where: { topic: event.topic, status: 'active' },
  });
  // Targeted redelivery: re-offer ONLY the hooks that have not genuinely
  // accepted — never re-broadcast to a partner that already took the order.
  if (opts?.onlyHookIds) hooks = hooks.filter((h) => opts.onlyHookIds!.has(h.id));
  if (!hooks.length) return;

  // PII fence + per-partner line filtering: an order.* full payload goes ONLY to a
  // partner that owns a line in this order, and carries ONLY that partner's lines
  // (scopeOrderDelivery). Non-order topics broadcast a shared body unchanged.
  let bodyByHook: Map<string, string> | null = null;
  if (event.topic.startsWith('order.')) {
    const scoped = await scopeOrderDelivery(hooks, event.resourceId, event.payload);
    if (!scoped.length) return;
    hooks = scoped.map((s) => s.hook);
    bodyByHook = new Map(scoped.map((s) => [s.hook.id, s.body]));
  }
  const sharedBody = JSON.stringify(event.payload);

  await Promise.all(
    hooks.map(async (hook) => {
      // Per-hook body for order.* (its own lines); shared body otherwise.
      const body = bodyByHook?.get(hook.id) ?? sharedBody;
      let secret: string;
      try {
        secret = decryptSecret(hook.secretEncrypted);
      } catch (err) {
        // NEVER silent: a decrypt failure means a key/env drift and EVERY
        // delivery to this hook is dead. Log loudly, and after 3 consecutive
        // decrypt failures pause the hook so redelivery stops burning on it
        // and the health surface shows a paused webhook instead of green.
        const { logger } = await import('../lib/logger.js');
        logger.error({ err, webhookId: hook.id, url: hook.deliveryUrl }, 'webhook secret decrypt FAILED — deliveries to this hook are dead');
        await db.webhookDelivery.create({
          data: {
            webhookId: hook.id, topic: event.topic, resourceId: event.resourceId,
            error: 'secret could not be decrypted — re-register this webhook',
          },
        });
        const recent = await db.webhookDelivery.findMany({ where: { webhookId: hook.id }, orderBy: { createdAt: 'desc' }, take: 3, select: { error: true } });
        if (recent.length === 3 && recent.every((r) => r.error?.includes('could not be decrypted'))) {
          await db.storeWebhook.update({ where: { id: hook.id }, data: { status: 'paused' } });
          logger.error({ webhookId: hook.id }, 'webhook PAUSED after 3 consecutive decrypt failures');
        }
        return;
      }

      // SSRF re-check at SEND time, not just registration: a delivery_url that
      // was public when registered can be re-pointed at an internal address
      // later (DNS rebind). Refuse to POST order contents to a private target.
      const { assertPublicHttpsUrl } = await import('../lib/ssrfGuard.js');
      const guard = await assertPublicHttpsUrl(hook.deliveryUrl);
      if (!guard.ok) {
        const { logger } = await import('../lib/logger.js');
        logger.error({ webhookId: hook.id, url: hook.deliveryUrl, reason: guard.reason }, 'webhook delivery BLOCKED — url resolves private (SSRF guard)');
        await db.webhookDelivery.create({ data: { webhookId: hook.id, topic: event.topic, resourceId: event.resourceId, error: `blocked: ${guard.reason}`, genuine: false } });
        return;
      }

      // Two attempts. The common failure is a cold serverless endpoint, which
      // the second call wakes; anything still failing needs a human, not a
      // third identical POST.
      for (let attempt = 1; attempt <= 2; attempt++) {
        const started = Date.now();
        try {
          // Present EXACTLY as WooCommerce does. Partner parsers are strict:
          // the source header is how several identify the shop (real Woo sends
          // home_url('/') — trailing slash), the UA is "WooCommerce/x Hookshot",
          // and ids are numeric. PUBLIC_SITE_URL was never set in production,
          // so every delivery carried an EMPTY source header — a vendor keying
          // on it dropped the event silently while returning 200.
          const origin = (process.env.PUBLIC_SITE_URL || process.env.PUBLIC_ORIGIN || '').replace(/\/+$/, '');
          // Stable numeric id per webhook (Woo's is an integer row id).
          const numericHookId = Math.abs(hook.id.split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0)) % 1_000_000;
          const res = await fetch(hook.deliveryUrl, {
            method: 'POST',
            // redirect:'manual' — do NOT follow redirects. The send-time SSRF
            // guard validates only the ORIGINAL host; undici re-resolves DNS at
            // connect and follows 3xx by default, so a partner endpoint could
            // reply `302 Location: http://169.254.169.254/…` (cloud metadata) or
            // an internal service and the production box would follow it from
            // inside the network, leaking the order JSON and reading back the
            // internal response as the stored delivery error (audit C6). A real
            // partner webhook returns 2xx directly; a redirect is treated as a
            // failed, non-followed delivery.
            redirect: 'manual',
            headers: {
              'content-type': 'application/json',
              'user-agent': 'WooCommerce/10.4.3 Hookshot (WordPress/6.8.2)',
              'x-wc-webhook-source': origin ? `${origin}/` : '',
              'x-wc-webhook-topic': event.topic,
              'x-wc-webhook-resource': event.topic.split('.')[0] ?? '',
              'x-wc-webhook-event': event.topic.split('.').slice(1).join('.') ?? '',
              'x-wc-webhook-signature': sign(body, secret),
              'x-wc-webhook-id': String(numericHookId),
              'x-wc-webhook-delivery-id': String(Date.now() % 1_000_000_000),
            },
            body,
            signal: AbortSignal.timeout(TIMEOUT_MS),
          });
          // A redirect is never a genuine accept and is never followed — record
          // it as a blocked delivery so the partner fixes their endpoint, and do
          // not read/store an internal Location target.
          if (res.status >= 300 && res.status < 400) {
            await db.webhookDelivery.create({
              data: {
                webhookId: hook.id, topic: event.topic, resourceId: event.resourceId,
                responseCode: res.status, genuine: false,
                error: `refused to follow redirect (HTTP ${res.status}) — endpoint must return 2xx directly`,
                attempt, durationMs: Date.now() - started,
              },
            });
            continue;
          }
          const bodyText = await res.text().catch(() => '');
          const genuine = isGenuineAccept(res.status, bodyText);
          await db.webhookDelivery.create({
            data: {
              webhookId: hook.id, topic: event.topic, resourceId: event.resourceId,
              responseCode: res.status, responseBody: bodyText.slice(0, 500), genuine,
              error: genuine ? null : (bodyText.slice(0, 300) || `HTTP ${res.status}`),
              attempt, durationMs: Date.now() - started,
            },
          });
          // Return only on a GENUINE accept — a 200 with an error/no-op body
          // must fall through so the second attempt (and the worker retry) fire.
          if (genuine) return;
        } catch (err) {
          await db.webhookDelivery.create({
            data: {
              webhookId: hook.id, topic: event.topic, resourceId: event.resourceId,
              error: (err as Error).message.slice(0, 500),
              attempt, durationMs: Date.now() - started,
            },
          });
        }
      }
    }),
  );
}

/**
 * Fire and forget.
 *
 * Checkout must not block on a partner's server. The promise is deliberately
 * not awaited by callers; failures land in webhook_deliveries.
 */
export function emit(event: WebhookEvent): void {
  void deliver(event).catch(() => { /* recorded per-hook above */ });
}

import type {
  PaymentGateway, PaymentIntentResult, PspWebhookEvent, GatewayCapability, OrderForPayment,
} from './gateway.js';

// Sezzle — buy now, pay later in four instalments.
//
// A REDIRECT gateway like PayPal: a session is created server-side, the shopper
// is sent to Sezzle's checkout, and comes back to `complete_url`. No in-page
// form, so `payWithToken` is deliberately absent.
//
// Credential: "publicKey|privateKey" with an optional third part for the
// environment. Sandbox by default — a BNPL credential that quietly reached
// production takes real instalments from a real shopper.
//
// Sezzle speaks CENTS (`amount_in_cents`), which is how this store already
// stores money, so no conversion — and no 100x bug waiting to happen.

const HOSTS = {
  sandbox: 'https://sandbox.gateway.sezzle.com',
  live: 'https://gateway.sezzle.com',
} as const;

/** Sezzle refuses anything under a dollar; better to say so than to be refused. */
const MINIMUM_CENTS = 100;

interface SezzleCred { publicKey: string; privateKey: string; host: string; live: boolean }

function parse(credential: string): SezzleCred {
  const [publicKey, privateKey, env] = credential.split('|');
  if (!publicKey?.trim() || !privateKey?.trim()) {
    throw new Error('Sezzle credential must be "publicKey|privateKey" (add "|live" for production)');
  }
  const live = ['live', 'production'].includes((env ?? '').trim().toLowerCase());
  return {
    publicKey: publicKey.trim(),
    privateKey: privateKey.trim(),
    host: live ? HOSTS.live : HOSTS.sandbox,
    live,
  };
}

/**
 * Bearer token from the key pair.
 *
 * Not cached, for the same reason PayPal's is not: a cache keyed on nothing
 * hands a live token to a sandbox call after a credential change, and that
 * failure reads as "Sezzle is down".
 */
async function token(cred: SezzleCred): Promise<string> {
  const res = await fetch(`${cred.host}/v2/authentication`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ public_key: cred.publicKey, private_key: cred.privateKey }),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as { token?: string; message?: string };
  if (!res.ok || !json.token) throw new Error(`Sezzle authentication failed: ${json.message ?? res.status}`);
  return json.token;
}

async function sz<T>(cred: SezzleCred, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${cred.host}${path}`, {
    method: init.method ?? 'GET',
    headers: { authorization: `Bearer ${await token(cred)}`, 'content-type': 'application/json' },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`Sezzle ${path} -> ${res.status} ${String(json.message ?? '')}`.trim());
  return json as T;
}

export const sezzleGateway: PaymentGateway = {
  id: () => 'sezzle',
  displayName: () => 'Sezzle',
  supports: (c: GatewayCapability) =>
    (['refunds', 'partial_refunds', 'webhooks', 'bnpl'] as GatewayCapability[]).includes(c),

  async createIntent(order: OrderForPayment, credential: string): Promise<PaymentIntentResult> {
    const cred = parse(credential);
    if (order.total < MINIMUM_CENTS) {
      throw new Error(`Sezzle requires at least $1.00 — this order is ${order.total} cents.`);
    }
    // Sezzle sends the shopper BACK here, so a wrong base means a completed
    // payment that never returns to the store. Refuse rather than guess.
    const base = process.env.PUBLIC_SITE_URL;
    if (!base) throw new Error('PUBLIC_SITE_URL must be set — Sezzle needs a return address.');
    const created = await sz<{ order?: { uuid?: string; checkout_url?: string } }>(cred, '/v2/session', {
      method: 'POST',
      body: {
        // Where Sezzle sends the shopper back. The order number rides in the
        // query so the return path can settle without trusting the referrer.
        complete_url: { href: `${base}/checkout/return?provider=sezzle&order=${encodeURIComponent(order.number)}` },
        cancel_url: { href: `${base}/checkout?cancelled=sezzle` },
        order: {
          intent: 'CAPTURE',
          // Sezzle allows alphanumerics, dashes and underscores only.
          reference_id: order.number.replace(/[^A-Za-z0-9_-]/g, '-'),
          description: `Order ${order.number}`,
          order_amount: {
            // Already minor units in this store — Sezzle wants cents, so this
            // passes straight through.
            amount_in_cents: order.total,
            currency: order.currency.toUpperCase(),
          },
        },
      },
    });
    const uuid = created.order?.uuid;
    const checkout = created.order?.checkout_url;
    if (!uuid || !checkout) throw new Error('Sezzle did not return a checkout session.');
    return {
      providerId: 'sezzle',
      intentId: uuid,
      status: 'requires_action',
      clientSecret: null,
      redirectUrl: checkout,
    };
  },

  async refund(order: OrderForPayment, amountMinor: number, _idempotencyKey: string, credential: string, ctx: { intentId: string }): Promise<string> {
    const cred = parse(credential);
    const re = await sz<{ uuid?: string }>(cred, `/v2/order/${ctx.intentId}/refund`, {
      method: 'POST',
      body: { amount_in_cents: amountMinor, currency: order.currency.toUpperCase() },
    });
    // Sezzle does not always echo a refund id; fall back to the order uuid so
    // the ledger records something traceable rather than an empty string.
    return re.uuid ?? ctx.intentId;
  },

  /**
   * Sezzle signs webhooks with the private key over the raw body.
   *
   * No signature header means this did not come from Sezzle's sender — the
   * contract says return null rather than throw. A PRESENT but wrong signature
   * is a forgery and throws, because accepting it would let anyone mark an
   * order paid.
   */
  async verifyWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>, credential: string): Promise<Record<string, unknown> | null> {
    const raw = headers['sezzle-signature'] ?? headers['Sezzle-Signature'];
    const signature = Array.isArray(raw) ? raw[0] : raw;
    if (!signature) return null;

    const { createHmac, timingSafeEqual } = await import('node:crypto');
    const cred = parse(credential);
    const expected = createHmac('sha256', cred.privateKey).update(rawBody).digest('hex');
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('Sezzle webhook signature did not verify.');
    return JSON.parse(rawBody) as Record<string, unknown>;
  },

  parseEvent(verified: Record<string, unknown>): PspWebhookEvent {
    const type = String(verified.event_type ?? verified.type ?? '');
    const KINDS: Record<string, string> = {
      'order.captured': 'payment.succeeded',
      'order.authorized': 'payment.succeeded',
      'order.failed': 'payment.failed',
      'order.refunded': 'payment.refunded',
      'order.cancelled': 'payment.failed',
    };
    const order = (verified.order ?? {}) as { uuid?: string };
    return {
      providerId: 'sezzle',
      providerEventId: String(verified.uuid ?? verified.id ?? ''),
      kind: KINDS[type] ?? type.toLowerCase(),
      paymentIntentId: order.uuid ? String(order.uuid) : null,
      refundId: type.includes('refund') ? String(verified.uuid ?? '') : null,
      payload: verified,
    };
  },

  async intentStatus(intentId: string, credential: string): Promise<string> {
    const cred = parse(credential);
    const got = await sz<{ authorization?: { approved?: boolean }; captured_at?: string | null; refunded_at?: string | null }>(
      cred, `/v2/order/${intentId}`,
    );
    if (got.refunded_at) return 'refunded';
    if (got.captured_at) return 'succeeded';
    if (got.authorization?.approved) return 'processing';
    return 'requires_action';
  },
};

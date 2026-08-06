import type {
  PaymentGateway, PaymentIntentResult, PspWebhookEvent, GatewayCapability, OrderForPayment,
} from './gateway.js';
import { toMajor } from '../../counter/currency.js';

// PayPal, via the Orders v2 API.
//
// A REDIRECT gateway, unlike Stripe and Square: createIntent returns an
// approval URL the shopper is sent to, and the money is only captured when
// they come back. That is why the contract has `redirectUrl` — and why this
// gateway deliberately does NOT implement `payWithToken`, which would imply an
// in-page card form PayPal does not give us.
//
// Credential shape: "clientId:secret" — the catalogue's declared join for
// paypal — with an optional third part for the environment. Sandbox is the
// DEFAULT: a credential that silently reached live PayPal because someone
// forgot a suffix is a real charge against a real card.
//
// One integration, three methods: PayPal, Venmo and PayPal Credit all ride
// this rail (see methodRegistry.ts).

const HOSTS = {
  sandbox: 'https://api-m.sandbox.paypal.com',
  live: 'https://api-m.paypal.com',
} as const;

interface PayPalCred {
  clientId: string;
  secret: string;
  host: string;
  live: boolean;
}

function parse(credential: string): PayPalCred {
  const [clientId, secret, env] = credential.split(':');
  if (!clientId?.trim() || !secret?.trim()) {
    throw new Error('PayPal credential must be "clientId:secret" (add ":live" for production)');
  }
  const live = env?.trim().toLowerCase() === 'live' || env?.trim().toLowerCase() === 'production';
  return { clientId: clientId.trim(), secret: secret.trim(), host: live ? HOSTS.live : HOSTS.sandbox, live };
}

/**
 * OAuth token.
 *
 * PayPal issues a short-lived bearer from the client id and secret, and every
 * other call needs one. Not cached: tokens last ~9 hours but a cache keyed on
 * nothing would hand a live token to a sandbox call after a credential change,
 * and the failure would look like "PayPal is down".
 */
async function token(cred: PayPalCred): Promise<string> {
  const res = await fetch(`${cred.host}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${cred.clientId}:${cred.secret}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json()) as { access_token?: string; error_description?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(`PayPal authentication failed: ${json.error_description ?? res.status}`);
  }
  return json.access_token;
}

async function pp<T>(
  cred: PayPalCred, path: string, init: { method?: string; body?: unknown; idempotencyKey?: string } = {},
): Promise<T> {
  const res = await fetch(`${cred.host}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${await token(cred)}`,
      'content-type': 'application/json',
      // PayPal's idempotency header. Without it a retried capture can take the
      // money twice, and a network blip is enough to cause a retry.
      ...(init.idempotencyKey ? { 'PayPal-Request-Id': init.idempotencyKey } : {}),
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const detail = Array.isArray(json.details) && json.details[0] && typeof json.details[0] === 'object'
      ? String((json.details[0] as { description?: string }).description ?? '')
      : '';
    throw new Error(`PayPal ${path} -> ${res.status} ${String(json.name ?? '')} ${detail}`.trim());
  }
  return json as T;
}

/** PayPal's order status vocabulary, mapped to this store's. */
function mapStatus(s: string): string {
  switch (s) {
    case 'COMPLETED': return 'succeeded';
    case 'APPROVED': return 'processing';   // approved but not yet captured
    case 'CREATED':
    case 'SAVED':
    case 'PAYER_ACTION_REQUIRED': return 'requires_action';
    case 'VOIDED': return 'canceled';
    default: return s.toLowerCase();
  }
}

/** Contact PayPal collected in its own window, read off the capture response so
 *  a formless PayPal checkout can be backfilled with an email and a ship-to.
 *  Every field is optional in PayPal's payload — hence the guards. */
export interface PaypalContact {
  email: string | null;
  shipAddress: { name: string; line1: string; line2?: string; city: string; region?: string; postalCode?: string; country: string } | null;
}

interface PaypalCaptureResponse {
  status: string;
  payer?: { email_address?: string; name?: { given_name?: string; surname?: string } };
  purchase_units?: {
    shipping?: {
      name?: { full_name?: string };
      address?: {
        address_line_1?: string; address_line_2?: string;
        admin_area_2?: string; admin_area_1?: string; postal_code?: string; country_code?: string;
      };
    };
  }[];
}

function paypalContact(done: PaypalCaptureResponse): PaypalContact {
  const payer = done.payer ?? {};
  const ship = (done.purchase_units ?? [])[0]?.shipping ?? {};
  const a = ship.address ?? {};
  const name = ship.name?.full_name || [payer.name?.given_name, payer.name?.surname].filter(Boolean).join(' ') || '';
  const shipAddress = a.address_line_1
    ? {
        name,
        line1: a.address_line_1,
        ...(a.address_line_2 ? { line2: a.address_line_2 } : {}),
        city: a.admin_area_2 ?? '',
        ...(a.admin_area_1 ? { region: a.admin_area_1 } : {}),
        ...(a.postal_code ? { postalCode: a.postal_code } : {}),
        country: (a.country_code ?? 'US').toUpperCase(),
      }
    : null;
  return { email: payer.email_address ?? null, shipAddress };
}

const gateway = {
  id: () => 'paypal',
  displayName: () => 'PayPal',
  supports(capability: GatewayCapability): boolean {
    // No card/apple/google: PayPal's own wallet, Venmo and PayPal Credit are
    // what this rail carries. Claiming `card` here would make the router offer
    // a card form PayPal cannot render in-page.
    return (['refunds', 'partial_refunds', 'webhooks', 'p2p', 'bnpl'] as GatewayCapability[]).includes(capability);
  },

  // `ctx` carries the shopper's chosen funding source (venmo / paypal / …) and
  // the return URLs Venmo needs. It is optional so the interface's other
  // gateways — none of which redirect — are unaffected.
  async createIntent(
    order: OrderForPayment,
    credential: string,
    ctx?: { fundingMethod?: string; returnUrl?: string; cancelUrl?: string },
  ): Promise<PaymentIntentResult> {
    const cred = parse(credential);
    // Venmo is a distinct PayPal funding source: without payment_source.venmo
    // the shopper lands on the generic PayPal login instead of the Venmo
    // hand-off. It REQUIRES experience_context return URLs, so it is only set
    // when both the method and the URLs are present — otherwise the order is
    // built exactly as before and PayPal chooses the funding on its own page.
    // paypal / paypal_credit deliberately stay on that untouched path: Pay
    // Later still surfaces within the PayPal flow when the buyer is eligible.
    const paymentSource =
      ctx?.fundingMethod === 'venmo' && ctx.returnUrl && ctx.cancelUrl
        ? { payment_source: { venmo: { experience_context: { return_url: ctx.returnUrl, cancel_url: ctx.cancelUrl } } } }
        : {};
    const created = await pp<{ id: string; status: string; links?: { rel: string; href: string }[] }>(
      cred, '/v2/checkout/orders',
      {
        method: 'POST',
        idempotencyKey: `order-${order.id}`,
        body: {
          intent: 'CAPTURE',
          ...paymentSource,
          // Ask PayPal to collect and hand back the payer's shipping address, so
          // a formless PayPal checkout (no address typed on our side) still ends
          // up with a ship-to. The capture response carries it, and finalizeReturn
          // backfills the order.
          application_context: { shipping_preference: 'GET_FROM_FILE' },
          purchase_units: [{
            // PayPal echoes this back on the webhook, and it is how a captured
            // payment is matched to an order without trusting the payer.
            custom_id: order.id,
            invoice_id: order.number,
            amount: {
              currency_code: order.currency.toUpperCase(),
              // PayPal wants a DECIMAL string. Sending minor units here would
              // charge 100x, and it would look like a successful payment.
              value: toMajor(order.total, order.currency).toFixed(2),
            },
          }],
        },
      },
    );
    return {
      providerId: 'paypal',
      intentId: created.id,
      status: mapStatus(created.status),
      clientSecret: null,
      redirectUrl: created.links?.find((l) => l.rel === 'payer-action' || l.rel === 'approve')?.href ?? null,
    };
  },

  async refund(order: OrderForPayment, amountMinor: number, idempotencyKey: string, credential: string, ctx: { intentId: string }): Promise<string> {
    const cred = parse(credential);
    // A refund goes against the CAPTURE, not the order — the order id is what
    // this store stored, so the capture has to be resolved first. Getting this
    // wrong is the exact bug that made every Square order un-refundable.
    const found = await pp<{ purchase_units?: { payments?: { captures?: { id: string }[] } }[] }>(
      cred, `/v2/checkout/orders/${ctx.intentId}`,
    );
    const captureId = found.purchase_units?.[0]?.payments?.captures?.[0]?.id;
    if (!captureId) throw new Error('That PayPal order has no capture to refund.');

    const re = await pp<{ id: string }>(cred, `/v2/payments/captures/${captureId}/refund`, {
      method: 'POST',
      idempotencyKey,
      body: {
        amount: {
          currency_code: order.currency.toUpperCase(),
          value: toMajor(amountMinor, order.currency).toFixed(2),
        },
      },
    });
    return re.id;
  },

  /**
   * Capture an approved order.
   *
   * Not part of the contract — the redirect return path calls it. PayPal
   * authorises on approval and only moves money on capture, so skipping this
   * leaves an order the shopper believes they paid for and which never settles.
   */
  async capture(orderId: string, credential: string, idempotencyKey: string): Promise<{ status: string; contact: PaypalContact }> {
    const cred = parse(credential);
    const done = await pp<PaypalCaptureResponse>(
      cred, `/v2/checkout/orders/${orderId}/capture`,
      { method: 'POST', idempotencyKey },
    );
    // The capture response carries the payer's email and the shipping address
    // they confirmed in PayPal — returned so a formless checkout can backfill.
    return { status: mapStatus(done.status), contact: paypalContact(done) };
  },

  async verifyWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>, credential: string): Promise<Record<string, unknown> | null> {
    const one = (k: string): string => {
      const v = headers[k] ?? headers[k.toLowerCase()];
      return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
    };
    const transmissionId = one('paypal-transmission-id');
    const transmissionSig = one('paypal-transmission-sig');
    // No signature headers at all means this did not come from PayPal's
    // webhook sender — the contract says return null rather than throw.
    if (!transmissionId || !transmissionSig) return null;

    // The webhook id is the third credential part; without it PayPal cannot be
    // asked to verify, and accepting an unverified body would let anyone mark
    // an order paid.
    const parts = credential.split(':');
    const webhookId = parts[3];
    if (!webhookId) throw new Error('PayPal webhook id is not configured — cannot verify this event.');

    const cred = parse(credential);
    const verdict = await pp<{ verification_status?: string }>(cred, '/v1/notifications/verify-webhook-signature', {
      method: 'POST',
      body: {
        auth_algo: one('paypal-auth-algo'),
        cert_url: one('paypal-cert-url'),
        transmission_id: transmissionId,
        transmission_sig: transmissionSig,
        transmission_time: one('paypal-transmission-time'),
        webhook_id: webhookId,
        webhook_event: JSON.parse(rawBody),
      },
    });
    if (verdict.verification_status !== 'SUCCESS') throw new Error('PayPal webhook signature did not verify.');
    return JSON.parse(rawBody) as Record<string, unknown>;
  },

  parseEvent(verified: Record<string, unknown>): PspWebhookEvent {
    const type = String(verified.event_type ?? '');
    const resource = (verified.resource ?? {}) as Record<string, unknown>;
    const KINDS: Record<string, string> = {
      'PAYMENT.CAPTURE.COMPLETED': 'payment.succeeded',
      'PAYMENT.CAPTURE.DENIED': 'payment.failed',
      'PAYMENT.CAPTURE.REFUNDED': 'payment.refunded',
      'PAYMENT.CAPTURE.REVERSED': 'payment.refunded',
      'CUSTOMER.DISPUTE.CREATED': 'dispute.opened',
      'CUSTOMER.DISPUTE.RESOLVED': 'dispute.lost',
    };
    // `custom_id` is the order id this store put on the purchase unit — the
    // only field on the event that is ours rather than the payer's.
    const links = Array.isArray(resource.links) ? resource.links as { rel: string; href: string }[] : [];
    const upLink = links.find((l) => l.rel === 'up')?.href ?? '';
    return {
      providerId: 'paypal',
      providerEventId: String(verified.id ?? ''),
      kind: KINDS[type] ?? type.toLowerCase(),
      paymentIntentId: (resource.custom_id ? String(resource.custom_id) : null)
        ?? (upLink.split('/').pop() || null),
      refundId: type.includes('REFUND') ? String(resource.id ?? '') : null,
      payload: verified,
    };
  },

  async intentStatus(intentId: string, credential: string): Promise<string> {
    const cred = parse(credential);
    const got = await pp<{ status: string }>(cred, `/v2/checkout/orders/${intentId}`);
    return mapStatus(got.status);
  },
};

/**
 * The gateway, as the contract sees it.
 *
 * `capture` is deliberately NOT on PaymentGateway — only redirect providers
 * need it, and widening the shared contract for one provider makes every other
 * gateway implement a method it has no use for. The return path imports
 * `capturePaypalOrder` directly instead.
 */
export const paypalGateway: PaymentGateway = gateway;

export const capturePaypalOrder = gateway.capture;

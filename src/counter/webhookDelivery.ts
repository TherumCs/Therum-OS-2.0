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

export interface WebhookEvent {
  topic: string;              // "order.created"
  resourceId: string;
  payload: unknown;
}

/**
 * Deliver one event to every active webhook subscribed to its topic.
 *
 * Never throws. An order must not fail because a partner's endpoint is down —
 * the delivery row records the failure and the order stands. Retries are
 * bounded and immediate-ish; a partner that is down for minutes needs the
 * replay endpoint, not an unbounded queue in the checkout path.
 */
export async function deliver(event: WebhookEvent): Promise<void> {
  const hooks = await db.storeWebhook.findMany({
    where: { topic: event.topic, status: 'active' },
  });
  if (!hooks.length) return;

  const body = JSON.stringify(event.payload);

  await Promise.all(
    hooks.map(async (hook) => {
      let secret: string;
      try {
        secret = decryptSecret(hook.secretEncrypted);
      } catch {
        await db.webhookDelivery.create({
          data: {
            webhookId: hook.id, topic: event.topic, resourceId: event.resourceId,
            error: 'secret could not be decrypted — re-register this webhook',
          },
        });
        return;
      }

      // Two attempts. The common failure is a cold serverless endpoint, which
      // the second call wakes; anything still failing needs a human, not a
      // third identical POST.
      for (let attempt = 1; attempt <= 2; attempt++) {
        const started = Date.now();
        try {
          const res = await fetch(hook.deliveryUrl, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'user-agent': 'TherumOS/1.0 Hookshot',
              // Identifies THIS store to the partner. An unset value is
              // better than another install's domain, which would make one
              // store's webhooks look like they came from another.
              'x-wc-webhook-source': process.env.PUBLIC_SITE_URL ?? '',
              'x-wc-webhook-topic': event.topic,
              'x-wc-webhook-resource': event.topic.split('.')[0] ?? '',
              'x-wc-webhook-event': event.topic.split('.')[1] ?? '',
              'x-wc-webhook-signature': sign(body, secret),
              'x-wc-webhook-id': hook.id,
            },
            body,
            signal: AbortSignal.timeout(TIMEOUT_MS),
          });
          await db.webhookDelivery.create({
            data: {
              webhookId: hook.id, topic: event.topic, resourceId: event.resourceId,
              responseCode: res.status, attempt, durationMs: Date.now() - started,
            },
          });
          if (res.ok) return;
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

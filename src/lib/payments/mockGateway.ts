import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { OrderForPayment, PaymentGateway, PaymentIntentResult, PspWebhookEvent } from './gateway.js';

// Full-contract mock (1.x MockGateway role): every capability, deterministic
// behavior, REAL signature verification (HMAC over raw body with the
// connection credential as secret) — so the webhook path is exercised
// end-to-end in tests, not stubbed. New providers must match this shape
// exactly (provisions doc rule).

const intents = new Map<string, string>(); // intentId -> status

export const mockGateway: PaymentGateway = {
  id: () => 'mock',
  displayName: () => 'Mock Gateway (testing)',
  supports: () => true,

  async createIntent(order: OrderForPayment): Promise<PaymentIntentResult> {
    const intentId = `mock_pi_${randomBytes(8).toString('hex')}`;
    intents.set(intentId, 'requires_action');
    return {
      providerId: 'mock',
      intentId,
      status: 'requires_action',
      clientSecret: `${intentId}_secret`,
      redirectUrl: null,
      extra: { orderNumber: order.number, amount: order.total },
    };
  },

  async refund(_order: OrderForPayment, amountMinor: number, idempotencyKey: string): Promise<string> {
    if (amountMinor <= 0) throw new Error('Mock: refund amount must be positive');
    // Deterministic on the idempotency key — a retried refund with the same
    // key yields the SAME provider refund id, mirroring real PSP dedupe.
    return `mock_re_${createHmac('sha256', 'mock-refund').update(idempotencyKey).digest('hex').slice(0, 16)}`;
  },

  async verifyWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>, credential: string): Promise<Record<string, unknown> | null> {
    const sig = headers['x-mock-signature'];
    if (!sig || typeof sig !== 'string') return null; // unsigned — provider may not sign
    const expected = createHmac('sha256', credential).update(rawBody).digest('hex');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new Error('Mock webhook signature mismatch');
    }
    return JSON.parse(rawBody) as Record<string, unknown>;
  },

  parseEvent(verified: Record<string, unknown>): PspWebhookEvent {
    return {
      providerId: 'mock',
      providerEventId: String(verified.event_id ?? ''),
      kind: String(verified.kind ?? 'unknown'),
      paymentIntentId: typeof verified.intent_id === 'string' ? verified.intent_id : null,
      refundId: typeof verified.refund_id === 'string' ? verified.refund_id : null,
      payload: verified,
    };
  },

  async intentStatus(intentId: string): Promise<string> {
    // Unknown intents read as unpaid (audit L-3 — reading unknown as
    // 'succeeded' would mark orders paid after a restart wiped the map).
    return intents.get(intentId) ?? 'requires_action';
  },
};

// Test helper: flip a mock intent's status (not part of the gateway contract).
export function _mockSetIntentStatus(intentId: string, status: string): void {
  intents.set(intentId, status);
}

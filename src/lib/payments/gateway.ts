// Counter's PSP gateway contract — ported 1:1 from 1.x PSPGateway.php
// (Therum OS/wordpress plugins/counter/includes/Payments/). Every payment
// provider implements this; checkout knows only this interface. Doctrine:
// NO check/eCheck gateway will ever implement this contract.

export interface PaymentIntentResult {
  providerId: string;
  intentId: string;
  // 'requires_action' | 'processing' | 'succeeded' | provider-specific
  status: string;
  // For client-side tokenization providers (Stripe/Square SDKs).
  clientSecret?: string | null;
  // For hosted-checkout / redirect providers (PayPal, BNPL, crypto).
  redirectUrl?: string | null;
  extra?: Record<string, unknown>;
}

// Canonical kinds (receivers ignore unknown): payment.succeeded,
// payment.failed, payment.refunded, refund.succeeded, refund.failed,
// dispute.opened, dispute.lost, dispute.won.
export interface PspWebhookEvent {
  providerId: string;
  providerEventId: string;
  kind: string;
  paymentIntentId?: string | null;
  refundId?: string | null;
  payload?: Record<string, unknown>;
}

export type GatewayCapability = 'refunds' | 'partial_refunds' | 'webhooks' | 'card' | 'wallet_apple' | 'wallet_google' | 'bnpl' | 'bank' | 'p2p' | 'crypto';

export interface OrderForPayment {
  id: string;
  number: string;
  total: number; // minor units
  currency: string;
}

export interface PaymentGateway {
  id(): string;
  displayName(): string;
  supports(capability: GatewayCapability): boolean;

  // Sync-ish; throws on failure. `credential` is the decrypted Nexus
  // connection credential for this provider (shape is provider-specific,
  // e.g. Stripe secret key, "Public:Private" for Braintree).
  createIntent(order: OrderForPayment, credential: string): Promise<PaymentIntentResult>;

  // Returns the provider's refund id. amount <= (total - refundedTotal),
  // enforced (atomically) by the service before this is called. ctx carries
  // what the provider needs beyond the order — typed, not smuggled through
  // casts (audit M-3).
  refund(order: OrderForPayment, amountMinor: number, idempotencyKey: string, credential: string, ctx: { intentId: string }): Promise<string>;

  // Returns the verified, parsed body; null when no signature present
  // (provider may not sign); THROWS on definite forgery.
  verifyWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>, credential: string): Promise<Record<string, unknown> | null>;

  parseEvent(verified: Record<string, unknown>): PspWebhookEvent;

  // Poll the provider for an intent's current status — the /checkout/return
  // path for redirect gateways (the endpoint 1.x never registered).
  intentStatus(intentId: string, credential: string): Promise<string>;
}

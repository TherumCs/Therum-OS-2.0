import { connectionService } from '../services/connection.service.js';
import { settingsService } from '../services/settings.service.js';
import type { TotalsLine } from './totalsPipeline.js';

// Shipping rates and tax AT CHECKOUT — before the order exists.
//
// This is the pre-order twin of shipmentService.recordQuote, which already
// records a provider's shipping and tax AFTER an order is split into
// shipments. That is the right shape for fulfillment, and the wrong time for a
// shopper: they have to see the shipping cost and pick a speed BEFORE they pay,
// or the total they agreed to is not the total they owe.
//
// TWO SOURCES, in this order:
//   1. A connected provider quotes real rates for this cart and address.
//   2. The rates configured in Counter settings.
//
// A provider that answers wins, because it knows the real parcel. A provider
// that is not connected, errors, or cannot quote this destination falls through
// to the configured rates rather than failing checkout — a store with no
// shipping options cannot sell anything, which is a worse failure than a rate
// that is approximate.

export interface ShipTo {
  name?: string;
  line1: string;
  line2?: string;
  city: string;
  region?: string;
  postalCode?: string;
  country: string;
}

export interface ShippingRate {
  /** Stable within a quote — what the shopper's choice refers to. */
  id: string;
  name: string;
  /** "5–7 business days · USPS Priority" — the second line in the picker. */
  detail: string;
  /** Minor units, like all money here. */
  amount: number;
  source: 'provider' | 'manual';
  provider?: string;
  /** Some providers return tax with the rate; null means "not quoted". */
  taxAmount?: number | null;
}

export interface RateRequest {
  lines: TotalsLine[];
  subtotal: number;
  currency: string;
  address: ShipTo;
}

export interface RateProvider {
  id: string;
  /** Empty array = "cannot quote this", not an error. */
  quote(req: RateRequest): Promise<ShippingRate[]>;
}

// ── Printful ──────────────────────────────────────────────────────────────
// Printful quotes per-destination rates from the real catalog items. It needs
// each line mapped to a Printful variant; until that mapping exists this
// returns nothing and the configured rates are used, which is honest — a rate
// invented for a POD parcel would be a number the store cannot honour.
const printful: RateProvider = {
  id: 'printful',
  async quote(req) {
    const key = await connectionService.credentialFor('printful');
    if (!key) return [];

    const items = req.lines
      .map((l) => {
        const variantId = Number((l as { sourceVariantId?: string }).sourceVariantId);
        return Number.isFinite(variantId) ? { variant_id: variantId, quantity: l.quantity } : null;
      })
      .filter((v): v is { variant_id: number; quantity: number } => v !== null);
    // No line maps to a Printful variant — nothing to quote against.
    if (items.length === 0) return [];

    try {
      const res = await fetch('https://api.printful.com/shipping/rates', {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          recipient: {
            address1: req.address.line1,
            city: req.address.city,
            country_code: req.address.country,
            ...(req.address.region ? { state_code: req.address.region } : {}),
            ...(req.address.postalCode ? { zip: req.address.postalCode } : {}),
          },
          items,
          currency: req.currency,
        }),
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) return [];
      const body = (await res.json()) as { result?: { id: string; name: string; rate: string; minDeliveryDays?: number; maxDeliveryDays?: number }[] };
      return (body.result ?? []).map((r) => ({
        id: `printful:${r.id}`,
        name: r.name,
        detail:
          r.minDeliveryDays && r.maxDeliveryDays
            ? `${r.minDeliveryDays}–${r.maxDeliveryDays} business days · Printful`
            : 'Printful',
        // Printful quotes a decimal string; everything here is minor units.
        amount: Math.round(Number(r.rate) * 100),
        source: 'provider' as const,
        provider: 'printful',
        taxAmount: null,
      }));
    } catch {
      // Timeout, network, or a shape we do not recognise. Fall through.
      return [];
    }
  },
};

const PROVIDERS: RateProvider[] = [printful];

/** What the operator configured, when no provider answers. */
interface ManualMethod {
  id: string;
  name: string;
  detail: string;
  amount: number;
  enabled: boolean;
}

export const shippingRateService = {
  /**
   * Rates for this cart and destination, provider first.
   *
   * Never throws for a provider's sake: checkout must always be able to offer
   * something.
   */
  async rates(req: RateRequest): Promise<ShippingRate[]> {
    for (const provider of PROVIDERS) {
      const quoted = await provider.quote(req).catch(() => []);
      if (quoted.length > 0) return quoted.sort((a, b) => a.amount - b.amount);
    }
    const counter = (await settingsService.getCounter()) as unknown as {
      shippingMethods?: ManualMethod[];
      freeShippingOver?: number;
    };
    const configured = (counter.shippingMethods ?? []).filter((m) => m.enabled !== false);
    const methods = configured.length > 0 ? configured : DEFAULT_METHODS;

    // A free-shipping threshold is the one rule common enough to be worth
    // holding here rather than making every operator edit rates by hand.
    const threshold = counter.freeShippingOver ?? 0;
    const qualifies = threshold > 0 && req.subtotal >= threshold;

    return methods
      .map((m) => ({
        id: m.id,
        name: m.name,
        detail: m.detail,
        amount: qualifies && m.amount > 0 && m.id === 'standard' ? 0 : m.amount,
        source: 'manual' as const,
        taxAmount: null,
      }))
      .sort((a, b) => a.amount - b.amount);
  },

  /** Tax for a cart, when no provider quoted one. */
  async tax(taxableBase: number): Promise<number> {
    const counter = (await settingsService.getCounter()) as unknown as { taxRatePct?: number };
    const pct = counter.taxRatePct ?? 0;
    if (!pct || pct <= 0) return 0;
    return Math.round(taxableBase * (pct / 100));
  },
};

// The shape a store starts with, matching the checkout preview
// (previews/checkout-experience.html). Operators override these in Counter
// settings; a connected provider overrides them entirely.
export const DEFAULT_METHODS: ManualMethod[] = [
  { id: 'standard', name: 'Standard', detail: '5–7 business days', amount: 0, enabled: true },
  { id: 'express', name: 'Express', detail: '2–3 business days', amount: 999, enabled: true },
  { id: 'overnight', name: 'Overnight', detail: 'Next business day', amount: 2499, enabled: true },
];

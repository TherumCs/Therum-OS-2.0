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
  source: 'provider' | 'manual' | 'zone' | 'pickup';
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
// Printful quotes per-destination rates from the real catalog items.
//
// /shipping/rates wants Printful's CATALOG variant id — NOT the sync_variant_id
// we store on the line (that one is only valid for /orders). Passing the sync id
// returns "Invalid variant ID" and the quote silently falls back to the manual
// rates, which is why real Printful rates never showed. Resolve sync → catalog
// once per variant and cache it, so a rate quote doesn't fan out to an extra API
// call per line on every address keystroke.
const printfulCatalogCache = new Map<number, number | null>();
async function printfulCatalogVariant(syncId: number, headers: Record<string, string>): Promise<number | null> {
  if (printfulCatalogCache.has(syncId)) return printfulCatalogCache.get(syncId)!;
  let id: number | null = null;
  try {
    const res = await fetch(`https://api.printful.com/sync/variant/${syncId}`, {
      headers,
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const j = (await res.json()) as { result?: { variant_id?: number; sync_variant?: { variant_id?: number } } };
      id = j.result?.variant_id ?? j.result?.sync_variant?.variant_id ?? null;
    }
  } catch {
    /* leave null — the manual rates cover it */
  }
  printfulCatalogCache.set(syncId, id);
  return id;
}

const printful: RateProvider = {
  id: 'printful',
  async quote(req) {
    const cred = await connectionService.credentialFor('printful');
    if (!cred) return [];
    // Credential is "token|storeId". The token ALONE is the Bearer, and a
    // multi-store token is refused without X-PF-Store-Id. Using the whole
    // credential as the token (the old bug) 401'd every call — so nothing quoted
    // and the manual rates always won.
    const [token, storeId] = cred.split('|');
    const headers: Record<string, string> = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    if (storeId) headers['X-PF-Store-Id'] = storeId;

    const items = (
      await Promise.all(
        req.lines.map(async (l) => {
          const syncId = Number((l as { sourceVariantId?: string }).sourceVariantId);
          if (!Number.isFinite(syncId)) return null;
          const variantId = await printfulCatalogVariant(syncId, headers);
          return variantId ? { variant_id: variantId, quantity: l.quantity } : null;
        }),
      )
    ).filter((v): v is { variant_id: number; quantity: number } => v !== null);
    // No line maps to a Printful variant — nothing to quote against.
    if (items.length === 0) return [];

    try {
      const res = await fetch('https://api.printful.com/shipping/rates', {
        method: 'POST',
        headers,
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

/** What the operator configured. `prices` is per-zone; legacy `amount` (flat)
 *  is still read for the rest zone. */
interface ManualMethod {
  id: string;
  name: string;
  detail: string;
  prices?: Record<string, number>;
  amount?: number;
  freeOver?: number | null;
  enabled: boolean;
}

interface Zone { id: string; name: string; states: string[]; isRest?: boolean }

/** A US state code → its zone, falling back to the `isRest` catch-all so a
 *  destination can never resolve to nothing. */
function resolveZone(state: string, zones: Zone[]): Zone {
  const s = (state || '').toUpperCase().trim();
  return zones.find((z) => !z.isRest && z.states.includes(s))
      ?? zones.find((z) => z.isRest)
      ?? zones[0]
      ?? { id: 'rest', name: 'Rest of US', states: [], isRest: true };
}

export const shippingRateService = {
  /**
   * Rates for this cart and destination, provider first.
   *
   * Never throws for a provider's sake: checkout must always be able to offer
   * something.
   */
  async rates(req: RateRequest): Promise<ShippingRate[]> {
    const counter = (await settingsService.getCounter()) as unknown as {
      shippingMethods?: ManualMethod[];
      shippingZones?: Zone[];
      pickup?: { enabled: boolean; price: number; address: string; note: string; slots?: { id: string; name: string; detail: string }[] };
      freeShippingOver?: number;
    };
    const zones = counter.shippingZones && counter.shippingZones.length > 0
      ? counter.shippingZones
      : [{ id: 'rest', name: 'Rest of US', states: [], isRest: true }];
    const zone = resolveZone(req.address?.region ?? '', zones);
    const out: ShippingRate[] = [];

    // (a) SINGLE-VENDOR provider rates come FIRST and, when they answer, REPLACE
    //     our zone methods rather than sit beside them. The hybrid rule Bam set:
    //     a cart that ships entirely from ONE connected vendor is quoted at that
    //     vendor's real rates; a mixed or in-house cart falls to our internal
    //     zone rates. Offering both would let the shopper pick our free Standard
    //     on a cart we actually pay a vendor to ship — undercharging by design.
    const vendors = new Set(
      req.lines.map((l) => (l as unknown as { vendor?: string }).vendor).filter(Boolean) as string[],
    );
    const allOneVendor = vendors.size === 1 && req.lines.every((l) => (l as unknown as { vendor?: string }).vendor);
    if (allOneVendor) {
      const only = [...vendors][0];
      for (const provider of PROVIDERS) {
        if (provider.id !== only) continue;
        const quoted = await provider.quote(req).catch(() => []);
        for (const q of quoted) out.push({ ...q, id: `provider:${q.id}`, source: 'provider' });
      }
    }

    // (b) OUR zone methods — the fallback whenever no provider quoted (mixed
    //     cart, in-house line, or a single vendor that is unconnected, slow, or
    //     could not price this destination). A store must always offer SOMETHING,
    //     so an empty provider result never means "no shipping". Price is
    //     per-zone; a method with no price for this zone is simply not offered.
    if (out.length === 0) {
      const configured = (counter.shippingMethods ?? []).filter((m) => m.enabled !== false);
      const methods = configured.length > 0 ? configured : DEFAULT_METHODS;
      const globalFreeOver = counter.freeShippingOver ?? 0;
      for (const m of methods) {
        const base = m.prices ? m.prices[zone.id] : (zone.isRest ? m.amount : undefined);
        if (base == null) continue;
        const methodFree = m.freeOver ?? (globalFreeOver > 0 && m.id === 'standard' ? globalFreeOver : null);
        const isFree = methodFree != null && methodFree > 0 && req.subtotal >= methodFree;
        out.push({ id: `zone:${m.id}`, name: m.name, detail: m.detail, amount: isFree ? 0 : base, source: 'zone', taxAmount: null });
      }
    }

    // (c) LOCAL PICKUP — independent of the delivery source: if pickup is on and
    //     every line is eligible, it stands alongside whatever rates were offered.
    //     If pk.slots has entries, emit one option per slot (each slot renders
    //     as its own selectable shipping method at checkout).
    const pk = counter.pickup;
    if (pk?.enabled && req.lines.length > 0 && req.lines.every((l) => (l as unknown as { pickupEligible?: boolean }).pickupEligible)) {
      const slots = Array.isArray(pk.slots) ? pk.slots : [];
      if (slots.length > 0) {
        for (const s of slots) out.push({ id: `pickup:${s.id}`, name: s.name, detail: s.detail || pk.address || 'Collect in person', amount: pk.price, source: 'pickup', taxAmount: null });
      } else {
        out.push({ id: 'pickup', name: 'Local pickup', detail: pk.note || pk.address || 'Collect in person', amount: pk.price, source: 'pickup', taxAmount: null });
      }
    }

    return out.sort((a, b) => a.amount - b.amount);
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

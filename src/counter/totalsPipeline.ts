// Counter — cart totals pipeline.
//
// Ported from Counter 0.45's Pipelines/CartTotalsPipeline.php. One ordered list
// of steps, each mutating a shared context. The pipeline is the ONLY thing that
// computes totals — cart, checkout and every REST handler go through it.
//
// Why this rather than the inline arithmetic it replaces: totals are where
// commerce bugs live, and they are order-dependent. Discount before or after
// tax? Shipping on the discounted subtotal or the gross? With inline maths that
// order is implicit in whatever sequence someone happened to write, and it
// drifts the moment a second caller computes totals slightly differently.
// Here the order IS the list below, in one place, and a new concern is a step
// rather than an edit to arithmetic that already works.
//
// This is deliberately NOT Woo's filter chain. `woocommerce_calculated_total`
// and friends let any plugin rewrite the number with a priority integer and no
// type checking; debugging a wrong total means bisecting hook priorities.
// A step here declares what it needs and what it sets.

export interface TotalsLine {
  itemId: string;
  productId: string;
  variantId: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  vendorId?: string | null;
  /** Fulfilment provider that ships this line ('printful'…). Drives the
   *  single-vendor rule in shippingRates: real provider rates are only offered
   *  when the WHOLE cart is one vendor. Null = in-house, which withholds them. */
  vendor?: string | null;
  /** This line can be collected in person. Local pickup is offered only when
   *  every line is eligible. */
  pickupEligible?: boolean;
  /** The provider's own variant id (Printful sync_variant_id) — what a rate
   *  quote is keyed on, distinct from our internal variantId. */
  sourceVariantId?: string | null;
}

/** Shared, mutable across the run — steps read what earlier steps wrote. */
export interface TotalsContext {
  currency: string;
  lines: TotalsLine[];
  subtotal: number;
  /** Single largest discount — see MemberDiscountStep on why these don't stack. */
  discount: { amount: number; label: string } | null;
  shipping: number;
  tax: number;
  total: number;
  /** Steps append here rather than throwing — a bad coupon shouldn't 500 a cart. */
  notices: { code: string; message: string }[];
}

export interface TotalsStep {
  readonly name: string;
  run(ctx: TotalsContext): void | Promise<void>;
}

export class TotalsPipeline {
  constructor(private readonly steps: TotalsStep[]) {}

  async run(ctx: TotalsContext): Promise<TotalsContext> {
    for (const step of this.steps) {
      await step.run(ctx);
    }
    return ctx;
  }

  /** Introspection for tests and the admin — order is the contract. */
  get order(): string[] {
    return this.steps.map((s) => s.name);
  }
}

// ─── Steps ─────────────────────────────────────────────────────────────────

/** Sum of line totals. Everything downstream builds on this. */
export const subtotalStep: TotalsStep = {
  name: 'subtotal',
  run(ctx) {
    ctx.subtotal = round(ctx.lines.reduce((sum, l) => sum + l.lineTotal, 0));
  },
};

/**
 * Discounts apply to the subtotal, before shipping and tax. Only the single
 * largest applies — Counter's doctrine, carried over deliberately: stacking is
 * how a storefront gets given away by accident, and "why was this order 80%
 * off" is not a debugging session anyone wants.
 */
export function discountStep(candidates: { amount: number; label: string }[]): TotalsStep {
  return {
    name: 'discount',
    run(ctx) {
      if (candidates.length === 0) {
        ctx.discount = null;
        return;
      }
      const best = candidates.reduce((a, b) => (b.amount > a.amount ? b : a));
      // Never discount below zero, whatever a coupon claims.
      ctx.discount = { ...best, amount: round(Math.min(best.amount, ctx.subtotal)) };
    },
  };
}

/** Provider slot. Real quotes arrive via Nexus; zero until then. */
export const shippingStep: TotalsStep = {
  name: 'shipping',
  run(ctx) {
    ctx.shipping = round(ctx.shipping);
  },
};

/** Provider slot, same as shipping. Tax is computed on the DISCOUNTED base. */
export const taxStep: TotalsStep = {
  name: 'tax',
  run(ctx) {
    ctx.tax = round(ctx.tax);
  },
};

/**
 * Grand total, and the only place rounding is final. Steps above round their
 * own field so a half-cent can't compound through the chain, but the total is
 * computed from the rounded parts — so the number a customer sees is exactly
 * the sum of the numbers a customer sees. Woo's classic complaint is a total
 * that is a penny off the visible line items; that comes from rounding once at
 * the end over unrounded intermediates.
 */
export const totalStep: TotalsStep = {
  name: 'total',
  run(ctx) {
    const discounted = ctx.subtotal - (ctx.discount?.amount ?? 0);
    ctx.total = round(Math.max(0, discounted) + ctx.shipping + ctx.tax);
  },
};

/**
 * Money in this schema is INTEGER MINOR UNITS (cents), so this is a no-op on
 * well-formed input — it exists to stop a provider that hands back a
 * fractional cent (percentage tax, split shipping) from compounding a
 * half-cent through the chain.
 */
function round(n: number): number {
  // Whole minor units — NOT 2dp. Values here are already cents, so rounding to
  // 2 decimal places would happily preserve a fractional cent (1999.5) and put
  // it in an Int column.
  return Math.round(n + Number.EPSILON);
}

/**
 * The default order. Read it top to bottom — that is the answer to every
 * "is tax before or after the discount" question.
 */
export function defaultPipeline(discounts: { amount: number; label: string }[] = []): TotalsPipeline {
  return new TotalsPipeline([subtotalStep, discountStep(discounts), shippingStep, taxStep, totalStep]);
}

/** Empty context for a set of lines. */
export function contextFor(lines: TotalsLine[], currency: string): TotalsContext {
  return { currency, lines, subtotal: 0, discount: null, shipping: 0, tax: 0, total: 0, notices: [] };
}

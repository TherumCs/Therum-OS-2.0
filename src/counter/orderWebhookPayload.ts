import { toMajor } from './currency.js';

// The order as a fulfilment partner needs to receive it.
//
// Deliberately NOT the shape the /wc/v3/orders list endpoint returns: that one
// omits the shipping address entirely, which is fine for a sales report and
// useless for printing a label. A partner receiving order.created has to be
// able to ship it without asking a second question.
//
// Woo's field names throughout, because a partner's existing parser expects
// billing/shipping objects and line_items with sku + quantity.

interface ShipAddress {
  name?: string; line1?: string; line2?: string;
  city?: string; region?: string; postalCode?: string; country?: string;
}

interface OrderLike {
  id: string;
  number: string;
  status: string;
  currency: string;
  total: number;
  shippingTotal?: number;
  taxTotal?: number;
  discountAmount?: number;
  guestEmail?: string | null;
  shippingMethod?: string | null;
  shipAddress?: unknown;
  createdAt: Date;
  customer?: { email?: string | null; name?: string | null } | null;
  items: {
    id: string;
    quantity: number;
    priceAtTime: number;
    variantId?: string | null;
    variant?: {
      id: string; sku?: string | null; color?: string | null; size?: string | null;
      product?: { id: string; name: string } | null;
    } | null;
  }[];
}

export function orderWebhookPayload(o: OrderLike): Record<string, unknown> {
  const currency = o.currency || 'USD';
  const a = (o.shipAddress ?? {}) as ShipAddress;
  const email = o.customer?.email ?? o.guestEmail ?? '';

  // Woo splits a single name field into first/last; partners read both.
  const full = (a.name ?? o.customer?.name ?? '').trim();
  const [first, ...rest] = full.split(/\s+/);

  const address = {
    first_name: first ?? '',
    last_name: rest.join(' '),
    address_1: a.line1 ?? '',
    address_2: a.line2 ?? '',
    city: a.city ?? '',
    state: a.region ?? '',
    postcode: a.postalCode ?? '',
    country: a.country ?? '',
  };

  return {
    id: o.id,
    number: o.number,
    status: o.status,
    currency,
    date_created: o.createdAt.toISOString(),
    total: String(toMajor(o.total, currency)),
    shipping_total: String(toMajor(o.shippingTotal ?? 0, currency)),
    total_tax: String(toMajor(o.taxTotal ?? 0, currency)),
    discount_total: String(toMajor(o.discountAmount ?? 0, currency)),
    billing: { ...address, email },
    shipping: address,
    shipping_lines: o.shippingMethod
      ? [{ method_id: o.shippingMethod, method_title: o.shippingMethod }]
      : [],
    line_items: o.items.map((i) => ({
      id: i.id,
      name: i.variant?.product?.name ?? 'Item',
      product_id: i.variant?.product?.id ?? null,
      variation_id: i.variantId ?? null,
      quantity: i.quantity,
      sku: i.variant?.sku ?? '',
      price: String(toMajor(i.priceAtTime, currency)),
      total: String(toMajor(i.priceAtTime * i.quantity, currency)),
      // A POD partner prints on a specific colourway; SKU alone often is not
      // enough to pick the right blank.
      meta_data: [
        ...(i.variant?.color ? [{ key: 'color', value: i.variant.color }] : []),
        ...(i.variant?.size ? [{ key: 'size', value: i.variant.size }] : []),
      ],
    })),
  };
}

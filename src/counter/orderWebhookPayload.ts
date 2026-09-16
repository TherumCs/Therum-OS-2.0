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
  city?: string; region?: string; postalCode?: string; country?: string; phone?: string;
}

interface OrderLike {
  id: string;
  wooId?: number | null;
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
  updatedAt?: Date;
  customer?: { email?: string | null; name?: string | null } | null;
  items: {
    id: string;
    quantity: number;
    priceAtTime: number;
    variantId?: string | null;
    variant?: {
      id: string; wooId?: number | null; sku?: string | null; color?: string | null; size?: string | null;
      product?: { id: string; wooId?: number | null; name: string; image?: string | null } | null;
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

  // Shoppers type "Pa" / "pa" / "Pennsylvania"; a real Woo store stores the
  // ISO code ("PA") and strict receivers validate against it. Order 100074
  // carried "Pa" and never appeared on PodPluser while "PA" orders did.
  const country = (a.country ?? '').trim().toUpperCase();
  const region = (a.region ?? '').trim();
  const state = /^[A-Za-z]{2}$/.test(region) ? region.toUpperCase() : region;
  // Woo always ships the phone; a POD partner needs it for the carrier label.
  const phone = (a.phone ?? '').replace(/[^\d+]/g, '');

  const address = {
    first_name: first ?? '',
    last_name: rest.join(' '),
    address_1: a.line1 ?? '',
    address_2: a.line2 ?? '',
    city: a.city ?? '',
    state,
    postcode: a.postalCode ?? '',
    country,
  };

  // The order `id` MUST be the integer WooCommerce id. A partner's Woo parser
  // treats id as an int (dedup key, order lookup); our cuid made a strict
  // receiver reject the whole order before matching a single line — which is
  // why the response was an identical {code:200,data:null} no matter what the
  // line items said. Line-item ids are derived from it so they are ints too.
  const orderId = o.wooId ?? 0;

  // Byte-shape fidelity to a REAL WooCommerce 10.x payload (captured from the
  // reference store's RestApiUtil output for a live order). Strict partner
  // parsers (Go/Java) reject deviations the human eye forgives:
  //  - dates are `YYYY-MM-DDTHH:MM:SS` — NO milliseconds, NO trailing Z
  //  - money strings always carry two decimals ("120.00", never "120")
  //  - `number` is digits-only (Woo's is the post id); our SMNY ref rides in
  //    order_key instead so traceability survives
  //  - line meta is the attribute-taxonomy pair: key "pa_color", value = slug,
  //    display_key/display_value = human names (how the partner's own product
  //    push shaped the attributes it will match against)
  const wooDate = (d: Date) => d.toISOString().slice(0, 19);
  const money = (minor: number) => toMajor(minor, currency).toFixed(2);
  const lineTotal = (i: OrderLike['items'][number]) => money(i.priceAtTime * i.quantity);
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const created = wooDate(o.createdAt);
  const modified = wooDate(o.updatedAt ?? o.createdAt);

  // Payment-dependent fields must reflect REAL state, not be hardcoded paid.
  // order.created fires on a PENDING (unpaid) order, so emitting date_paid +
  // needs_payment:false there told a partner that gates on those fields to
  // fulfil an unpaid/abandoned cart (audit). Internal statuses shipped/delivered
  // are not valid WooCommerce statuses either — a strict partner parser rejects
  // them — so map to the Woo enum (completed).
  const isPaid = o.status === 'processing' || o.status === 'shipped' || o.status === 'delivered';
  const isCompleted = o.status === 'shipped' || o.status === 'delivered';
  const wooStatus = isCompleted ? 'completed' : o.status; // pending/processing/cancelled/failed pass through as-is (all valid Woo)
  const completedAt = isCompleted ? modified : null;
  const paidAt = isPaid ? created : null;

  return {
    id: orderId,
    parent_id: 0,
    status: wooStatus,
    currency,
    version: '10.4.3',
    prices_include_tax: false,
    date_created: created,
    date_modified: modified,
    discount_total: money(o.discountAmount ?? 0),
    discount_tax: '0.00',
    shipping_total: money(o.shippingTotal ?? 0),
    shipping_tax: '0.00',
    cart_tax: '0.00',
    total: money(o.total),
    total_tax: money(o.taxTotal ?? 0),
    customer_id: 0,
    order_key: `wc_order_${o.number}`,
    billing: { ...address, email, phone },
    shipping: { ...address, phone },
    payment_method: 'therum',
    payment_method_title: 'Card',
    transaction_id: '',
    customer_ip_address: '',
    customer_user_agent: '',
    created_via: 'store-api',
    customer_note: '',
    date_completed: completedAt,
    date_paid: paidAt,
    cart_hash: '',
    number: String(orderId),
    meta_data: [] as unknown[],
    // product_id / variation_id MUST be the integer WooCommerce ids (wooId) the
    // partner stored at catalogue sync — NOT our internal cuid.
    line_items: o.items.map((i, idx) => ({
      id: orderId * 1000 + idx + 1,
      name: i.variant?.product?.name ?? 'Item',
      product_id: i.variant?.product?.wooId ?? 0,
      variation_id: i.variant?.wooId ?? 0,
      quantity: i.quantity,
      tax_class: '',
      subtotal: lineTotal(i),
      subtotal_tax: '0.00',
      total: lineTotal(i),
      total_tax: '0.00',
      taxes: [] as unknown[],
      meta_data: [
        ...(i.variant?.color ? [{ id: orderId * 1000 + idx + 1, key: 'pa_color', value: slug(i.variant.color), display_key: 'color', display_value: i.variant.color }] : []),
        ...(i.variant?.size ? [{ id: orderId * 1000 + idx + 501, key: 'pa_size', value: slug(i.variant.size), display_key: 'size', display_value: i.variant.size }] : []),
      ],
      sku: i.variant?.sku ?? '',
      global_unique_id: '',
      price: toMajor(i.priceAtTime, currency),
      image: { id: 0, src: i.variant?.product?.image ?? '' },
      parent_name: (i.variant?.wooId ?? 0) > 0 ? (i.variant?.product?.name ?? null) : null,
    })),
    tax_lines: [] as unknown[],
    shipping_lines: o.shippingMethod
      ? [{ id: orderId * 1000 + 900, method_title: o.shippingMethod, method_id: o.shippingMethod, instance_id: '', total: money(o.shippingTotal ?? 0), total_tax: '0.00', taxes: [] as unknown[], tax_status: 'taxable', meta_data: [] as unknown[] }]
      : [],
    fee_lines: [] as unknown[],
    coupon_lines: [] as unknown[],
    refunds: [] as unknown[],
    payment_url: '',
    is_editable: false,
    needs_payment: !isPaid,
    needs_processing: o.status === 'processing',
    date_created_gmt: created,
    date_modified_gmt: modified,
    date_completed_gmt: completedAt,
    date_paid_gmt: paidAt,
    currency_symbol: currency === 'USD' ? '$' : currency,
  };
}

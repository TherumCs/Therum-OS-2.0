import { formatMoney } from '../counter/currency.js';
import { db } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { notificationService } from './notification.service.js';
import { settingsService } from './settings.service.js';
import { orderEmailHtml, shippedEmailHtml, messageEmailHtml, type OrderEmailRow } from './emailTemplate.js';
import { carrierName, trackingUrl } from '../counter/carriers.js';
import { esc } from '../site/html.js';

// Counter C6 — customer emails: order receipt on confirmed payment, refund
// notice on confirmed full refund. Plain text (deliverability > design for
// v1; templated HTML rides the future theme system). Best-effort: called
// fire-and-forget from the payment webhook path — a dead SMTP box must
// never fail or slow a webhook ack.

// Was hardcoded 'en-US' and a /100 that is wrong for zero-decimal currencies
// like JPY. formatMoney knows each currency's real minor-unit count.
const money = (minor: number, currency: string): string => formatMoney(minor, currency);

async function orderWithItems(orderId: string) {
  return db.order.findUnique({
    where: { id: orderId },
    include: { items: { include: { variant: { include: { product: { select: { name: true, image: true } } } } } }, customer: { select: { email: true } } },
  });
}

function receiptLines(order: NonNullable<Awaited<ReturnType<typeof orderWithItems>>>): string {
  const lines = order.items.map((i) => {
    const name = i.variant?.product?.name ?? 'Item';
    const sku = i.variant?.sku ? ` (${i.variant.sku})` : '';
    return `  ${i.quantity} × ${name}${sku} — ${money(i.priceAtTime * i.quantity, order.currency)}`;
  });
  if (order.discountAmount > 0) lines.push(`  ${order.discountLabel ?? 'Discount'} — −${money(order.discountAmount, order.currency)}`);
  // Shipping and tax are part of what was charged, so the receipt has to show
  // them: without these the items sum to one number and Total shows another,
  // and the customer has no way to see why.
  if (order.shippingTotal > 0) {
    const method = order.shippingMethod ? ` (${order.shippingMethod})` : '';
    lines.push(`  Shipping${method} — ${money(order.shippingTotal, order.currency)}`);
  }
  if (order.taxTotal > 0) lines.push(`  Tax — ${money(order.taxTotal, order.currency)}`);
  lines.push(`  Total — ${money(order.total, order.currency)}`);
  return lines.join('\n');
}

// Same figures as receiptLines, structured for the HTML shell (label/value
// rows; the shell renders the total on its own line). One builder so the plain
// text and the branded HTML can never drift apart.
function orderRows(order: NonNullable<Awaited<ReturnType<typeof orderWithItems>>>): OrderEmailRow[] {
  const rows: OrderEmailRow[] = order.items.map((i) => ({
    label: `${i.quantity} × ${i.variant?.product?.name ?? 'Item'}`,
    value: money(i.priceAtTime * i.quantity, order.currency),
    img: i.variant?.product?.image ?? undefined,
    meta: [i.variant?.color, i.variant?.size].filter(Boolean).join(' · ') || undefined,
  }));
  if (order.discountAmount > 0) rows.push({ label: order.discountLabel ?? 'Discount', value: `−${money(order.discountAmount, order.currency)}`, muted: true });
  if (order.shippingTotal > 0) rows.push({ label: `Shipping${order.shippingMethod ? ` (${order.shippingMethod})` : ''}`, value: money(order.shippingTotal, order.currency), muted: true });
  if (order.taxTotal > 0) rows.push({ label: 'Tax', value: money(order.taxTotal, order.currency), muted: true });
  return rows;
}

export const commerceEmailService = {
  // Fired when a payment is CONFIRMED (payment.succeeded applied).
  async sendReceipt(orderId: string, origin: string | null): Promise<void> {
    try {
      const order = await orderWithItems(orderId);
      if (!order) return;
      // Receipt goes to the checkout email, or — when the shopper left it blank
      // but is a logged-in customer — their account email. Only a truly
      // address-less (admin-created) order sends nothing.
      const to = order.guestEmail ?? order.customer?.email ?? null;
      if (!to) return;
      const site = await settingsService.getSite();
      const orderUrl = origin && order.accessToken
        ? `${origin}/order-received/?order=${encodeURIComponent(order.number)}&token=${encodeURIComponent(order.accessToken)}`
        : null;
      const receiptUrl = orderUrl ? `\n\nView your order: ${orderUrl}` : '';
      const html = orderEmailHtml({
        heading: 'Thanks for your order',
        intro: 'Your payment is confirmed — here is your receipt.',
        rows: orderRows(order),
        total: money(order.total, order.currency),
        orderNumber: order.number,
        siteName: site.siteName,
        cta: orderUrl ? { label: 'View your order', url: orderUrl } : undefined,
        footnote: 'Screenshot this or open your order any time.',
      });
      await notificationService.sendToAddress(
        to,
        `${site.siteName} — order ${order.number} confirmed`,
        `Thanks for your order!\n\nOrder ${order.number}\n\n${receiptLines(order)}${receiptUrl}\n\n— ${site.siteName}`,
        html,
      );
    } catch (err) {
      logger.warn({ err, orderId }, 'receipt email failed (non-fatal)');
    }
  },

  // Fired alongside the receipt: tells the STORE OWNER a sale landed, so orders
  // never depend on someone watching the dashboard. Goes to the admin email;
  // best-effort like the receipt (a dead SMTP box must not fail the webhook).
  async notifyAdminNewOrder(orderId: string, origin: string | null): Promise<void> {
    try {
      const n = await settingsService.getNotifications();
      if (!n.adminEmail) return;
      const order = await orderWithItems(orderId);
      if (!order) return;
      const site = await settingsService.getSite();
      const who = order.guestEmail ? `\nCustomer: ${order.guestEmail}` : '';
      const adminLink = origin ? `\n\nOpen it: ${origin}/counter` : '';
      const html = orderEmailHtml({
        heading: 'New order',
        intro: order.guestEmail ? `${order.guestEmail} just placed an order.` : 'A new order just landed.',
        rows: orderRows(order),
        total: money(order.total, order.currency),
        orderNumber: order.number,
        siteName: site.siteName,
        cta: origin ? { label: 'Open in admin', url: `${origin}/counter` } : undefined,
      });
      await notificationService.sendToAddress(
        n.adminEmail,
        `New order ${order.number} — ${money(order.total, order.currency)}`,
        `You got an order on ${site.siteName}.\n\nOrder ${order.number}${who}\n\n${receiptLines(order)}${adminLink}`,
        html,
      );
    } catch (err) {
      logger.warn({ err, orderId }, 'admin new-order email failed (non-fatal)');
    }
  },

  // Fired when succeeded refunds cover the whole order (confirmed path).
  async sendRefundNotice(orderId: string): Promise<void> {
    try {
      const order = await orderWithItems(orderId);
      if (!order?.guestEmail) return;
      const site = await settingsService.getSite();
      const html = orderEmailHtml({
        heading: 'Refund issued',
        intro: 'Your refund is on its way — it typically appears in 5–10 business days depending on your bank.',
        rows: [{ label: 'Refunded in full', value: money(order.refundedTotal, order.currency) }],
        total: money(order.refundedTotal, order.currency),
        orderNumber: order.number,
        siteName: site.siteName,
      });
      await notificationService.sendToAddress(
        order.guestEmail,
        `${site.siteName} — order ${order.number} refunded`,
        `Your order ${order.number} has been refunded in full (${money(order.refundedTotal, order.currency)}).\nRefunds typically appear within 5–10 business days depending on your bank.\n\n— ${site.siteName}`,
        html,
      );
    } catch (err) {
      logger.warn({ err, orderId }, 'refund-notice email failed (non-fatal)');
    }
  },

  // Fired when a shipment is marked shipped (carrier + tracking captured).
  async sendShippedNotice(shipmentId: string): Promise<void> {
    try {
      const shipment = await db.orderShipment.findUnique({
        where: { id: shipmentId },
        select: {
          trackingCarrier: true, trackingNumber: true,
          order: {
            select: {
              guestEmail: true, number: true, currency: true,
              items: { include: { variant: { include: { product: { select: { name: true, image: true } } } } } },
            },
          },
        },
      });
      const order = shipment?.order;
      if (!order?.guestEmail || !shipment?.trackingNumber) return; // nothing to send to / not really shipped
      const site = await settingsService.getSite();
      const storeOrigin = process.env.PUBLIC_ORIGIN?.replace(/\/+$/, '') || '';
      const url = trackingUrl(shipment.trackingCarrier, shipment.trackingNumber) ?? (storeOrigin ? `${storeOrigin}/account` : '');
      const carrier = carrierName(shipment.trackingCarrier) ?? shipment.trackingCarrier ?? 'Carrier';
      const html = shippedEmailHtml({
        carrier,
        tracking: shipment.trackingNumber,
        trackingUrl: url,
        items: order.items.map((i) => ({
          img: i.variant?.product?.image ?? undefined,
          name: i.variant?.product?.name ?? 'Item',
          meta: [i.variant?.color, i.variant?.size].filter(Boolean).join(' · ') || undefined,
          value: money(i.priceAtTime * i.quantity, order.currency),
        })),
        siteName: site.siteName,
      });
      await notificationService.sendToAddress(
        order.guestEmail,
        `${site.siteName} — order ${order.number} shipped`,
        `Your order ${order.number} has shipped.\n\n${carrier} ${shipment.trackingNumber}\nTrack it: ${url}\n\n— ${site.siteName}`,
        html,
      );
    } catch (err) {
      logger.warn({ err, shipmentId }, 'shipped-notice email failed (non-fatal)');
    }
  },

  // Fired when a shipment is marked delivered.
  async sendDeliveredNotice(shipmentId: string): Promise<void> {
    try {
      const shipment = await db.orderShipment.findUnique({
        where: { id: shipmentId },
        select: { order: { select: { guestEmail: true, number: true } } },
      });
      const order = shipment?.order;
      if (!order?.guestEmail) return;
      const site = await settingsService.getSite();
      const html = messageEmailHtml({
        eyebrow: 'Delivered', heading: 'Your order arrived.',
        paragraphs: [
          `Order ${esc(order.number)} was just marked delivered. We hope it lands exactly right.`,
          `Tag us when you wear it &mdash; and thank you for shopping ${esc(site.siteName)}.`,
        ],
        cta: { label: 'View your order', url: `${process.env.PUBLIC_ORIGIN || ''}/account` },
        siteName: site.siteName,
      });
      await notificationService.sendToAddress(
        order.guestEmail,
        `${site.siteName} — order ${order.number} delivered`,
        `Your order ${order.number} was delivered. Thank you for shopping ${site.siteName}.`,
        html,
      );
    } catch (err) {
      logger.warn({ err, shipmentId }, 'delivered-notice email failed (non-fatal)');
    }
  },
};


// ── Sales reporting (C6) ────────────────────────────────────────────────

export const salesReportService = {
  // Rolling-window sales summary from PAID orders (processing and beyond —
  // pending never counts as revenue; fully-refunded orders are surfaced in
  // the refund figures, not silently dropped).
  async summary(days: number) {
    const since = new Date(Date.now() - days * 86_400_000);
    const paidStatuses = ['processing', 'shipped', 'delivered', 'cancelled'] as const;
    const orders = await db.order.findMany({
      where: { createdAt: { gte: since }, status: { in: [...paidStatuses] }, payment: { status: 'paid' } },
      select: {
        id: true, total: true, refundedTotal: true, discountAmount: true, currency: true, createdAt: true,
        items: { select: { quantity: true, priceAtTime: true, variant: { select: { sku: true, product: { select: { id: true, name: true } } } } } },
      },
    });

    const gross = orders.reduce((s, o) => s + o.total, 0);
    const refunded = orders.reduce((s, o) => s + o.refundedTotal, 0);
    const discounts = orders.reduce((s, o) => s + o.discountAmount, 0);

    // Top products by units + revenue.
    const byProduct = new Map<string, { name: string; units: number; revenue: number }>();
    for (const o of orders) {
      for (const i of o.items) {
        const key = i.variant?.product?.id ?? 'unknown';
        const cur = byProduct.get(key) ?? { name: i.variant?.product?.name ?? 'Unknown', units: 0, revenue: 0 };
        cur.units += i.quantity;
        cur.revenue += i.priceAtTime * i.quantity;
        byProduct.set(key, cur);
      }
    }
    const topProducts = [...byProduct.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 10);

    // Daily buckets for the chart.
    const byDay = new Map<string, { orders: number; gross: number }>();
    for (const o of orders) {
      const day = o.createdAt.toISOString().slice(0, 10);
      const cur = byDay.get(day) ?? { orders: 0, gross: 0 };
      cur.orders += 1;
      cur.gross += o.total;
      byDay.set(day, cur);
    }

    return {
      windowDays: days,
      orderCount: orders.length,
      gross,
      refunded,
      net: gross - refunded,
      discounts,
      averageOrder: orders.length ? Math.round(gross / orders.length) : 0,
      topProducts,
      daily: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, ...v })),
    };
  },
};

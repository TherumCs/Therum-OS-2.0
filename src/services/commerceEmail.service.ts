import { db } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { notificationService } from './notification.service.js';
import { settingsService } from './settings.service.js';

// Counter C6 — customer emails: order receipt on confirmed payment, refund
// notice on confirmed full refund. Plain text (deliverability > design for
// v1; templated HTML rides the future theme system). Best-effort: called
// fire-and-forget from the payment webhook path — a dead SMTP box must
// never fail or slow a webhook ack.

const money = (minor: number, currency: string): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(minor / 100);

async function orderWithItems(orderId: string) {
  return db.order.findUnique({
    where: { id: orderId },
    include: { items: { include: { variant: { include: { product: { select: { name: true } } } } } } },
  });
}

function receiptLines(order: NonNullable<Awaited<ReturnType<typeof orderWithItems>>>): string {
  const lines = order.items.map((i) => {
    const name = i.variant?.product?.name ?? 'Item';
    const sku = i.variant?.sku ? ` (${i.variant.sku})` : '';
    return `  ${i.quantity} × ${name}${sku} — ${money(i.priceAtTime * i.quantity, order.currency)}`;
  });
  if (order.discountAmount > 0) lines.push(`  ${order.discountLabel ?? 'Discount'} — −${money(order.discountAmount, order.currency)}`);
  lines.push(`  Total — ${money(order.total, order.currency)}`);
  return lines.join('\n');
}

export const commerceEmailService = {
  // Fired when a payment is CONFIRMED (payment.succeeded applied).
  async sendReceipt(orderId: string, origin: string | null): Promise<void> {
    try {
      const order = await orderWithItems(orderId);
      if (!order?.guestEmail) return; // nowhere to send — admin-created order
      const site = await settingsService.getSite();
      const receiptUrl = origin && order.accessToken
        ? `\n\nView your order: ${origin}/order-received/?order=${encodeURIComponent(order.number)}&token=${encodeURIComponent(order.accessToken)}`
        : '';
      await notificationService.sendToAddress(
        order.guestEmail,
        `${site.siteName} — order ${order.number} confirmed`,
        `Thanks for your order!\n\nOrder ${order.number}\n\n${receiptLines(order)}${receiptUrl}\n\n— ${site.siteName}`,
      );
    } catch (err) {
      logger.warn({ err, orderId }, 'receipt email failed (non-fatal)');
    }
  },

  // Fired when succeeded refunds cover the whole order (confirmed path).
  async sendRefundNotice(orderId: string): Promise<void> {
    try {
      const order = await orderWithItems(orderId);
      if (!order?.guestEmail) return;
      const site = await settingsService.getSite();
      await notificationService.sendToAddress(
        order.guestEmail,
        `${site.siteName} — order ${order.number} refunded`,
        `Your order ${order.number} has been refunded in full (${money(order.refundedTotal, order.currency)}).\nRefunds typically appear within 5–10 business days depending on your bank.\n\n— ${site.siteName}`,
      );
    } catch (err) {
      logger.warn({ err, orderId }, 'refund-notice email failed (non-fatal)');
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

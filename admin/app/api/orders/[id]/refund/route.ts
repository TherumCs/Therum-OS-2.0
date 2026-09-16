import { proxyToBackend } from '../../../../../lib/api';

// Issue a REAL refund from the order-detail page. The browser posts
// { amount?, reason?, idempotencyKey } here; the backend
// (POST /api/orders/:id/refund → paymentGatewayService.refund) does the PSP
// refund, over-refund guard, restock, coupon release, and refund email. This
// proxy is what the admin was missing — the old "Mark refunded" button pointed
// at a non-existent order status and 422'd, so no refund ever happened
// in-product (audit R6).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const [{ id }, body] = await Promise.all([params, req.json().catch(() => ({}))]);
  return proxyToBackend('POST', `/api/orders/${encodeURIComponent(id)}/refund`, body);
}

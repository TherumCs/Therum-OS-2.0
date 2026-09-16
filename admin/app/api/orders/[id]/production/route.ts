import { proxyToBackend } from '../../../../../lib/api';

// Set the per-line production stage from the order-detail page. The browser posts
// { status, itemIds? } here; the backend (POST /api/orders/:id/production) updates
// those lines and, on entering 'in_production', emails the customer once per line.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const [{ id }, body] = await Promise.all([params, req.json()]);
  return proxyToBackend('POST', `/api/orders/${encodeURIComponent(id)}/production`, body);
}

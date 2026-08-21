import { proxyToBackend } from '../../../../../lib/api';

// Move an order between states from the order-detail page. The browser posts
// { status } here; the backend gates the transition (POST /api/orders/:id/
// transition) — the same route the orders LIST page already reaches through
// its server action. This proxy is what the detail page's client component was
// missing, so its "Mark shipped / delivered / …" buttons 404'd.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const [{ id }, body] = await Promise.all([params, req.json()]);
  return proxyToBackend('POST', `/api/orders/${encodeURIComponent(id)}/transition`, body);
}

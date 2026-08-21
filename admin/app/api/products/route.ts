import { proxyToBackend } from '../../../lib/api';

// The bare product LIST. The sibling [...path] catch-all requires at least one
// segment, so GET /api/products?limit=500 (the assign-products dialog's roster
// query) fell through to a 404 and the dialog always came up empty.
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  return proxyToBackend('GET', `/api/products${url.search}`);
}

export async function POST(req: Request): Promise<Response> {
  return proxyToBackend('POST', '/api/products', await req.json().catch(() => undefined));
}

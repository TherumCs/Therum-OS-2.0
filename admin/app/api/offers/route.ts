import { proxyToBackend } from '../../../lib/api';

// Offers proxy — pushing a coupon to named customers. Same shape as every
// other admin proxy: the browser never holds the backend token.
export async function GET(): Promise<Response> {
  return proxyToBackend('GET', '/api/counter/offers');
}

export async function POST(req: Request): Promise<Response> {
  return proxyToBackend('POST', '/api/counter/offers', await req.json().catch(() => undefined));
}

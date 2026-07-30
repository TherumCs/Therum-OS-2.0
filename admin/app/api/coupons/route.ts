import { proxyToBackend } from '../../../lib/api';

export async function GET(): Promise<Response> {
  return proxyToBackend('GET', '/api/coupons');
}
export async function POST(req: Request): Promise<Response> {
  return proxyToBackend('POST', '/api/coupons', await req.json().catch(() => undefined));
}

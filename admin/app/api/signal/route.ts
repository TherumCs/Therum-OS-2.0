import { proxyToBackend } from '../../../lib/api';

export async function GET(): Promise<Response> {
  return proxyToBackend('GET', '/api/signal');
}
export async function PUT(req: Request): Promise<Response> {
  return proxyToBackend('PUT', '/api/signal', await req.json().catch(() => undefined));
}

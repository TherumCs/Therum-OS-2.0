import { proxyToBackend } from '../../../lib/api';

export async function GET(): Promise<Response> {
  return proxyToBackend('GET', '/api/auth/tokens');
}

export async function POST(req: Request): Promise<Response> {
  return proxyToBackend('POST', '/api/auth/tokens', await req.json());
}

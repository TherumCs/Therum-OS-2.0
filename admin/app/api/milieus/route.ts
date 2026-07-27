import { proxyToBackend } from '../../../lib/api';

export async function GET(): Promise<Response> {
  return proxyToBackend('GET', '/api/milieus');
}

export async function POST(req: Request): Promise<Response> {
  return proxyToBackend('POST', '/api/milieus', await req.json());
}

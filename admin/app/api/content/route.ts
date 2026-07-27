import { proxyToBackend } from '../../../lib/api';

export async function POST(req: Request): Promise<Response> {
  const body = await req.json();
  return proxyToBackend('POST', '/api/content', body);
}

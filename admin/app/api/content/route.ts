import { proxyToBackend } from '../../../lib/api';

// The command palette searches content with GET /api/content?q=… — without
// this export it 405'd and the palette silently showed zero content hits.
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  return proxyToBackend('GET', `/api/content${url.search}`);
}

export async function POST(req: Request): Promise<Response> {
  const body = await req.json();
  return proxyToBackend('POST', '/api/content', body);
}

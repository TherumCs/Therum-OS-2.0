import { proxyToBackend } from '../../../../lib/api';

export async function GET(req: Request): Promise<Response> {
  const q = new URL(req.url).searchParams.get('q') ?? '';
  return proxyToBackend('GET', `/api/clusters/candidates?q=${encodeURIComponent(q)}`);
}

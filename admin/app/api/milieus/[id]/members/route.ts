import { proxyToBackend } from '../../../../../lib/api';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const url = new URL(req.url);
  const qs = url.searchParams.toString();
  return proxyToBackend('GET', `/api/milieus/${id}/members${qs ? `?${qs}` : ''}`);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const [{ id }, body] = await Promise.all([params, req.json()]);
  return proxyToBackend('POST', `/api/milieus/${id}/members`, body);
}

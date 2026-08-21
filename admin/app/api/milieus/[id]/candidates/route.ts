import { proxyToBackend } from '../../../../../lib/api';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const url = new URL(req.url);
  const q = url.searchParams.get('q') ?? '';
  return proxyToBackend('GET', `/api/milieus/${id}/candidates?q=${encodeURIComponent(q)}`);
}

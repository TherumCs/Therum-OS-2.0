import { proxyToBackend } from '../../../../../lib/api';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  return proxyToBackend('POST', `/api/redirects/${id}/toggle`);
}

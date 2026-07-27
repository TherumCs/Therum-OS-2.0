import { proxyToBackend } from '../../../../../lib/api';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  return proxyToBackend('GET', `/api/clusters/${id}/drift`);
}

import { proxyToBackend } from '../../../../lib/api';

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  return proxyToBackend('DELETE', `/api/redirects/${id}`);
}

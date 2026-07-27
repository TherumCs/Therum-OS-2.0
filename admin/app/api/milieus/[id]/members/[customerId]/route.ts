import { proxyToBackend } from '../../../../../../lib/api';

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; customerId: string }> }): Promise<Response> {
  const { id, customerId } = await params;
  return proxyToBackend('DELETE', `/api/milieus/${id}/members/${customerId}`);
}

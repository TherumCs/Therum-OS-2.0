import { proxyToBackend } from '../../../../../../../lib/api';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string; customerId: string }> }): Promise<Response> {
  const { id, customerId } = await params;
  return proxyToBackend('POST', `/api/milieus/${id}/members/${customerId}/approve`);
}

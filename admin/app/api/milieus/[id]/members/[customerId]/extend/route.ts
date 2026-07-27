import { proxyToBackend } from '../../../../../../../lib/api';

export async function POST(req: Request, { params }: { params: Promise<{ id: string; customerId: string }> }): Promise<Response> {
  const [{ id, customerId }, body] = await Promise.all([params, req.json()]);
  return proxyToBackend('POST', `/api/milieus/${id}/members/${customerId}/extend`, body);
}

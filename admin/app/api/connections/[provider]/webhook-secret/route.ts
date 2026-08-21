import { proxyToBackend } from '../../../../../lib/api';

export async function PUT(req: Request, { params }: { params: Promise<{ provider: string }> }): Promise<Response> {
  const [{ provider }, body] = await Promise.all([params, req.json()]);
  return proxyToBackend('PUT', `/api/connections/${provider}/webhook-secret`, body);
}

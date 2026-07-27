import { proxyToBackend } from '../../../../lib/api';

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }): Promise<Response> {
  const [{ provider }, body] = await Promise.all([params, req.json()]);
  return proxyToBackend('POST', `/api/connections/${provider}`, body);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ provider: string }> }): Promise<Response> {
  const { provider } = await params;
  return proxyToBackend('DELETE', `/api/connections/${provider}`);
}

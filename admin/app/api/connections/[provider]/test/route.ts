import { proxyToBackend } from '../../../../../lib/api';

export async function POST(_req: Request, { params }: { params: Promise<{ provider: string }> }): Promise<Response> {
  const { provider } = await params;
  return proxyToBackend('POST', `/api/connections/${provider}/test`);
}

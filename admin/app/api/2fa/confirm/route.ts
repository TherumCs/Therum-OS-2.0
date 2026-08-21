import { proxyToBackend } from '../../../../lib/api';

export async function POST(req: Request): Promise<Response> {
  return proxyToBackend('POST', '/api/auth/2fa/confirm', await req.json());
}

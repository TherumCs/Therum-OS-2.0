import { proxyToBackend } from '../../../../lib/api';

export async function POST(req: Request): Promise<Response> {
  // Forward the re-auth proof (password / current code) to the backend, which
  // now requires it to disable 2FA (audit R6).
  const body = await req.json().catch(() => ({}));
  return proxyToBackend('POST', '/api/auth/2fa/disable', body);
}

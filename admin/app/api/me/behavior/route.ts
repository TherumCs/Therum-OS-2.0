import { proxyToBackend } from '../../../../lib/api';

export async function PATCH(req: Request): Promise<Response> {
  const body = await req.json();
  return proxyToBackend('PATCH', '/api/me/behavior', body);
}

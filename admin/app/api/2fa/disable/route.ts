import { proxyToBackend } from '../../../../lib/api';

export async function POST(): Promise<Response> {
  return proxyToBackend('POST', '/api/auth/2fa/disable');
}

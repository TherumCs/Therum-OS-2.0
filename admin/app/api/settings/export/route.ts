import { proxyToBackend } from '../../../../lib/api';

export async function GET(): Promise<Response> {
  return proxyToBackend('GET', '/api/settings/export');
}

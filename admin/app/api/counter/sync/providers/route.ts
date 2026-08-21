import { proxyToBackend } from '../../../../../lib/api';

// Lists the catalogue providers this store can sync from (ProviderSync.tsx).
export async function GET(): Promise<Response> {
  return proxyToBackend('GET', '/api/counter/sync/providers');
}

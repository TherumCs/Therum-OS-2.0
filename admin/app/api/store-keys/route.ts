import { proxyToBackend } from '../../../lib/api';

// Issues a store key a partner uses to READ this store (body: { label, scope }).
// The consumer secret is in the backend's response once and nowhere else, so
// this passes the body straight through unchanged.
export async function POST(req: Request): Promise<Response> {
  return proxyToBackend('POST', '/api/store-keys', await req.json().catch(() => undefined));
}

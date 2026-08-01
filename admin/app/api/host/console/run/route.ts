import { proxyToBackend } from '../../../../../lib/api';

// A refusal here IS the useful response — it names what the console accepts —
// so the backend's status and body pass through untouched.
export async function POST(req: Request): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  return proxyToBackend('POST', '/api/host/console/run', body);
}

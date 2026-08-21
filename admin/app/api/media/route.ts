import { proxyToBackend } from '../../../lib/api';

// List proxy for the media picker (client components can't attach the
// httpOnly session token themselves — same pattern as every other proxy).
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  return proxyToBackend('GET', `/api/media${url.search}`);
}

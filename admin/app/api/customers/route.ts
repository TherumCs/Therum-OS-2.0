import { proxyToBackend } from '../../../lib/api';

// Client-callable proxy for the Customers admin page. Without this, browser
// fetches to /tos-admin/api/customers* 404 at the Next layer and never reach
// the backend — which is exactly why customer name edits silently failed.
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const qs = url.searchParams.toString();
  return proxyToBackend('GET', `/api/customers${qs ? `?${qs}` : ''}`);
}

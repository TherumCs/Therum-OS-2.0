import { proxyToBackend } from '../../../../lib/api';

// The form POST handler that used to live here is gone with the form itself.
// It redirected to `${BASE_PATH}/settings/appearance` — a route that does not
// exist (the page is /appearance, not /settings/appearance), so every save
// ended on a 404 even though the PATCH underneath had succeeded. It also
// hard-coded 5 of the 36 fields the API accepts and sent the literal string
// "null" for any it could not find in the form body. The page saves per field
// over the PATCH below now, so there is nothing to submit and nowhere to land.

// A static route file shadows the generic [domain]/route.ts PATCH catch-all
// for this exact path (Next.js doesn't merge handlers across a static and a
// dynamic match — the static file wins outright, so a PATCH here would 405
// without this). The Quick Controls panel needs instant-save (JSON PATCH per
// field), not the old form's full-page POST+redirect above — this is that,
// added alongside the old handler rather than replacing it.
export async function PATCH(req: Request): Promise<Response> {
  const body = await req.json();
  return proxyToBackend('PATCH', '/api/settings/appearance', body);
}

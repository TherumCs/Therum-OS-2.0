import { NextResponse } from 'next/server';
import { apiSend, proxyToBackend } from '../../../../lib/api';
import { BASE_PATH, redirectUrl } from '../../../../lib/session';

// Route Handler, not a Server Action — see dashboard-layout/move/route.ts for
// why. Site-wide setting (not per-user), unlike the dashboard-layout routes.
export async function POST(req: Request): Promise<NextResponse> {
  const form = await req.formData();
  await apiSend('PATCH', '/api/settings/appearance', {
    density: String(form.get('density')),
    sidebarStyle: String(form.get('sidebarStyle')),
    cardStyle: String(form.get('cardStyle')),
    colorMode: String(form.get('colorMode')),
    contrast: String(form.get('contrast')),
  });
  return NextResponse.redirect(redirectUrl(req, `${BASE_PATH}/settings/appearance`));
}

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

import { NextResponse } from 'next/server';
import { apiSend } from '../../../../lib/api';
import { BASE_PATH, redirectUrl } from '../../../../lib/session';

// Plain form POST -> redirect, not a Server Action — Server Action ids are a
// content hash baked into the page bundle at compile time; this dev server
// gets restarted often during active work, and an already-loaded page's
// action reference goes stale the moment that happens ("Invalid Server
// Actions request" — hit live testing this exact feature). A Route Handler
// is an ordinary HTTP endpoint with no such coupling. See admin/app/login's
// LoginScreen.tsx for the original instance of this fix.
export async function POST(req: Request): Promise<NextResponse> {
  const form = await req.formData();
  const cardId = String(form.get('cardId') ?? '');
  const direction = String(form.get('direction') ?? '');
  const layout = JSON.parse(String(form.get('layout') ?? '[]')) as { id: string; size: string }[];

  const i = layout.findIndex((c) => c.id === cardId);
  if (i !== -1) {
    const j = direction === 'up' ? i - 1 : i + 1;
    if (j >= 0 && j < layout.length) {
      const next = [...layout];
      [next[i], next[j]] = [next[j], next[i]];
      await apiSend('PATCH', '/api/me/dashboard-layout', { cards: next });
    }
  }
  return NextResponse.redirect(redirectUrl(req, BASE_PATH), 303); // 303 = follow as GET — 307 re-POSTs the page and 500s
}

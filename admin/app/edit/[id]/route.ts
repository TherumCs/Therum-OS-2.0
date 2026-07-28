import { NextResponse } from 'next/server';
import { apiGet, authToken, builderEditUrl } from '../../../lib/api';
import { BASE_PATH, redirectUrl } from '../../../lib/session';

// Edit hand-off for the front-end admin dock.
//
// The dock is rendered into PUBLIC page HTML, so it cannot carry
// builderEditUrl()'s `?token=<jwt>` the way the admin's own list pages do —
// that would put a live session token in the DOM of every public page an
// admin views, and in the Referer of any outbound click from it. The dock
// links here instead; the token is read from the httpOnly cookie server-side
// and only ever appears in a 302 the browser follows directly.
//
// Bricks-imported pages are `bodyFormat: 'canvas'` (see api/routes/bricks.ts),
// which is exactly what the visual builder edits — so canvas goes to the
// builder and anything else falls back to the content list.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;

  const item = await apiGet<{ id: string; type: string; bodyFormat: string }>(`/api/content/${id}`).catch(() => null);
  if (!item) return NextResponse.redirect(redirectUrl(req, `${BASE_PATH}/pages`));

  if (item.bodyFormat === 'canvas') {
    const token = await authToken();
    if (token) return NextResponse.redirect(builderEditUrl(item.id, token));
  }

  const list = item.type === 'post' ? 'posts' : item.type === 'case_study' ? 'case-studies' : 'pages';
  return NextResponse.redirect(redirectUrl(req, `${BASE_PATH}/${list}`));
}

import { NextResponse } from 'next/server';
import { apiSend } from '../../../../lib/api';

// Route Handler, not a Server Action — see move/route.ts for why. Unlike
// move/reset (still plain form posts → 303 redirect), resize's only caller
// is CardResizeHandle's fetch() since the corner-drag replaced the size
// chips — JSON out, the client reloads itself (audit finding #14: following
// the 303 just downloaded the dashboard HTML for nothing).
export async function POST(req: Request): Promise<NextResponse> {
  const form = await req.formData();
  const cardId = String(form.get('cardId') ?? '');
  const size = String(form.get('size') ?? '');
  const layout = JSON.parse(String(form.get('layout') ?? '[]')) as { id: string; size: string }[];

  const next = layout.map((c) => (c.id === cardId ? { ...c, size } : c));
  await apiSend('PATCH', '/api/me/dashboard-layout', { cards: next });
  return NextResponse.json({ ok: true });
}

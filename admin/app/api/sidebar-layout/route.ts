import { NextResponse } from 'next/server';
import { apiSend } from '../../../lib/api';

// JSON endpoint, not a form POST + redirect — Sidebar.tsx is already a client
// component (unlike the dashboard's Server Component + Route Handler forms),
// so it follows Topbar.tsx's established fetch + router.refresh() pattern.
export async function POST(req: Request): Promise<NextResponse> {
  const body = (await req.json()) as { sections: { id: string; label: string }[]; items: Record<string, string[]> };
  await apiSend('PATCH', '/api/me/sidebar-layout', body);
  return NextResponse.json({ ok: true });
}

import { NextResponse } from 'next/server';
import { apiSend } from '../../../../lib/api';

// JSON endpoint (not a form POST + redirect like the full appearance form) —
// the topbar toggle needs an in-place update it can follow with
// router.refresh(), not a navigation.
export async function POST(req: Request): Promise<NextResponse> {
  const { colorMode } = (await req.json()) as { colorMode: 'light' | 'dark' | 'system' };
  await apiSend('PATCH', '/api/settings/appearance', { colorMode });
  return NextResponse.json({ ok: true });
}

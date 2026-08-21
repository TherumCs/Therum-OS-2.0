import { NextResponse } from 'next/server';
import { apiSend } from '../../../lib/api';

export async function POST(req: Request): Promise<NextResponse> {
  const { enabled } = (await req.json()) as { enabled: boolean };
  await apiSend('PATCH', '/api/me/desktop-mode', { enabled });
  return NextResponse.json({ ok: true });
}

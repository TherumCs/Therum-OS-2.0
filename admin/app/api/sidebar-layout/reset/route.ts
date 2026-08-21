import { NextResponse } from 'next/server';
import { apiSend } from '../../../../lib/api';

export async function POST(): Promise<NextResponse> {
  await apiSend('POST', '/api/me/sidebar-layout/reset', {});
  return NextResponse.json({ ok: true });
}

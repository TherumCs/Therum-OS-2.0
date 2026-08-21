import { NextResponse } from 'next/server';
import { apiSend } from '../../../../lib/api';
import { BASE_PATH, redirectUrl } from '../../../../lib/session';

export async function POST(req: Request): Promise<NextResponse> {
  await apiSend('POST', '/api/me/dashboard-layout/reset', {});
  return NextResponse.redirect(redirectUrl(req, BASE_PATH), 303); // 303 = follow as GET — 307 re-POSTs the page and 500s
}

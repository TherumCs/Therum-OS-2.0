import { NextResponse } from 'next/server';
import { apiSend } from '../../../../lib/api';

// The browser never talks to the backend directly — it goes through here so
// the session cookie becomes a bearer token server-side. Same shape as every
// other admin proxy route.
export async function POST(): Promise<NextResponse> {
  const scan = await apiSend('POST', '/api/host/scan');
  return NextResponse.json(scan);
}

import { NextResponse } from 'next/server';
import { apiBase, authToken } from '../../../../lib/api';

// The browser can't reach the backend directly (it has no way to attach the
// httpOnly session token as a Bearer header), so this re-POSTs the same
// FormData server-side with the real token attached — same proxy pattern as
// proxyToBackend(), just for multipart instead of JSON.
export async function POST(req: Request): Promise<NextResponse> {
  const form = await req.formData();
  const res = await fetch(`${apiBase()}/api/media/upload`, {
    method: 'POST',
    headers: { authorization: `Bearer ${await authToken()}` },
    body: form,
  });
  const body = await res.json().catch(() => null);
  return NextResponse.json(body, { status: res.status });
}

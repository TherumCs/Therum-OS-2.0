import { NextResponse } from 'next/server';
import { authToken } from '../../../../lib/api';

const API = process.env.API_URL ?? 'http://localhost:4100';

// The file is streamed straight through to the backend rather than read here:
// a catalogue PDF can be tens of megabytes and there is nothing for this hop
// to do with it except forward it under the admin's session.
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const form = await req.formData();
    const upstream = new FormData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'No file was uploaded.' }, { status: 400 });
    upstream.append('file', file, file.name);

    const res = await fetch(`${API}/api/counter/import/catalog/upload`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await authToken()}` },
      body: upstream,
    });
    const body = await res.json().catch(() => ({ error: 'Unreadable response.' }));
    return NextResponse.json(body, { status: res.status });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Upload failed.' }, { status: 502 });
  }
}

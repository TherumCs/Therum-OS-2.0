import { NextResponse } from 'next/server';
import { apiSend } from '../../../../lib/api';

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const body = (await req.json()) as { text?: string };
    if (!body.text) return NextResponse.json({ error: 'No file content.' }, { status: 400 });
    return NextResponse.json(await apiSend('POST', '/api/counter/import/catalog/analyze', { text: body.text }));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not read that file.' }, { status: 502 });
  }
}

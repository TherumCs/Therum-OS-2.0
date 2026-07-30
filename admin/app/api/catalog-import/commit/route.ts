import { NextResponse } from 'next/server';
import { apiSend } from '../../../../lib/api';

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const body = await req.json();
    return NextResponse.json(await apiSend('POST', '/api/counter/import/catalog/commit', body));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Import failed.' }, { status: 502 });
  }
}

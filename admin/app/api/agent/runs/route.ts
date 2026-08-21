import { NextResponse } from 'next/server';
import { apiSend } from '../../../../lib/api';

export async function POST(req: Request): Promise<NextResponse> {
  const { prompt } = (await req.json()) as { prompt: string };
  return NextResponse.json(await apiSend('POST', '/api/agent/runs', { prompt }));
}

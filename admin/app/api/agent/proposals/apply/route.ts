import { NextResponse } from 'next/server';
import { apiSend } from '../../../../../lib/api';

// Applying is its own route, never folded into the run: a human posts the
// proposal id here after reading the diff.
export async function POST(req: Request): Promise<NextResponse> {
  const { proposalId } = (await req.json()) as { proposalId: string };
  return NextResponse.json(await apiSend('POST', '/api/agent/proposals/apply', { proposalId }));
}

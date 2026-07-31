import { NextResponse } from 'next/server';
import { apiGet } from '../../../../../lib/api';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await ctx.params;
  return NextResponse.json(await apiGet(`/api/agent/proposals/${encodeURIComponent(id)}`));
}

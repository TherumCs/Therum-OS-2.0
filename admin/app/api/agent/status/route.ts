import { NextResponse } from 'next/server';
import { apiGet } from '../../../../lib/api';

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(await apiGet('/api/agent/status'));
}

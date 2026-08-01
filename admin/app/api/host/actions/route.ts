import { apiGet } from '../../../../lib/api';
import { NextResponse } from 'next/server';

// The actions the Server panel offers, plus the recent run log.
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(await apiGet('/api/host/actions'));
}

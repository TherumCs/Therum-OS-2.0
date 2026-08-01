import { apiGet } from '../../../../lib/api';
import { NextResponse } from 'next/server';

// The command grammar, for the hint list under the console input.
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(await apiGet('/api/host/console'));
}

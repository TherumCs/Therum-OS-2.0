import { apiGet } from '../../../../lib/api';
import { NextResponse } from 'next/server';

// Machines the hosting provider reports, plus which providers are connected.
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(await apiGet('/api/host/hosting'));
}

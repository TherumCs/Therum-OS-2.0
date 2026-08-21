import { NextResponse } from 'next/server';
import { apiSend } from '../../../../lib/api';
import { BASE_PATH, redirectUrl } from '../../../../lib/session';
import { DASHBOARD_PRESETS, isPresetKey } from '../../../(app)/dashboardPresets';

// Apply a whole-dashboard layout preset in one write, rather than making the
// user drag six cards to the same size. Plain form post → 303 like move/reset
// (see move/route.ts for why these aren't Server Actions).
export async function POST(req: Request): Promise<NextResponse> {
  const form = await req.formData();
  const key = String(form.get('preset') ?? '');
  const layout = JSON.parse(String(form.get('layout') ?? '[]')) as { id: string; size: string }[];

  if (isPresetKey(key)) {
    // Preserve the user's card ORDER and which cards they have — a preset
    // only restates sizes. Anything the preset doesn't name keeps its size.
    const sizes: Record<string, string> = DASHBOARD_PRESETS[key].sizes;
    const next = layout.map((c) => ({ ...c, size: sizes[c.id] ?? sizes['*'] ?? c.size }));
    await apiSend('PATCH', '/api/me/dashboard-layout', { cards: next });
  }
  return NextResponse.redirect(redirectUrl(req, BASE_PATH), 303);
}

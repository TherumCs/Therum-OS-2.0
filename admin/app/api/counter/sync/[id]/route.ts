import { proxyToBackend } from '../../../../../lib/api';

type Ctx = { params: Promise<{ id: string }> };

// Runs a catalogue sync for one provider (ProviderSync.tsx posts with no body;
// the provider id in the path is all the backend needs).
export async function POST(_req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  return proxyToBackend('POST', `/api/counter/sync/${encodeURIComponent(id)}`);
}

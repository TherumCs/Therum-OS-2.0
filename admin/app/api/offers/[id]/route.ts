import { proxyToBackend } from '../../../../lib/api';

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  return proxyToBackend('DELETE', `/api/counter/offers/${encodeURIComponent(id)}`);
}

import { proxyToBackend } from '../../../../lib/api';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  return proxyToBackend('PATCH', `/api/coupons/${encodeURIComponent(id)}`, await req.json().catch(() => undefined));
}
export async function DELETE(_req: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  return proxyToBackend('DELETE', `/api/coupons/${encodeURIComponent(id)}`);
}

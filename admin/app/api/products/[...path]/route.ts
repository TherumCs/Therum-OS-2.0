import { proxyToBackend } from '../../../../lib/api';

// Catch-all proxy for the product editor: /api/products/:id, /taxonomy,
// /variants/:variantId — every method the backend routes support.
type Ctx = { params: Promise<{ path: string[] }> };
const join = async (ctx: Ctx, req: Request): Promise<string> => {
  const { path } = await ctx.params;
  const url = new URL(req.url);
  return `/api/products/${path.map(encodeURIComponent).join('/')}${url.search}`;
};

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  return proxyToBackend('GET', await join(ctx, req));
}
export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  return proxyToBackend('POST', await join(ctx, req), await req.json().catch(() => undefined));
}
export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  return proxyToBackend('PATCH', await join(ctx, req), await req.json().catch(() => undefined));
}
export async function PUT(req: Request, ctx: Ctx): Promise<Response> {
  return proxyToBackend('PUT', await join(ctx, req), await req.json().catch(() => undefined));
}
export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  return proxyToBackend('DELETE', await join(ctx, req));
}

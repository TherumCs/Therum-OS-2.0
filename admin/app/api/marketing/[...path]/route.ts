import { proxyToBackend } from '../../../../lib/api';

// Marketing proxy — one catch-all for the whole /api/marketing/* surface so the
// browser never holds the backend token. Query string is forwarded as-is.
type Ctx = { params: Promise<{ path: string[] }> };

async function target(req: Request, ctx: Ctx): Promise<string> {
  const { path } = await ctx.params;
  const qs = new URL(req.url).search;
  return `/api/marketing/${path.map(encodeURIComponent).join('/')}${qs}`;
}

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  return proxyToBackend('GET', await target(req, ctx));
}
export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  return proxyToBackend('POST', await target(req, ctx), await req.json().catch(() => undefined));
}
export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  return proxyToBackend('PATCH', await target(req, ctx), await req.json().catch(() => undefined));
}
export async function PUT(req: Request, ctx: Ctx): Promise<Response> {
  return proxyToBackend('PUT', await target(req, ctx), await req.json().catch(() => undefined));
}
export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  return proxyToBackend('DELETE', await target(req, ctx));
}

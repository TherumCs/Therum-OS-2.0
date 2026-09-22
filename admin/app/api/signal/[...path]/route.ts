import { proxyToBackend } from '../../../../lib/api';

// Signal proxy — the browser never holds the backend token. Stays inside /api/signal.
type Ctx = { params: Promise<{ path: string[] }> };

async function target(ctx: Ctx): Promise<string> {
  const { path } = await ctx.params;
  if (path.some((seg) => seg === '' || seg === '.' || seg === '..')) throw new Error('bad path');
  return `/api/signal/${path.map(encodeURIComponent).join('/')}`;
}

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  return proxyToBackend('POST', await target(ctx), await req.json().catch(() => undefined));
}

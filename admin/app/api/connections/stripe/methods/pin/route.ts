import { proxyToBackend } from '../../../../../../lib/api';

// Pins which Stripe configuration checkout builds against (body: { configId }).
// Static sibling of [methodId] below — Next resolves /methods/pin here, not to
// the dynamic route.
export async function POST(req: Request): Promise<Response> {
  return proxyToBackend('POST', '/api/connections/stripe/methods/pin', await req.json().catch(() => undefined));
}

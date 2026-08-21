import { proxyToBackend } from '../../../../../../lib/api';

// Toggles one payment method on/off for a configuration (body: { configId, on }).
// POST, not DELETE/PATCH — the panel flips a switch and gets the re-listed
// truth back.
export async function POST(req: Request, { params }: { params: Promise<{ methodId: string }> }): Promise<Response> {
  const [{ methodId }, body] = await Promise.all([params, req.json()]);
  return proxyToBackend('POST', `/api/connections/stripe/methods/${encodeURIComponent(methodId)}`, body);
}

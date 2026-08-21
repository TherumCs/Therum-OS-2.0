import { proxyToBackend } from '../../../../../../../lib/api';

// Power and snapshot actions. The provider's own error text is the useful
// response when this fails, so status and body pass through untouched.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ provider: string; id: string; action: string }> },
): Promise<Response> {
  const { provider, id, action } = await params;
  return proxyToBackend(
    'POST',
    `/api/host/hosting/${encodeURIComponent(provider)}/${encodeURIComponent(id)}/${encodeURIComponent(action)}`,
  );
}

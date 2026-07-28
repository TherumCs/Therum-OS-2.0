import { proxyToBackend } from '../../../../../lib/api';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const [{ id }, body] = await Promise.all([params, req.json()]);
  return proxyToBackend('POST', `/api/media/${id}/transform`, body);
}

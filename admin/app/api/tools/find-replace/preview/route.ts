import { proxyToBackend } from '../../../../../lib/api';

export async function POST(req: Request): Promise<Response> {
  return proxyToBackend('POST', '/api/tools/find-replace/preview', await req.json());
}

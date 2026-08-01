import { proxyToBackend } from '../../../../../../lib/api';

// proxyToBackend rather than apiSend: a refused action returns 400 with a
// message the operator needs to READ ("sudo refused …, install therum-sudoers"),
// and apiSend would throw that away as a generic proxy failure.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  return proxyToBackend('POST', `/api/host/actions/${encodeURIComponent(id)}/run`, body);
}

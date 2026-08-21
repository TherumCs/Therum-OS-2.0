import { proxyToBackend } from '../../../../lib/api';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const [{ id }, body] = await Promise.all([params, req.json()]);
  return proxyToBackend('PATCH', `/api/media/${id}`, body);
}

// Both media delete buttons (lightbox + list) send DELETE here; without this
// export they 405'd and delete was silently dead in the UI.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  return proxyToBackend('DELETE', `/api/media/${id}`);
}

import { proxyToBackend } from '../../../../lib/api';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  return proxyToBackend('GET', `/api/customers/${id}`);
}

// Edit display / first / last name from the Customers page. The backend route
// (PATCH /api/customers/:id) already existed and worked; this handler is what
// lets the browser reach it.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const [{ id }, body] = await Promise.all([params, req.json()]);
  return proxyToBackend('PATCH', `/api/customers/${id}`, body);
}

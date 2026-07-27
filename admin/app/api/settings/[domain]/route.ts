import { proxyToBackend } from '../../../../lib/api';

// One generic proxy for every simple Settings domain (admin-dock, login-
// branding, performance, editor-defaults, uploads, notifications, backup) —
// each is a thin PATCH-to-backend, so a single dynamic route replaces 7
// near-identical files. Appearance keeps its own route (form-POST + redirect,
// a different pattern since its callers post a plain HTML form).
export async function PATCH(req: Request, { params }: { params: Promise<{ domain: string }> }): Promise<Response> {
  const [{ domain }, body] = await Promise.all([params, req.json()]);
  return proxyToBackend('PATCH', `/api/settings/${domain}`, body);
}

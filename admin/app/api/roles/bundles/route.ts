import { proxyToBackend } from '../../../../lib/api';

// A static sibling of [id]/route.ts, not a fallthrough to it — Next.js
// resolves an exact-path static route before the dynamic catch-all, and
// [id]/route.ts doesn't export GET anyway (see this project's own prior
// note on this exact class of bug: PATCH .../appearance was silently
// shadowed the same way before it got its own static export).
export async function GET(): Promise<Response> {
  return proxyToBackend('GET', '/api/roles/bundles');
}

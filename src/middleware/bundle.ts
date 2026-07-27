import type { FastifyReply, FastifyRequest } from 'fastify';

// Full admin (role: 'admin') always passes — bundles only ever narrow a
// 'custom'-role session, never grant anything beyond what admin already
// has. Only gates mutating actions (see the call sites in content.ts,
// settings.ts, products/orders/customers.ts); GET/read access is not
// bundle-gated at all — restricting it per-route would make the admin
// panel unusable for any custom-role account, and 'read' in the 7-bundle
// list reads as a baseline-access marker, not a fine-grained per-route gate.
export function requireBundle(bundle: string) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (req.user.role === 'admin') return;
    if (!req.user.bundles?.includes(bundle)) {
      reply.status(403).send({ error: { code: 'bundle_required', message: `This action requires the '${bundle}' capability.` } });
    }
  };
}

// Role management itself (creating/editing roles, assigning them to users)
// is deliberately not delegable via any bundle — a 'manage-settings'
// custom user editing their OWN role's bundles, or creating a new, more
// powerful one, would be a direct privilege-escalation path. Full admin
// only. async even though nothing here awaits — Fastify's hook signature
// detection keys off the function being async (or taking a 3rd `done`
// callback param); a plain sync 2-arg function hangs the request forever
// instead of erroring, since Fastify waits for a `done` that's never called.
export async function requireFullAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (req.user.role !== 'admin') {
    reply.status(403).send({ error: { code: 'admin_required', message: 'Only a full administrator can do this.' } });
  }
}

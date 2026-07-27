import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { env } from '../lib/env.js';
import { apiTokenService } from '../services/apiToken.service.js';
import { roleService } from '../services/role.service.js';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    // 'pending2fa': a short-lived token minted after a correct password but
    // before the second factor is verified — deliberately never accepted by
    // `app.authenticate` (see below), only by the dedicated /auth/verify-2fa
    // route, which checks for this role specifically. 'custom' carries no
    // bundle info of its own — see the live resolveAccess() lookup below;
    // baking bundles into the JWT would mean an edited role doesn't take
    // effect until the user's next login.
    payload: { sub: string; role: 'admin' | 'custom' | 'pending2fa' };
    user: { sub: string; role: 'admin' | 'custom' | 'pending2fa'; bundles?: string[] };
  }
}

// JWT auth. `app.authenticate` is a preHandler that 401s on a bad/missing token.
export async function registerAuth(app: FastifyInstance): Promise<void> {
  await app.register(fastifyJwt, { secret: env.JWT_SECRET });

  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    // API tokens (prefix "tro_") are a separate credential type, not a JWT —
    // checked first since jwtVerify() would just fail on their format anyway.
    // A 'read'-scoped token can't be used to mutate anything, regardless of
    // which route it's presented to — enforced here, once, rather than
    // per-route, so a future route can't accidentally forget the check.
    const authHeader = req.headers.authorization;
    const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (bearer?.startsWith('tro_')) {
      const result = await apiTokenService.verify(bearer, req.ip);
      if (!result) {
        reply.status(401).send({ error: { code: 'unauthorized', message: 'Invalid or revoked API token.' } });
        return;
      }
      if (result.scope === 'read' && req.method !== 'GET' && req.method !== 'HEAD') {
        reply.status(403).send({ error: { code: 'forbidden', message: 'This token is read-only.' } });
        return;
      }
      // An API token inherits its issuing user's real role tier — a
      // custom-role user's token must be bundle-gated the same way their
      // browser session is, not silently escalated to full admin.
      const access = await roleService.resolveAccess(result.userId);
      req.user = { sub: result.userId, role: access.role, bundles: access.bundles };
      return;
    }

    try {
      await req.jwtVerify();
      // jwtVerify only checks the signature/expiry — it does not care what
      // `role` says, so any validly-signed token grants full access
      // regardless of role. That's exactly the gap that would let a 2FA
      // "pending" challenge token (signed with the same secret, issued
      // after a correct password but before the second factor) work as a
      // real session token if nothing here rejected it. 'admin'/'custom'
      // are the only two real session roles; anything else fails closed.
      if (req.user.role !== 'admin' && req.user.role !== 'custom') {
        reply.status(401).send({ error: { code: 'unauthorized', message: 'Authentication required.' } });
        return;
      }
      // Bundles are never in the JWT payload itself (see the type comment
      // above) — resolved live so a role edit applies on this user's very
      // next request, not just their next login.
      if (req.user.role === 'custom') {
        const access = await roleService.resolveAccess(req.user.sub);
        req.user.bundles = access.bundles;
      }
    } catch {
      reply.status(401).send({ error: { code: 'unauthorized', message: 'Authentication required.' } });
    }
  });
}

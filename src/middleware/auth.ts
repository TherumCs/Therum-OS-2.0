import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { env } from '../lib/env.js';
import { apiTokenService } from '../services/apiToken.service.js';
import { roleService } from '../services/role.service.js';
import { settingsService } from '../services/settings.service.js';
import { db } from '../lib/db.js';

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

// Routes an un-enrolled account may still reach while 2FA enforcement is on.
//
// Deliberately the shortest list that lets someone climb out of the hole they
// are in: see the requirement, enrol, confirm, and read enough of their own
// account for the admin shell to render the prompt. `/auth/2fa/disable` is
// NOT here — an account that has not enrolled cannot disable anything, and an
// enrolled one must not be able to opt back out while enforcement is on.
const ENROLMENT_ALLOWLIST: { method: string; path: string }[] = [
  { method: 'GET', path: '/api/auth/2fa' },
  { method: 'POST', path: '/api/auth/2fa/enroll' },
  { method: 'POST', path: '/api/auth/2fa/confirm' },
  { method: 'GET', path: '/api/me' },
  { method: 'GET', path: '/api/settings/appearance' },
];

function isEnrolmentRoute(method: string, url: string): boolean {
  const path = (url.split('?')[0] ?? '').replace(/\/+$/, '') || '/';
  return ENROLMENT_ALLOWLIST.some((r) => r.method === method && r.path === path);
}

/**
 * Blocks a session that has not satisfied the 2FA policy.
 *
 * Returns true when it has already answered the request.
 *
 * Enforced HERE rather than at the login form on purpose. Refusing the login
 * outright would lock out every existing account the instant the toggle is
 * flipped — including whoever flipped it. Instead the password still gets you
 * a session, and that session can reach nothing but enrolment.
 */
async function blockedByTwoFactorPolicy(
  req: FastifyRequest,
  reply: FastifyReply,
  userId: string,
  credential: 'session' | 'api-token',
): Promise<boolean> {
  const { requireTwoFactor } = await settingsService.getSecurityCached();
  if (!requireTwoFactor) return false;

  const user = await db.adminUser.findUnique({ where: { id: userId }, select: { totpEnabled: true } });
  if (user?.totpEnabled) return false;

  // An API token cannot enrol anything — there is no interactive session
  // behind it — so the allowlist would be meaningless. It fails with a
  // message naming the actual cause, because the alternative is an
  // integration that breaks with a generic 403 and no way to guess why.
  if (credential === 'api-token') {
    reply.status(403).send({
      error: {
        code: 'two_factor_required',
        message: 'This API token belongs to an account without two-factor authentication, which this site now requires.',
      },
    });
    return true;
  }

  if (isEnrolmentRoute(req.method, req.url)) return false;

  reply.status(403).send({
    error: {
      code: 'two_factor_required',
      message: 'This site requires two-factor authentication. Set it up on your account to continue.',
      enrollPath: '/account',
    },
  });
  return true;
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
      if (await blockedByTwoFactorPolicy(req, reply, result.userId, 'api-token')) return;
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
      return;
    }
    // OUTSIDE the try on purpose: this reads the database, and a database
    // failure in here must surface as itself, not get swallowed by the catch
    // above and reported as "Authentication required" — which would send
    // everyone to the login screen during an unrelated outage.
    await blockedByTwoFactorPolicy(req, reply, req.user.sub, 'session');
  });
}

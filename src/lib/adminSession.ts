import type { FastifyRequest } from 'fastify';

/**
 * Read and VERIFY the admin session cookie.
 *
 * There were three copies of this logic and they did not agree. Two verified
 * the token; the third tested only that a cookie by that name existed, and that
 * third one guarded the endpoint which issues store credentials — so
 * `Cookie: th_session=garbage` read as a signed-in admin and the endpoint
 * handed out read_write keys to any caller. Confirmed against production.
 *
 * One definition, so a future fourth caller cannot pick the weak reading.
 *
 * `role` is checked as well as the signature: the 2FA challenge token is signed
 * with the same secret and issued after a correct password but BEFORE the
 * second factor. It must never stand in for a completed session.
 */
export interface AdminClaims {
  sub: string;
  role: 'admin' | 'custom';
}

type WithJwt = { jwt: { verify: <T>(token: string) => T } };

export function adminSessionFrom(req: FastifyRequest): AdminClaims | null {
  const raw = /(?:^|;\s*)th_session=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
  if (!raw) return null;
  try {
    const claims = (req.server as unknown as WithJwt).jwt.verify<{ sub?: string; role?: string }>(
      decodeURIComponent(raw),
    );
    if (!claims.sub) return null;
    if (claims.role !== 'admin' && claims.role !== 'custom') return null;
    return { sub: claims.sub, role: claims.role };
  } catch {
    // Expired, forged, or signed with a rotated secret — all of them mean
    // "not signed in", and none of them should reach the caller as an error.
    return null;
  }
}

/** Convenience for the callers that only need the yes/no. */
export function hasAdminSession(req: FastifyRequest): boolean {
  return adminSessionFrom(req) !== null;
}

/**
 * WHY the session was rejected — for screens that must explain themselves.
 *
 * "Sign in" shown to somebody who IS signed in is the single most expensive
 * failure this codebase has produced: six round trips, because every attempt
 * reported the same thing regardless of cause. A screen that names the actual
 * reason turns the next attempt into evidence.
 *
 * Never shown to an anonymous internet caller in a way that reveals anything
 * useful — every branch is about the CALLER'S OWN cookie, which they already
 * have.
 */
export type SessionFailure =
  | 'no-cookie'      // the browser sent no th_session at all for this host
  | 'expired'        // well-formed and correctly signed, but past its exp
  | 'bad-signature'  // signed with a different secret, or tampered with
  | 'wrong-role';    // a 2FA challenge token, not a completed session

export function adminSessionDiagnosis(req: FastifyRequest): SessionFailure | null {
  const raw = /(?:^|;\s*)th_session=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
  if (!raw) return 'no-cookie';
  const token = decodeURIComponent(raw);
  try {
    const claims = (req.server as unknown as WithJwt).jwt.verify<{ sub?: string; role?: string }>(token);
    if (claims.role !== 'admin' && claims.role !== 'custom') return 'wrong-role';
    if (!claims.sub) return 'wrong-role';
    return null;
  } catch {
    // Distinguish "your session ran out" from "this is not our token" by
    // reading the unverified exp. Reading it proves nothing and grants
    // nothing — the signature check above already failed.
    try {
      const body = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString());
      if (typeof body.exp === 'number' && body.exp < Math.floor(Date.now() / 1000)) return 'expired';
    } catch { /* not a JWT shape at all */ }
    return 'bad-signature';
  }
}

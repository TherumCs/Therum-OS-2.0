import { createHmac, timingSafeEqual } from 'node:crypto';
import { db } from '../lib/db.js';
import { env } from '../lib/env.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { ConflictError, UnauthorizedError, TooManyRequestsError } from '../lib/errors.js';
import { checkRateLimit, clearRateLimit } from '../lib/rateLimit.js';
import { authEventService } from './authEvent.service.js';
import { twoFactorService } from './twoFactor.service.js';
import { notificationService } from './notification.service.js';
import type { SetupInput, LoginInput, ChangePasswordInput } from '../schemas/auth.schema.js';

const b64url = (obj: unknown): string => Buffer.from(JSON.stringify(obj)).toString('base64url');
function fromB64url(s: string): Buffer {
  return Buffer.from(s, 'base64url');
}

// Mints the SAME token shape @fastify/jwt verifies everywhere else in this
// API (see scripts/mint-jwt.mjs) — one real auth system, not a parallel one.
// 'custom' carries no bundle info itself — app.authenticate looks that up
// live per request via roleService.resolveAccess(), so editing a role's
// bundles takes effect immediately, not just on the user's next login.
/**
 * 30 days, matching admin/lib/session.ts's SESSION_TTL_SECONDS.
 *
 * These two issuers MUST agree — they mint the same token with the same secret,
 * and a mismatch means a session that one half of the system considers live and
 * the other considers dead.
 *
 * It was 12 hours. A single-operator store logged itself out overnight, and an
 * expired session is invisible: the browser drops the cookie, so the admin tab
 * still looks signed in and the next partner connection lands on a sign-in
 * screen instead of Approve/Deny. That is not what WooCommerce does, and the
 * difference was entirely this number.
 */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export function mintSessionToken(sub: string, role: 'admin' | 'custom' = 'admin'): string {
  return signJwt(sub, role);
}

function signJwt(sub: string, role: 'admin' | 'custom'): string {
  const now = Math.floor(Date.now() / 1000);
  const data = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub, role, iat: now, exp: now + SESSION_TTL_SECONDS })}`;
  return `${data}.${createHmac('sha256', env.JWT_SECRET).update(data).digest('base64url')}`;
}

// A short-lived token proving "password was correct" without granting real
// access — role 'pending2fa' is explicitly rejected by app.authenticate
// (see middleware/auth.ts) so this can never be used as a session token even
// though it's signed with the same secret. 5 minutes, matching common TOTP
// challenge-window practice.
function signChallenge(sub: string): string {
  const now = Math.floor(Date.now() / 1000);
  const data = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub, role: 'pending2fa', iat: now, exp: now + 5 * 60 })}`;
  return `${data}.${createHmac('sha256', env.JWT_SECRET).update(data).digest('base64url')}`;
}

function verifyChallenge(token: string): string {
  const parts = token.split('.');
  if (parts.length !== 3) throw new UnauthorizedError('Invalid or expired challenge.');
  // Length check above guarantees all three exist — noUncheckedIndexedAccess
  // can't see that from a .length comparison, hence the assertions.
  const [headerB64, payloadB64, sigB64] = [parts[0]!, parts[1]!, parts[2]!];
  const data = `${headerB64}.${payloadB64}`;
  const expectedSig = createHmac('sha256', env.JWT_SECRET).update(data).digest('base64url');
  const a = fromB64url(sigB64);
  const b = fromB64url(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedError('Invalid or expired challenge.');
  let payload: { sub?: string; role?: string; exp?: number };
  try {
    payload = JSON.parse(fromB64url(payloadB64).toString());
  } catch {
    throw new UnauthorizedError('Invalid or expired challenge.');
  }
  if (payload.role !== 'pending2fa' || typeof payload.sub !== 'string') throw new UnauthorizedError('Invalid or expired challenge.');
  if (typeof payload.exp !== 'number' || payload.exp <= Math.floor(Date.now() / 1000)) throw new UnauthorizedError('That challenge has expired — sign in again.');
  return payload.sub;
}

export type LoginResult = { token: string; needsTwoFactor?: false } | { needsTwoFactor: true; challengeToken: string };

export const authService = {
  async needsSetup(): Promise<boolean> {
    return (await db.adminUser.count()) === 0;
  },

  // One-time — refuses once any account exists, regardless of who calls it.
  async setup(input: SetupInput): Promise<{ token: string }> {
    if (!(await this.needsSetup())) {
      throw new ConflictError('An admin account already exists — use login instead.', 'username');
    }
    const passwordHash = await hashPassword(input.password);
    const user = await db.adminUser.create({ data: { username: input.username, passwordHash } });
    await authEventService.log('setup', user.username, null);
    return { token: signJwt(user.id, 'admin') };
  },

  async login(input: LoginInput, ip: string | null): Promise<LoginResult> {
    // Rate-limited by username (case-insensitive, matching login's own
    // lookup) BEFORE touching the password at all — 1.9.44 never had this on
    // the primary password step (confirmed in the research pass: only the
    // 2FA-code step was throttled there), so this is a real gap closed, not
    // a port. A single-admin system doesn't need IP-scoping on top of this —
    // there's exactly one real account to protect.
    const rlKey = `login:${input.username.toLowerCase()}`;
    const rl = await checkRateLimit(rlKey, 10, 15 * 60);
    if (!rl.allowed) {
      await authEventService.log('login_locked', input.username, ip);
      throw new TooManyRequestsError('Too many attempts — try again in a few minutes.', rl.retryAfterSeconds);
    }

    // Case-insensitive on purpose — usernames are effectively an identifier
    // people type from memory (like an email), and rejecting "therum" when
    // the stored account is "Therum" is a real usability bug, not a security
    // boundary worth enforcing. findFirst (not findUnique) since Prisma's
    // case-insensitive mode requires a filter, not an exact-index lookup.
    const user = await db.adminUser.findFirst({ where: { username: { equals: input.username, mode: 'insensitive' } } });
    // Constant-shape failure whether the username exists or the password is
    // wrong — don't let the error reveal which one it was.
    if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
      await authEventService.log('login_failure', input.username, ip);
      throw new UnauthorizedError('Invalid username or password.');
    }
    await clearRateLimit(rlKey);

    if (user.totpEnabled) {
      return { needsTwoFactor: true, challengeToken: signChallenge(user.id) };
    }
    await authEventService.log('login_success', user.username, ip);
    void notificationService.notifyLogin(user.username, ip); // fire-and-forget, see notification.service.ts
    return { token: signJwt(user.id, user.roleId ? 'custom' : 'admin') };
  },

  async verifyTwoFactor(challengeToken: string, code: string, ip: string | null): Promise<{ token: string }> {
    const userId = verifyChallenge(challengeToken);
    const user = await db.adminUser.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedError('Invalid or expired challenge.');

    const rlKey = `2fa:${user.id}`;
    const rl = await checkRateLimit(rlKey, 5, 15 * 60);
    if (!rl.allowed) {
      await authEventService.log('login_locked', user.username, ip, '2fa code attempts');
      throw new TooManyRequestsError('Too many attempts — try again in a few minutes.', rl.retryAfterSeconds);
    }

    const ok = await twoFactorService.verifyChallenge(user.id, code);
    if (!ok) {
      await authEventService.log('2fa_challenge_failed', user.username, ip);
      throw new UnauthorizedError('Incorrect code.');
    }
    await clearRateLimit(rlKey);
    await authEventService.log('login_success', user.username, ip);
    void notificationService.notifyLogin(user.username, ip); // fire-and-forget, see notification.service.ts
    return { token: signJwt(user.id, user.roleId ? 'custom' : 'admin') };
  },

  async changePassword(userId: string, input: ChangePasswordInput, ip: string | null): Promise<void> {
    const user = await db.adminUser.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedError();
    if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
      throw new UnauthorizedError('Current password is incorrect.');
    }
    const passwordHash = await hashPassword(input.newPassword);
    await db.adminUser.update({ where: { id: userId }, data: { passwordHash } });
    await authEventService.log('password_changed', user.username, ip);
  },
};

// Verifies the REAL admin JWT issued by the backend's /api/auth/login (or
// /api/auth/setup) — the same token @fastify/jwt verifies on every other API
// route. This replaced an earlier password-only scheme that had its own
// parallel, disconnected session format; there is now exactly one auth
// system, and this is just its Edge-runtime-compatible verifier (Web Crypto
// works identically in the Node server-action runtime and Edge middleware,
// so one implementation serves both).
export const COOKIE_NAME = 'th_session';

// The admin app is mounted at /tos-admin (see admin/next.config.mjs's
// basePath), not bare "/" — this isn't WordPress and shouldn't inherit its
// URL conventions (wp-admin, wp-login.php). next/navigation and next/link
// pick this up automatically; plain fetch() calls to this app's own Route
// Handlers don't, so they need it prefixed by hand — this is that one
// source of truth so it's never duplicated as a magic string.
export const BASE_PATH = '/tos-admin';

// A Route Handler building a redirect Location from `new URL(path, req.url)`
// gets the wrong origin behind this app's nginx proxy: req.url reflects
// Next.js's own internal bind address (localhost:3100), not the public,
// proxied URL the browser is actually on (localhost:10004/tos-admin) — a
// browser following that Location would jump straight to the raw dev-server
// port, breaking the single-door-not-three-ports setup. Building it from the
// request's own Host/X-Forwarded-Proto headers (which nginx forwards
// verbatim) gets the real, externally-correct origin instead. Confirmed live:
// without this, POSTing the appearance form redirected to
// `http://localhost:3100/...` instead of `http://localhost:10004/...`.
export function redirectUrl(req: Request, path: string): URL {
  const proto = req.headers.get('x-forwarded-proto') ?? 'http';
  // X-Forwarded-Host FIRST. This app is an internal upstream behind the API's
  // /tos-admin proxy, and `host` can arrive as the internal bind
  // (127.0.0.1:3100). A provider redirect_uri built from that is an address
  // the outside world cannot reach: the consent screen either refuses it as
  // an unregistered URI or sends the merchant somewhere that does not exist.
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'localhost';
  return new URL(path, `${proto}://${host}`);
}

function jwtSecret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET must be set — see admin/.env.example (must match the backend).');
  return s;
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(jwtSecret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
}

export interface SessionUser {
  sub: string;
  role: string;
}

// Verifies a standard 3-segment HS256 JWT (header.payload.signature) — the
// exact format the backend mints (see src/services/auth.service.ts).
export async function verifyJwt(token: string | undefined | null): Promise<SessionUser | null> {
  return (await inspectSession(token)).user;
}

/**
 * Why a session was rejected — every failure above returns the same null, so
 * "logged out again" could equally be a missing cookie, a secret mismatch or an
 * expired token, and those are three different bugs. This reports which.
 */
export type SessionVerdict =
  | 'ok'
  | 'no-cookie'
  | 'malformed'
  | 'bad-signature'
  | 'expired'
  | 'bad-claims'
  | 'verify-threw';

export async function inspectSession(
  token: string | undefined | null,
): Promise<{ user: SessionUser | null; verdict: SessionVerdict; detail?: string }> {
  if (!token) return { user: null, verdict: 'no-cookie' };
  const [headerB64, payloadB64, sigB64] = token.split('.');
  if (!headerB64 || !payloadB64 || !sigB64) return { user: null, verdict: 'malformed' };
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(), fromB64url(sigB64), new TextEncoder().encode(`${headerB64}.${payloadB64}`));
    // A signature failure here almost always means the admin process and the
    // API are running with DIFFERENT JWT_SECRETs, not that anyone forged one.
    if (!ok) return { user: null, verdict: 'bad-signature' };
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(payloadB64))) as { sub?: string; role?: string; exp?: number };
    if (typeof payload.exp !== 'number') return { user: null, verdict: 'bad-claims' };
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp <= now) {
      return { user: null, verdict: 'expired', detail: `expired ${Math.round((now - payload.exp) / 60)} min ago` };
    }
    if (typeof payload.sub !== 'string' || typeof payload.role !== 'string') return { user: null, verdict: 'bad-claims' };
    return { user: { sub: payload.sub, role: payload.role }, verdict: 'ok', detail: `${Math.round((payload.exp - now) / 60)} min left` };
  } catch (e) {
    return { user: null, verdict: 'verify-threw', detail: e instanceof Error ? e.message : String(e) };
  }
}

// ── Sliding sessions ────────────────────────────────────────────────────
//
// The token lasts 12 hours and NOTHING renewed it. Work straight through the
// afternoon and it expired underneath you; step away for longer than that and
// you came back to the login screen. Either way it reads as "it keeps logging
// me out", because from the browser an expired token and no token at all look
// identical.
//
// So an ACTIVE session now renews itself: once a token is past halfway through
// its life, the next request mints a fresh one. Keep using the admin and you
// stay signed in; leave it alone for 12 hours and it still expires, which is
// the part worth keeping.
//
// This mints the SAME token the backend does (src/services/auth.service.ts's
// signJwt — same header, same claims, same secret), so it is one auth system
// with two issuers, not a parallel scheme.

export const SESSION_TTL_SECONDS = 60 * 60 * 12;

const b64urlFromBytes = (bytes: Uint8Array): string => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const b64urlFromJson = (obj: unknown): string =>
  b64urlFromBytes(new TextEncoder().encode(JSON.stringify(obj)));

async function signingKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(jwtSecret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

export async function signSession(sub: string, role: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const data = `${b64urlFromJson({ alg: 'HS256', typ: 'JWT' })}.${b64urlFromJson({ sub, role, iat: now, exp: now + SESSION_TTL_SECONDS })}`;
  const sig = await crypto.subtle.sign('HMAC', await signingKey(), new TextEncoder().encode(data));
  return `${data}.${b64urlFromBytes(new Uint8Array(sig))}`;
}

/** True once the token is past halfway through its life. */
export function shouldRenew(token: string): boolean {
  const payloadB64 = token.split('.')[1];
  if (!payloadB64) return false;
  try {
    const { exp } = JSON.parse(new TextDecoder().decode(fromB64url(payloadB64))) as { exp?: number };
    if (typeof exp !== 'number') return false;
    return exp - Math.floor(Date.now() / 1000) < SESSION_TTL_SECONDS / 2;
  } catch {
    return false;
  }
}

/**
 * The domain the session cookie should be written for.
 *
 * `sidemoney.co` and `www.sidemoney.co` are separate cookie origins, and both
 * serve this app. Sign in on one and the other sees no session at all — which
 * is invisible until a partner sends the merchant to whichever host they typed
 * into the partner's form, and they land on a login page that will not stick.
 *
 * Writing the cookie for the registrable host (the www. stripped) makes it
 * valid for the apex AND every subdomain, so it stops mattering which one the
 * merchant or the partner uses.
 *
 * Returns undefined for localhost and bare IPs: a Domain attribute is invalid
 * for those, and setting one makes the browser silently drop the cookie —
 * which would break development entirely.
 */
export function sessionCookieDomain(host: string | null | undefined): string | undefined {
  if (!host) return undefined;
  const name = host.split(':')[0]!.toLowerCase();
  if (name === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(name) || !name.includes('.')) return undefined;
  return name.replace(/^www\./, '');
}

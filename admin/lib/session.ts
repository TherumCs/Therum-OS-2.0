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
  const host = req.headers.get('host') ?? 'localhost';
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
  if (!token) return null;
  const [headerB64, payloadB64, sigB64] = token.split('.');
  if (!headerB64 || !payloadB64 || !sigB64) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(), fromB64url(sigB64), new TextEncoder().encode(`${headerB64}.${payloadB64}`));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(payloadB64))) as { sub?: string; role?: string; exp?: number };
    if (typeof payload.exp !== 'number' || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    if (typeof payload.sub !== 'string' || typeof payload.role !== 'string') return null;
    return { sub: payload.sub, role: payload.role };
  } catch {
    return null;
  }
}

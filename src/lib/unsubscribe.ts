import { createHmac, timingSafeEqual } from 'node:crypto';

// Signed, per-recipient unsubscribe tokens.
//
// The email footer used to link "Unsubscribe" straight at /account — a dead
// control that opted no one out of anything. A real unsubscribe has to (a) name
// WHICH recipient without letting anyone opt out a stranger by editing a URL,
// and (b) need no login (the whole point is that it works from the inbox). An
// HMAC over the address does both: only the server can mint a valid token, and
// the link carries its own proof.
//
// Keyed on JWT_SECRET (already the app's signing secret); a per-install secret
// means a token minted here is only ever valid here.

function secret(): string {
  return process.env.JWT_SECRET || process.env.SECURE_AUTH_KEY || 'therum-dev-unsubscribe-secret';
}

function norm(email: string): string {
  return String(email ?? '').trim().toLowerCase();
}

/** Deterministic token proving the server addressed this exact recipient. */
export function unsubscribeToken(email: string): string {
  return createHmac('sha256', secret()).update(`unsub:${norm(email)}`).digest('base64url').slice(0, 32);
}

/** Constant-time verify; false on any length/format mismatch. */
export function verifyUnsubscribeToken(email: string, token: string): boolean {
  const expected = Buffer.from(unsubscribeToken(email));
  const given = Buffer.from(String(token ?? ''));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * Absolute one-click unsubscribe URL for this recipient.
 *
 * Under /api/ on purpose: the route is registered in counterPublicRoutes with
 * the /api prefix, and the bare `/shop/unsubscribe` form this used to build
 * was swallowed by the storefront's WP-style `/shop/<slug>` → `/product/<slug>`
 * redirect — every footer link and List-Unsubscribe header 301'd to a 404
 * product page, so nobody could actually opt out. Found 2026-09-15.
 */
export function unsubscribeUrl(email: string): string {
  const origin = (process.env.PUBLIC_ORIGIN ?? '').replace(/\/+$/, '');
  const q = new URLSearchParams({ e: norm(email), t: unsubscribeToken(email) });
  return `${origin}/api/shop/unsubscribe?${q.toString()}`;
}

// ── Re-subscribe confirmation ─────────────────────────────────────────────
// An address that OPTED OUT is not put back on the list by a form post — the
// form is unauthenticated, so that would let anyone re-enrol a stranger who
// had asked to be left alone. Instead the address receives one email with a
// signed link, and only that click restores consent. Same key, different
// purpose string, so an unsubscribe token can never double as a confirm.

export function resubscribeToken(email: string): string {
  return createHmac('sha256', secret()).update(`resub:${norm(email)}`).digest('base64url').slice(0, 32);
}

export function verifyResubscribeToken(email: string, token: string): boolean {
  const expected = Buffer.from(resubscribeToken(email));
  const given = Buffer.from(String(token ?? ''));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function resubscribeUrl(email: string): string {
  const origin = (process.env.PUBLIC_ORIGIN ?? '').replace(/\/+$/, '');
  const q = new URLSearchParams({ e: norm(email), t: resubscribeToken(email) });
  return `${origin}/api/shop/resubscribe?${q.toString()}`;
}


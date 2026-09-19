import { createHmac, timingSafeEqual } from 'node:crypto';

// Signed click-tracking targets.
//
// `/api/m/c/<token>?u=<url>` used to 302 to ANY http(s) `u` whether or not the
// token was real, which made the store an open redirect: a stranger could hand
// people a store-branded link that landed anywhere, and every marketing
// email had been teaching recipients that this exact URL shape is safe. Now the
// sender signs `token|url` when it rewrites the link, and the route only follows
// a `u` whose signature checks out. Keyed on JWT_SECRET like the unsubscribe
// token; a signature minted here is only ever valid here.

function secret(): string {
  return process.env.JWT_SECRET || process.env.SECURE_AUTH_KEY || 'therum-dev-click-secret';
}

/** Proof that THIS send's message contained THIS link. */
export function signClick(token: string, url: string): string {
  return createHmac('sha256', secret()).update(`click:${token}|${url}`).digest('base64url').slice(0, 22);
}

/** Constant-time verify; false on any length/format mismatch. */
export function verifyClick(token: string, url: string, sig: string): boolean {
  const expected = Buffer.from(signClick(token, url));
  const given = Buffer.from(String(sig ?? ''));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

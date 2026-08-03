import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { db } from '../lib/db.js';
import { env } from '../lib/env.js';
import { decryptSecret } from '../lib/crypto.js';

// "Sign in with Google" for the store admin — specifically so the partner
// approval screen does not have to ask for a password.
//
// REDIRECT flow, not Google's JavaScript button. The approval screen ships
// `script-src 'none'`, and loading a third-party script into the one page that
// hands out read/write store keys is a bad trade for a nicer button. This needs
// no JS at all: a link out, a callback back.
//
// The identity check is deliberately narrow. A verified Google email is proof
// of WHO someone is, never proof that they may administer this store — the
// email must already be linked to an admin account (AdminUser.googleEmail).
// Accepting any verified Google account would re-open the credential-vending
// hole with a friendlier front door.

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';

export interface GoogleApp {
  clientId: string;
  clientSecret: string;
}

/** The store's Google OAuth app, from the Nexus connection. Null if not set up. */
export async function googleApp(): Promise<GoogleApp | null> {
  // 'google-signin' is the id this store's Nexus catalogue already uses for
  // Sign in with Google (nexusCatalog.ts), stored as "clientId|clientSecret" —
  // its declared join. Reading a different provider id, or splitting on a
  // different character, would mean the operator connects it in Nexus and the
  // button still never appears.
  const row = await db.connection.findFirst({ where: { provider: 'google-signin' } });
  if (!row?.credentialEncrypted) return null;
  try {
    const raw = decryptSecret(row.credentialEncrypted);
    const [clientId, ...rest] = raw.split('|');
    const clientSecret = rest.join('|').trim();
    return clientId?.trim() && clientSecret ? { clientId: clientId.trim(), clientSecret } : null;
  } catch {
    return null;
  }
}

/**
 * The `state` parameter, signed.
 *
 * It carries where to return to after Google, and it is the CSRF defence for
 * the callback: an attacker who can make the browser hit our callback with
 * their own code must not be able to nominate the return destination. Signed
 * with JWT_SECRET and given a short life, so a stale or forged state is
 * refused rather than followed.
 */
export function signState(returnTo: string): string {
  const body = Buffer.from(JSON.stringify({ r: returnTo, t: Date.now(), n: randomBytes(8).toString('hex') })).toString('base64url');
  const sig = createHmac('sha256', env.JWT_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function readState(state: string): { returnTo: string } | null {
  const [body, sig] = state.split('.');
  if (!body || !sig) return null;
  const expect = createHmac('sha256', env.JWT_SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { r, t } = JSON.parse(Buffer.from(body, 'base64url').toString()) as { r: string; t: number };
    // Ten minutes. Long enough to finish a Google sign-in, short enough that a
    // leaked link is not a standing invitation.
    if (Date.now() - t > 10 * 60 * 1000) return null;
    return { returnTo: r };
  } catch {
    return null;
  }
}

export function authorizeUrl(app: GoogleApp, redirectUri: string, state: string): string {
  const q = new URLSearchParams({
    client_id: app.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    // Always show the picker: this account is the one being authorised to hand
    // out store keys, so silently reusing whichever Google session happens to
    // be active is the wrong default.
    prompt: 'select_account',
  });
  return `${GOOGLE_AUTH}?${q}`;
}

export interface GoogleIdentity { email: string; emailVerified: boolean; name?: string }

/** Exchange the code and read the identity out of Google's id_token. */
export async function exchangeCode(app: GoogleApp, code: string, redirectUri: string): Promise<GoogleIdentity | null> {
  const res = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: app.clientId,
      client_secret: app.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { id_token?: string };
  if (!json.id_token) return null;

  // The id_token comes straight from Google's token endpoint over TLS, in
  // response to a code only we could redeem (it needs the client secret), so
  // the signature adds nothing here — this is the "code flow" case where the
  // transport IS the proof. Claims are still read defensively.
  const payload = json.id_token.split('.')[1];
  if (!payload) return null;
  try {
    const c = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
      email?: string; email_verified?: boolean | string; name?: string;
    };
    if (!c.email) return null;
    return {
      email: c.email.toLowerCase(),
      emailVerified: c.email_verified === true || c.email_verified === 'true',
      ...(c.name ? { name: c.name } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * The admin this Google identity is allowed to be, or null.
 *
 * Unverified email is refused outright: an unverified address is a claim, not
 * an identity, and Google will happily mint a token for one.
 */
export async function adminForGoogle(identity: GoogleIdentity) {
  if (!identity.emailVerified) return null;
  return db.adminUser.findFirst({
    where: { googleEmail: identity.email },
    select: { id: true, username: true, roleId: true },
  });
}

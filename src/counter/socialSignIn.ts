import { createPublicKey, createVerify } from 'node:crypto';
import { ValidationError, UnauthorizedError } from '../lib/errors.js';
import { nexusBridge } from './nexusBridge.js';

// Counter — verifying a social sign-in.
//
// customerAuth.signInWithOAuth deliberately takes an ALREADY-VERIFIED profile
// and says so in its own comment: "Accepting an unverified provider id here
// would let anyone sign in as anyone by posting a subject." This file is the
// half that does the verifying, and until it existed the storefront had no
// route to social sign-in at all — the service was unreachable.
//
// What "verified" means here, concretely:
//
//   The id_token is a JWT signed by the PROVIDER. We fetch the provider's
//   published public keys, verify the RS256 signature against the key whose
//   `kid` the token names, and only then read any claim out of it. Decoding
//   the payload without checking the signature — which is what a naive
//   implementation does, because the payload is just base64 — accepts a token
//   anyone can type by hand.
//
//   `aud` MUST equal our own client id. A token is minted for a specific
//   application; one issued to a DIFFERENT app is still perfectly signed by
//   Google. Skipping this check is the classic confused-deputy hole: an
//   attacker signs in to their own app, then replays that token here.
//
//   `iss` must be the provider's own issuer, and `exp` must be in the future.
//
// The client id comes from Nexus, never from the request. A client id posted
// by the caller would let them nominate the audience they are checked
// against, which is the same as not checking.
//
// No JWT library: Node can build a public key straight from a JWK, and this
// is one signature check against one algorithm. A dependency here would be a
// supply-chain surface on the most security-critical path in the storefront.

export type SocialProvider = 'google' | 'apple' | 'facebook';

interface ProviderSpec {
  /** Nexus provider id holding the credentials. */
  connection: string;
  issuers: string[];
  jwksUrl: string;
}

const PROVIDERS: Record<SocialProvider, ProviderSpec> = {
  google: {
    connection: 'google-signin',
    issuers: ['https://accounts.google.com', 'accounts.google.com'],
    jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
  },
  apple: {
    connection: 'apple-signin',
    issuers: ['https://appleid.apple.com'],
    jwksUrl: 'https://appleid.apple.com/auth/keys',
  },
  facebook: {
    // Facebook Login does not issue an id_token by default — it is verified
    // through the Graph API instead, see verifyFacebook below.
    connection: 'facebook-login',
    issuers: [],
    jwksUrl: '',
  },
};

export interface VerifiedProfile {
  provider: SocialProvider;
  subject: string;
  email?: string;
  name?: string;
  emailVerified: boolean;
}

interface Jwk {
  kid?: string;
  kty?: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
}

/**
 * JWKS cache.
 *
 * Providers rotate signing keys, and re-fetching per sign-in would put a
 * third-party HTTP round trip in the middle of every login. Ten minutes is
 * short enough that a rotation heals on its own, and a `kid` miss forces an
 * immediate refetch regardless — so a rotation is never a hard failure.
 */
const jwksCache = new Map<string, { keys: Jwk[]; at: number }>();
const JWKS_TTL_MS = 10 * 60 * 1000;

type Fetcher = (url: string) => Promise<unknown>;

const defaultFetch: Fetcher = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new UnauthorizedError(`Could not reach the sign-in provider (${res.status}).`);
  return res.json();
};

async function jwks(url: string, force: boolean, fetcher: Fetcher): Promise<Jwk[]> {
  const hit = jwksCache.get(url);
  if (!force && hit && Date.now() - hit.at < JWKS_TTL_MS) return hit.keys;
  const body = (await fetcher(url)) as { keys?: Jwk[] };
  const keys = Array.isArray(body?.keys) ? body.keys : [];
  if (keys.length === 0) throw new UnauthorizedError('The sign-in provider published no signing keys.');
  jwksCache.set(url, { keys, at: Date.now() });
  return keys;
}

/** Exposed for tests — a stale cache must not make a rotation test pass. */
export function clearJwksCache(): void {
  jwksCache.clear();
}

function decodeSegment(segment: string): Record<string, unknown> {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new UnauthorizedError('That sign-in token is malformed.');
  }
}

/**
 * Verifies an RS256 JWT against a JWKS and returns its claims.
 *
 * Every failure is the same UnauthorizedError to the caller. Reporting
 * "expired" separately from "bad signature" tells an attacker which half of
 * their forgery worked.
 */
async function verifyRs256(token: string, spec: ProviderSpec, audience: string, fetcher: Fetcher): Promise<Record<string, unknown>> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new UnauthorizedError('That sign-in token is malformed.');
  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

  const header = decodeSegment(headerB64);
  // Pinned, not read-and-trusted. `alg: none` and the HS256-with-the-public-
  // key-as-secret trick are both defeated by refusing anything else outright.
  if (header.alg !== 'RS256') throw new UnauthorizedError('Unsupported sign-in token algorithm.');

  const signed = `${headerB64}.${payloadB64}`;
  const signature = Buffer.from(signatureB64, 'base64url');

  const matching = async (force: boolean): Promise<Jwk | undefined> => {
    const keys = await jwks(spec.jwksUrl, force, fetcher);
    return keys.find((k) => k.kid === header.kid) ?? (keys.length === 1 ? keys[0] : undefined);
  };
  // A `kid` we have never seen usually means the provider just rotated —
  // refetch once before rejecting, or every login fails until the TTL expires.
  let key = await matching(false);
  if (!key) key = await matching(true);
  if (!key) throw new UnauthorizedError('That sign-in token was signed with an unknown key.');

  // Node builds a public key straight from a JWK. The cast is only to satisfy
  // @types/node, which does not export the JsonWebKey shape this overload wants.
  const publicKey = createPublicKey({ key, format: 'jwk' } as unknown as Parameters<typeof createPublicKey>[0]);
  const ok = createVerify('RSA-SHA256').update(signed).verify(publicKey, signature);
  if (!ok) throw new UnauthorizedError('That sign-in token failed verification.');

  const claims = decodeSegment(payloadB64);

  const exp = typeof claims.exp === 'number' ? claims.exp : 0;
  if (exp * 1000 <= Date.now()) throw new UnauthorizedError('That sign-in token has expired.');

  const iss = typeof claims.iss === 'string' ? claims.iss : '';
  if (!spec.issuers.includes(iss)) throw new UnauthorizedError('That sign-in token came from the wrong issuer.');

  // `aud` may be a string or an array — both are legal, and handling only the
  // string case silently accepts array-audience tokens unchecked.
  const aud = claims.aud;
  const audiences = Array.isArray(aud) ? aud.map(String) : typeof aud === 'string' ? [aud] : [];
  if (!audiences.includes(audience)) {
    throw new UnauthorizedError('That sign-in token was issued for a different application.');
  }

  const sub = typeof claims.sub === 'string' ? claims.sub : '';
  if (!sub) throw new UnauthorizedError('That sign-in token identifies no account.');

  return claims;
}

/** First field of a Nexus credential — the client id for every provider here. */
function clientIdOf(credential: string): string {
  const id = credential.split('|')[0]?.trim() ?? '';
  if (!id) throw new ValidationError('No client ID is configured for this sign-in provider.', 'provider');
  return id;
}

export const socialSignIn = {
  /**
   * Verifies a provider token and returns a profile safe to hand to
   * customerAuth.signInWithOAuth.
   */
  async verify(
    provider: SocialProvider,
    token: string,
    fetcher: Fetcher = defaultFetch,
  ): Promise<VerifiedProfile> {
    const spec = PROVIDERS[provider];
    if (!spec) throw new ValidationError(`${provider} is not a supported sign-in provider.`, 'provider');
    if (!token.trim()) throw new ValidationError('No sign-in token was supplied.', 'token');

    // Throws with the reason if the provider is not connected in Nexus —
    // "the button did nothing" is the worst possible failure here.
    const { credential } = await nexusBridge.require(spec.connection, 'identity');
    const clientId = clientIdOf(credential);

    if (provider === 'facebook') return this.verifyFacebook(token, credential, fetcher);

    const claims = await verifyRs256(token, spec, clientId, fetcher);
    // Apple lets a user hide their real address and sends a relay one; Google
    // sends email_verified. Either way this flag decides whether
    // signInWithOAuth may link to an existing account by email, so a missing
    // value must read as NOT verified.
    const emailVerified = claims.email_verified === true || claims.email_verified === 'true';
    return {
      provider,
      subject: String(claims.sub),
      ...(typeof claims.email === 'string' ? { email: claims.email } : {}),
      ...(typeof claims.name === 'string' ? { name: claims.name } : {}),
      emailVerified,
    };
  },

  /**
   * Facebook has no id_token to verify, so the token is validated by asking
   * Facebook about it.
   *
   * debug_token FIRST, then /me. /me alone would confirm the token is valid
   * for SOME app — including an attacker's — which is the same
   * confused-deputy hole the `aud` check closes for the JWT providers.
   */
  async verifyFacebook(token: string, credential: string, fetcher: Fetcher): Promise<VerifiedProfile> {
    const [appId, appSecret] = credential.split('|');
    if (!appId || !appSecret) throw new ValidationError('Facebook Login needs both an App ID and an App Secret.', 'provider');

    const debug = (await fetcher(
      `https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`,
    )) as { data?: { app_id?: string; is_valid?: boolean; user_id?: string } };

    const data = debug?.data;
    if (!data?.is_valid) throw new UnauthorizedError('That Facebook sign-in is not valid.');
    if (data.app_id !== appId) throw new UnauthorizedError('That Facebook sign-in was issued for a different application.');
    if (!data.user_id) throw new UnauthorizedError('That Facebook sign-in identifies no account.');

    const me = (await fetcher(
      `https://graph.facebook.com/v21.0/me?fields=id,name,email&access_token=${encodeURIComponent(token)}`,
    )) as { id?: string; name?: string; email?: string };

    // Trust debug_token's user_id over /me's — they are the same value from
    // the same source, but only the first was checked against our app id.
    return {
      provider: 'facebook',
      subject: data.user_id,
      ...(me?.email ? { email: me.email } : {}),
      ...(me?.name ? { name: me.name } : {}),
      // Facebook only returns an address it has already confirmed, and offers
      // no per-field verification flag.
      emailVerified: Boolean(me?.email),
    };
  },

  /** Which social buttons the storefront should actually render. */
  async available(): Promise<{ provider: SocialProvider; ready: boolean; reason?: string }[]> {
    const out: { provider: SocialProvider; ready: boolean; reason?: string }[] = [];
    for (const provider of Object.keys(PROVIDERS) as SocialProvider[]) {
      const spec = PROVIDERS[provider];
      const ready = await nexusBridge.isConnected(spec.connection, 'identity');
      out.push({
        provider,
        ready,
        ...(ready ? {} : { reason: `${spec.connection} is not connected in Nexus.` }),
      });
    }
    return out;
  },
};

export const SOCIAL_PROVIDERS = Object.keys(PROVIDERS) as SocialProvider[];

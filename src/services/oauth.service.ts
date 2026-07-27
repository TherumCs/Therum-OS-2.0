import { createHmac, randomBytes } from 'node:crypto';
import { db } from '../lib/db.js';
import { env } from '../lib/env.js';
import { encryptSecret, decryptSecret } from '../lib/crypto.js';
import { NotFoundError, ConflictError } from '../lib/errors.js';
import { connectionService } from './connection.service.js';

interface OAuthProviderConfig {
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  tokenField: string;
}

// Real, documented, stable authorize/token endpoints — not placeholders.
// The four Google services share Google's one OAuth stack; only scopes
// differ. One Google Cloud app (client id/secret) configured under ANY of
// them powers all four — see googleAppFallback below.
const GOOGLE_AUTH = { authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token', tokenField: 'access_token' };

const OAUTH_PROVIDERS: Record<string, OAuthProviderConfig> = {
  slack: { authorizeUrl: 'https://slack.com/oauth/v2/authorize', tokenUrl: 'https://slack.com/api/oauth.v2.access', scope: 'channels:read,chat:write', tokenField: 'access_token' },
  github: { authorizeUrl: 'https://github.com/login/oauth/authorize', tokenUrl: 'https://github.com/login/oauth/access_token', scope: 'read:user', tokenField: 'access_token' },
  'google-drive': { ...GOOGLE_AUTH, scope: 'https://www.googleapis.com/auth/drive.readonly' },
  gmail: { ...GOOGLE_AUTH, scope: 'https://www.googleapis.com/auth/gmail.readonly' },
  'google-calendar': { ...GOOGLE_AUTH, scope: 'https://www.googleapis.com/auth/calendar.readonly' },
  'google-sheets': { ...GOOGLE_AUTH, scope: 'https://www.googleapis.com/auth/spreadsheets.readonly' },
};

const GOOGLE_FAMILY = new Set(['google-drive', 'gmail', 'google-calendar', 'google-sheets']);

// A Google Cloud OAuth app configured under any one Google service is valid
// for the whole family (Google apps aren't service-scoped; scopes are asked
// per authorization). Resolution order: the provider's own row, then any
// family sibling's row.
async function googleAppFallback(provider: string): Promise<string[]> {
  return GOOGLE_FAMILY.has(provider) ? [provider, ...[...GOOGLE_FAMILY].filter((p) => p !== provider)] : [provider];
}

function stateKey(): Buffer {
  return createHmac('sha256', env.JWT_SECRET).update('nexus-oauth-state').digest();
}

// Stateless CSRF state — signed, not stored server-side, verified on
// callback without a DB round trip. Same "short-lived signed token" shape
// as 2FA's challengeToken (see auth.service.ts's signChallenge).
function signState(provider: string): string {
  const nonce = randomBytes(12).toString('base64url');
  const exp = Date.now() + 10 * 60 * 1000;
  const payload = `${provider}.${nonce}.${exp}`;
  const sig = createHmac('sha256', stateKey()).update(payload).digest('base64url');
  return Buffer.from(`${payload}.${sig}`).toString('base64url');
}

function verifyState(provider: string, state: string): boolean {
  try {
    const decoded = Buffer.from(state, 'base64url').toString('utf8');
    const [p, nonce, expStr, sig] = decoded.split('.');
    if (p !== provider || !nonce || !expStr || !sig) return false;
    const expected = createHmac('sha256', stateKey()).update(`${p}.${nonce}.${expStr}`).digest('base64url');
    if (sig !== expected) return false;
    return Number(expStr) > Date.now();
  } catch {
    return false;
  }
}

export const oauthService = {
  providers(): string[] {
    return Object.keys(OAUTH_PROVIDERS);
  },

  isOAuthProvider(provider: string): boolean {
    return provider in OAUTH_PROVIDERS;
  },

  async getApp(provider: string): Promise<{ clientId: string; clientSecret: string } | null> {
    for (const candidate of await googleAppFallback(provider)) {
      const row = await db.oAuthAppCredential.findUnique({ where: { provider: candidate } });
      if (row) return { clientId: row.clientId, clientSecret: decryptSecret(row.clientSecretEncrypted) };
    }
    return null;
  },

  async hasApp(provider: string): Promise<boolean> {
    return (await this.getApp(provider)) !== null;
  },

  async setApp(provider: string, clientId: string, clientSecret: string): Promise<void> {
    if (!OAUTH_PROVIDERS[provider]) throw new NotFoundError('Not an OAuth provider', 'provider');
    await db.oAuthAppCredential.upsert({
      where: { provider },
      update: { clientId, clientSecretEncrypted: encryptSecret(clientSecret) },
      create: { provider, clientId, clientSecretEncrypted: encryptSecret(clientSecret) },
    });
  },

  async startUrl(provider: string, redirectUri: string): Promise<string> {
    const config = OAUTH_PROVIDERS[provider];
    if (!config) throw new NotFoundError('Not an OAuth provider', 'provider');
    const app = await this.getApp(provider);
    if (!app) throw new ConflictError('No OAuth app configured for this provider yet — set client id/secret first.', 'provider');
    const url = new URL(config.authorizeUrl);
    url.searchParams.set('client_id', app.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', config.scope);
    url.searchParams.set('state', signState(provider));
    if (GOOGLE_FAMILY.has(provider)) {
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('access_type', 'offline');
      url.searchParams.set('prompt', 'consent');
    }
    return url.toString();
  },

  async handleCallback(provider: string, code: string, state: string, redirectUri: string, actorId: string): Promise<void> {
    const config = OAUTH_PROVIDERS[provider];
    if (!config) throw new NotFoundError('Not an OAuth provider', 'provider');
    if (!verifyState(provider, state)) throw new ConflictError('Invalid or expired OAuth state.', 'state');
    const app = await this.getApp(provider);
    if (!app) throw new ConflictError('No OAuth app configured for this provider.', 'provider');

    const body = new URLSearchParams({ client_id: app.clientId, client_secret: app.clientSecret, code, redirect_uri: redirectUri, grant_type: 'authorization_code' });
    const res = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body,
    });
    if (!res.ok) throw new ConflictError(`Token exchange failed: ${res.status} ${res.statusText}`, 'code');
    const json = (await res.json()) as Record<string, unknown>;
    const token = json[config.tokenField];
    if (typeof token !== 'string' || !token) {
      throw new ConflictError(`Provider did not return an access token (${JSON.stringify(json).slice(0, 200)}).`, 'code');
    }
    await connectionService.connect(provider, token, actorId);
  },
};

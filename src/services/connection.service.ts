import { db } from '../lib/db.js';
import { NotFoundError, ConflictError } from '../lib/errors.js';
import { encryptSecret, decryptSecret, maskSecret } from '../lib/crypto.js';
import { nexusCatalog, findProvider, type CatalogProvider } from '../lib/nexusCatalog.js';
import { oauthService } from './oauth.service.js';
import { verifyGithubSignature, verifyStripeSignature, verifySlackSignature } from '../lib/webhookSignatures.js';

// The only providers with a real, wired signature scheme (see
// webhookSignatures.ts) — every other provider's webhook is logged but
// never claimed to be verified.
const SIGNATURE_PROVIDERS = new Set(['github', 'stripe', 'slack']);

type TestResult = { ok: boolean; detail: string };
type Tester = (credential: string) => Promise<TestResult>;

async function get(url: string, headers: Record<string, string>): Promise<TestResult> {
  try {
    const res = await fetch(url, { headers });
    return { ok: res.ok, detail: res.ok ? `${res.status} OK` : `${res.status} ${res.statusText}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : 'Network error' };
  }
}
const bearerGet = (url: string, c: string): Promise<TestResult> => get(url, { Authorization: `Bearer ${c}` });

// Some provider APIs are POST-only even for cheap identity reads
// (Dropbox get_current_account, Braintree's GraphQL ping).
async function post(url: string, headers: Record<string, string>, body: string | null = null): Promise<TestResult> {
  try {
    const res = await fetch(url, { method: 'POST', headers, ...(body === null ? {} : { body }) });
    return { ok: res.ok, detail: res.ok ? `${res.status} OK` : `${res.status} ${res.statusText}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : 'Network error' };
  }
}

function basicAuthHeader(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

// "FIRST:SECOND" — see CatalogProvider.credentialHint for which providers
// need this instead of a plain single value.
/**
 * First field of a pipe-joined credential.
 *
 * Providers whose catalog entry declares `fields` with `join: '|'` store every
 * part in one vault string. A tester that passes the WHOLE string as a bearer
 * token would send "token|storeId" and get a 401 that looks like a bad key —
 * so anything that only needs the first part must ask for it explicitly.
 */
function firstField(c: string): string {
  return c.split('|')[0] ?? c;
}

function splitCredential(c: string): [string, string] | null {
  const idx = c.indexOf(':');
  if (idx === -1) return null;
  const first = c.slice(0, idx);
  const second = c.slice(idx + 1);
  return first && second ? [first, second] : null;
}

// Real testers — each makes a genuine, low-risk call to the provider's own
// API using the stored credential. Only providers listed here get a
// working "test credential" button; every other catalog entry is
// credential storage only, honestly (testable: false in list()), not faked.
/**
 * Rejects a credential whose SHAPE is wrong, before it is ever stored.
 *
 * There was no validation at all, so any text saved into any field. A store
 * NAME went into a Store ID box, sat there encrypted looking connected, and
 * surfaced later as an unexplained 401 from the provider. Catching it at the
 * point of typing turns a mystery into one sentence.
 *
 * Patterns are deliberately loose — a prefix or an obvious format, never an
 * attempt to validate the whole secret. A pattern strict enough to reject a
 * VALID credential is far worse than no pattern, because the merchant cannot
 * work around it.
 */
function validateCredential(provider: CatalogProvider, credential: string): void {
  if (provider.fields?.length) {
    const parts = credential.split(provider.join ?? '|');
    provider.fields.forEach((field, i) => {
      const value = (parts[i] ?? '').trim();
      if (!value) {
        if (!field.optional) throw new ConflictError(`${field.label} is required.`, 'credential');
        return;
      }
      if (field.pattern && !new RegExp(field.pattern).test(value)) {
        throw new ConflictError(
          `${field.label} does not look right${field.example ? ` — expected something like ${field.example}` : ''}.`,
          'credential',
        );
      }
    });
    return;
  }
  if (provider.pattern && !new RegExp(provider.pattern).test(credential.trim())) {
    throw new ConflictError(
      `That does not look like a ${provider.name} credential${provider.example ? ` — expected something like ${provider.example}` : ''}.`,
      'credential',
    );
  }
}

// Providers that can ALSO be connected by authorizing in a browser.
const OAUTH_CAPABLE = new Set(oauthService.providers());

const TESTERS: Record<string, Tester> = {
  // AI tools
  openai: (c) => bearerGet('https://api.openai.com/v1/models', c),
  anthropic: (c) => get('https://api.anthropic.com/v1/models', { 'x-api-key': c, 'anthropic-version': '2023-06-01' }),
  gemini: (c) => get(`https://generativelanguage.googleapis.com/v1/models?key=${encodeURIComponent(c)}`, {}),
  mistral: (c) => bearerGet('https://api.mistral.ai/v1/models', c),
  grok: (c) => bearerGet('https://api.x.ai/v1/models', c),
  replicate: (c) => get('https://api.replicate.com/v1/account', { Authorization: `Token ${c}` }),
  huggingface: (c) => bearerGet('https://huggingface.co/api/whoami-v2', c),
  stability: (c) => bearerGet('https://api.stability.ai/v1/user/account', c),
  cohere: (c) => bearerGet('https://api.cohere.ai/v1/models', c),

  // Messaging & APIs
  sendgrid: (c) => bearerGet('https://api.sendgrid.com/v3/user/account', c),
  resend: (c) => bearerGet('https://api.resend.com/domains', c),
  // Basic auth with the key as the USERNAME and no password — the trailing
  // colon is load-bearing. Sent as a bearer token this returns 401 and the
  // operator concludes their key is bad.
  flodesk: (c) => get('https://api.flodesk.com/v1/segments', {
    Authorization: `Basic ${Buffer.from(`${c}:`).toString('base64')}`,
    'User-Agent': 'Therum OS (therum.studio)',
  }),
  postmark: (c) => get('https://api.postmarkapp.com/server', { 'X-Postmark-Server-Token': c, Accept: 'application/json' }),
  mapbox: (c) => get(`https://api.mapbox.com/geocoding/v5/mapbox.places/test.json?access_token=${encodeURIComponent(c)}`, {}),
  telegram: (c) => get(`https://api.telegram.org/bot${encodeURIComponent(c)}/getMe`, {}),
  discord: (c) => get('https://discord.com/api/v10/users/@me', { Authorization: `Bot ${c}` }),
  twilio: async (c) => {
    const parts = splitCredential(c);
    if (!parts) return { ok: false, detail: 'Expected "Account SID:Auth Token".' };
    const [sid, token] = parts;
    return get(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}.json`, { Authorization: basicAuthHeader(sid, token) });
  },

  // Ecommerce — none of the 8 have a simple read-only "am I authorized"
  // endpoint that isn't store-specific (Shopify/BigCommerce/etc. all need a
  // per-store domain, not just a key) — real work, not done this pass.

  // Fulfillment (POD)
  // Printful accepts either shape, so the tester tries both rather than
  // declaring a working credential invalid: a key+secret pair authenticates
  // as Basic, a lone private token as Bearer. Reporting "invalid key" for a
  // credential that is actually fine is the worst outcome here — it sends the
  // merchant back to regenerate something that was never the problem.
  printful: async (c) => {
    // BEARER ONLY. This used to try Basic first for a key+secret pair, which
    // was correct until Printful retired API-key auth. Its API now answers
    // "Basic API token authentication is no longer supported... create a new
    // OAuth 2.0 token" — verified live against a stored legacy key, which
    // 401s. Trying Basic now only produces a confusing failure before the
    // Bearer attempt that was always going to be the real one.
    const [first] = c.split('|');
    return bearerGet('https://api.printful.com/stores', first ?? c);
  },
  printify: (c) => bearerGet('https://api.printify.com/v1/shops.json', firstField(c)),
  // Endpoints and header names probed live (both answer 401 to a bad key, so a
  // 200 means the credential is real) rather than taken from a summary.
  gelato: (c) => get('https://product.gelatoapis.com/v3/catalogs', { 'X-API-KEY': firstField(c) }),
  spod: (c) => get('https://rest.spod.com/orders', { 'X-SPOD-ACCESS-TOKEN': firstField(c) }),

  // Payments
  stripe: (c) => bearerGet('https://api.stripe.com/v1/balance', c),
  square: (c) => bearerGet('https://connect.squareup.com/v2/locations', c),
  'coinbase-commerce': (c) => get('https://api.commerce.coinbase.com/charges', { 'X-CC-Api-Key': firstField(c) }),
  whop: (c) => bearerGet('https://api.whop.com/api/v2/me', c),
  wise: (c) => bearerGet('https://api.wise.com/v1/profiles', firstField(c)),
  paypal: async (c) => {
    const parts = splitCredential(c);
    if (!parts) return { ok: false, detail: 'Expected "Client ID:Secret".' };
    const [clientId, secret] = parts;
    try {
      const res = await fetch('https://api-m.paypal.com/v1/oauth2/token', {
        method: 'POST',
        headers: { Authorization: basicAuthHeader(clientId, secret), 'content-type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials',
      });
      return { ok: res.ok, detail: res.ok ? `${res.status} OK` : `${res.status} ${res.statusText} (live endpoint — sandbox creds fail here)` };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : 'Network error' };
    }
  },

  // External apps
  dropbox: (c) => post('https://api.dropboxapi.com/2/users/get_current_account', { Authorization: `Bearer ${c}` }),
  figma: (c) => get('https://api.figma.com/v1/me', { 'X-Figma-Token': c }),
  calendly: (c) => bearerGet('https://api.calendly.com/users/me', c),
  // Braintree GraphQL — basic auth over "PublicKey:PrivateKey". Two traps
  // found probing this for real: (1) `ping` answers 200 WITHOUT auth, so it
  // proves nothing — the tester asks for the authenticated viewer instead
  // and requires a non-null merchant in the response body; (2) the endpoint
  // differs per environment, and sandbox keys are the common case while
  // wiring up, so production is tried first with a sandbox fallback.
  braintree: async (c) => {
    const parts = splitCredential(c);
    if (!parts) return { ok: false, detail: 'Expected "Public Key:Private Key"' };
    const headers = {
      Authorization: basicAuthHeader(parts[0], parts[1]),
      'braintree-version': '2019-01-01',
      'content-type': 'application/json',
    };
    const body = JSON.stringify({ query: 'query { viewer { merchant { id } } }' });
    const probe = async (url: string): Promise<TestResult> => {
      try {
        const res = await fetch(url, { method: 'POST', headers, body });
        if (!res.ok) return { ok: false, detail: `${res.status} ${res.statusText}` };
        const json = (await res.json()) as { data?: { viewer?: { merchant?: { id?: string } | null } | null }; errors?: unknown[] };
        const merchantId = json.data?.viewer?.merchant?.id;
        return merchantId
          ? { ok: true, detail: `200 OK (merchant ${merchantId})` }
          : { ok: false, detail: 'Credentials not accepted (no authenticated merchant in response)' };
      } catch (e) {
        return { ok: false, detail: e instanceof Error ? e.message : 'Network error' };
      }
    };
    const prod = await probe('https://payments.braintree-api.com/graphql');
    if (prod.ok) return prod;
    const sandbox = await probe('https://payments.sandbox.braintree-api.com/graphql');
    return sandbox.ok ? { ok: true, detail: `${sandbox.detail} (sandbox)` } : prod;
  },
  notion: (c) => get('https://api.notion.com/v1/users/me', { Authorization: `Bearer ${c}`, 'Notion-Version': '2022-06-28' }),
  linear: async (c) => {
    try {
      const res = await fetch('https://api.linear.app/graphql', {
        method: 'POST',
        headers: { Authorization: c, 'content-type': 'application/json' },
        body: JSON.stringify({ query: '{ viewer { id } }' }),
      });
      const body = (await res.json().catch(() => null)) as { errors?: unknown } | null;
      const ok = res.ok && !body?.errors;
      return { ok, detail: ok ? `${res.status} OK` : `${res.status} ${res.statusText}` };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : 'Network error' };
    }
  },
  asana: (c) => bearerGet('https://app.asana.com/api/1.0/users/me', c),
  hubspot: (c) => bearerGet('https://api.hubapi.com/account-info/v3/details', c),
  intercom: (c) => bearerGet('https://api.intercom.io/me', c),
  trello: async (c) => {
    const parts = splitCredential(c);
    if (!parts) return { ok: false, detail: 'Expected "Key:Token".' };
    const [key, token] = parts;
    return get(`https://api.trello.com/1/members/me?key=${encodeURIComponent(key)}&token=${encodeURIComponent(token)}`, {});
  },
  slack: (c) => bearerGet('https://slack.com/api/auth.test', c),
  github: (c) => bearerGet('https://api.github.com/user', c),
  // Google family — the stored credential is the OAuth access token (or a
  // pasted one); each tester hits that service's cheapest authenticated
  // read so the token's scope is actually proven, not just its validity.
  'google-drive': (c) => bearerGet('https://www.googleapis.com/drive/v3/about?fields=user', c),
  gmail: (c) => bearerGet('https://gmail.googleapis.com/gmail/v1/users/me/profile', c),
  'google-calendar': (c) => bearerGet('https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1', c),
  'google-sheets': (c) => bearerGet('https://www.googleapis.com/drive/v3/files?q=mimeType%3D%27application%2Fvnd.google-apps.spreadsheet%27&pageSize=1&fields=files(id)', c),
};

export const connectionService = {
  catalog() {
    return nexusCatalog;
  },

  async list() {
    const rows = await db.connection.findMany();
    const byProvider = new Map(rows.map((r) => [r.provider, r]));
    // Catalog providers first, then any connected custom-* connectors —
    // they're not in the catalog but are first-class rows (findProvider
    // synthesizes their entry).
    const customEntries = rows
      .filter((r) => r.provider.startsWith('custom-') && !nexusCatalog.some((p) => p.id === r.provider))
      .map((r) => findProvider(r.provider))
      .filter((p): p is NonNullable<typeof p> => Boolean(p));
    return [...nexusCatalog, ...customEntries].map((p) => {
      const row = byProvider.get(p.id);
      return {
        ...p,
        connected: Boolean(row),
        maskedPreview: row?.maskedPreview ?? null,
        status: row?.status ?? null,
        connectedAt: row?.connectedAt ?? null,
        lastTestedAt: row?.lastTestedAt ?? null,
        lastTestOk: row?.lastTestOk ?? null,
        testable: Boolean(TESTERS[p.id]) || p.id.startsWith('custom-'),
        // Authorize-by-web is offered ALONGSIDE the key fields wherever the
        // provider really supports it, so the panel can show both routes to
        // the same vault entry rather than forcing a choice at catalog level.
        oauthCapable: OAUTH_CAPABLE.has(p.id),
      };
    });
  },

  async connect(providerId: string, credential: string, actorId: string) {
    const provider = findProvider(providerId);
    if (!provider) throw new NotFoundError('Unknown provider', 'providerId');
    if (!credential.trim()) throw new ConflictError('Credential is required.', 'credential');
    validateCredential(provider, credential);
    const encrypted = encryptSecret(credential);
    const masked = maskSecret(credential);
    await db.connection.upsert({
      where: { provider: providerId },
      update: { credentialEncrypted: encrypted, maskedPreview: masked, status: 'connected', connectedAt: new Date(), lastTestedAt: null, lastTestOk: null },
      create: { provider: providerId, category: provider.category, credentialEncrypted: encrypted, maskedPreview: masked },
    });
    await db.connectionAuditLog.create({ data: { provider: providerId, action: 'connect', actorId } });
    return { provider: providerId, maskedPreview: masked };
  },

  async disconnect(providerId: string, actorId: string) {
    const existing = await db.connection.findUnique({ where: { provider: providerId } });
    if (!existing) throw new NotFoundError('Not connected', 'providerId');
    await db.connection.delete({ where: { provider: providerId } });
    await db.connectionAuditLog.create({ data: { provider: providerId, action: 'disconnect', actorId } });
    return { provider: providerId };
  },

  async test(providerId: string, actorId: string): Promise<TestResult> {
    // Custom connectors can opt into testing by storing "key|https://url" —
    // the test is a bearer GET against the URL they named. No URL = no test.
    let tester = TESTERS[providerId];
    if (!tester && providerId.startsWith('custom-')) {
      tester = async (c: string) => {
        const pipeAt = c.indexOf('|https://');
        if (pipeAt === -1) return { ok: false, detail: 'No test URL stored — reconnect with "key|https://your-test-endpoint" to enable testing.' };
        const key = c.slice(0, pipeAt);
        const url = c.slice(pipeAt + 1);
        return bearerGet(url, key);
      };
    }
    if (!tester) throw new ConflictError('No live test wired for this provider yet.', 'providerId');
    const existing = await db.connection.findUnique({ where: { provider: providerId } });
    if (!existing) throw new NotFoundError('Not connected', 'providerId');
    const credential = decryptSecret(existing.credentialEncrypted);
    const result = await tester(credential);
    await db.connection.update({ where: { provider: providerId }, data: { lastTestedAt: new Date(), lastTestOk: result.ok, status: result.ok ? 'connected' : 'error' } });
    await db.connectionAuditLog.create({ data: { provider: providerId, action: 'test', actorId, detail: result.detail } });
    return result;
  },

  // Internal (NOT routed): the decrypted credential for a connected
  // provider, or null. Counter's gateway registry consumes this — a payment
  // gateway is "available, setup required" until its Nexus connection
  // exists (the vault is the only credential store; Counter keeps none).
  async credentialFor(providerId: string): Promise<string | null> {
    const row = await db.connection.findUnique({ where: { provider: providerId } });
    return row ? decryptSecret(row.credentialEncrypted) : null;
  },

  async auditLog(limit = 50) {
    return db.connectionAuditLog.findMany({ orderBy: { at: 'desc' }, take: limit });
  },

  async recordWebhook(provider: string, event: string | null, payloadSummary: string | null, verified: boolean | null): Promise<void> {
    await db.webhookLog.create({ data: { provider, event, payloadSummary, verified } });
  },

  async webhookLog(limit = 50) {
    return db.webhookLog.findMany({ orderBy: { receivedAt: 'desc' }, take: limit });
  },

  hasSignatureScheme(provider: string): boolean {
    return SIGNATURE_PROVIDERS.has(provider);
  },

  async setWebhookSecret(provider: string, secret: string): Promise<void> {
    await db.webhookSecret.upsert({
      where: { provider },
      update: { secretEncrypted: encryptSecret(secret) },
      create: { provider, secretEncrypted: encryptSecret(secret) },
    });
  },

  async hasWebhookSecret(provider: string): Promise<boolean> {
    return (await db.webhookSecret.count({ where: { provider } })) > 0;
  },

  // Internal (NOT routed): decrypted webhook signing secret for a provider,
  // or null. Counter's PSP webhook path verifies through the gateway's own
  // scheme with this secret.
  async webhookSecretFor(provider: string): Promise<string | null> {
    const row = await db.webhookSecret.findUnique({ where: { provider } });
    return row ? decryptSecret(row.secretEncrypted) : null;
  },

  // null = no signature scheme wired for this provider, or no secret
  // configured yet — genuinely unverifiable, not "failed". true/false is a
  // real cryptographic verdict once a secret is set.
  async verifyWebhook(provider: string, rawBody: string, header: (name: string) => string | undefined): Promise<boolean | null> {
    if (!SIGNATURE_PROVIDERS.has(provider)) return null;
    const row = await db.webhookSecret.findUnique({ where: { provider } });
    if (!row) return null;
    const secret = decryptSecret(row.secretEncrypted);
    if (provider === 'github') return verifyGithubSignature(rawBody, header('x-hub-signature-256'), secret);
    if (provider === 'stripe') return verifyStripeSignature(rawBody, header('stripe-signature'), secret);
    if (provider === 'slack') return verifySlackSignature(rawBody, header('x-slack-signature'), header('x-slack-request-timestamp'), secret);
    return null;
  },
};

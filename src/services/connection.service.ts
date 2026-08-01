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

/** The consumer key/secret pair a POD partner gives you, checked against the
 *  website it gave you with it. */
const wooStyle: Tester = async (c) => {
  const [site, key, secret] = c.split('|');
  if (!site) return { ok: false, detail: 'Expected the Website value from the provider.' };
  if (!key || !secret) return { ok: false, detail: 'Expected a Consumer key and a Consumer secret.' };
  const base = site.replace(/\/+$/, '').replace(/^(?!https?:\/\/)/, 'https://');
  return get(`${base}/wp-json/wc/v3/system_status`, { Authorization: basicAuthHeader(key, secret) });
};

const TESTERS: Record<string, Tester> = {
  // ── AI, apps and hosting, verified 2026-08-01 by live probe.
  deepseek: (c) => bearerGet('https://api.deepseek.com/models', firstField(c)),
  perplexity: (c) => post('https://api.perplexity.ai/chat/completions',
    { Authorization: `Bearer ${firstField(c)}`, 'Content-Type': 'application/json' },
    '{"model":"sonar","messages":[{"role":"user","content":"ping"}],"max_tokens":1}'),
  elevenlabs: (c) => get('https://api.elevenlabs.io/v1/user', { 'xi-api-key': firstField(c) }),
  airtable: (c) => bearerGet('https://api.airtable.com/v0/meta/whoami', firstField(c)),
  hostinger: (c) => bearerGet('https://developers.hostinger.com/api/vps/v1/virtual-machines', firstField(c)),
  // Ollama is the operator's OWN server, so the stored value is a base URL
  // rather than a key. /api/tags is the cheapest proof it is reachable and
  // actually Ollama.
  ollama: (c) => get(`${firstField(c).replace(/\/+$/, '')}/api/tags`, {}),
  zoom: async (c) => {
    const [accountId, clientId, secret] = c.split('|');
    if (!accountId || !clientId || !secret) return { ok: false, detail: 'Expected an Account ID, Client ID and Client Secret.' };
    return post(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`,
      { Authorization: basicAuthHeader(clientId, secret) });
  },
  // Jira and Zendesk are per-tenant like Shopify: the URL comes from the
  // operator's own site, and a fixed host 404s for everybody.
  jira: async (c) => {
    const [site, email, token] = c.split('|');
    if (!site || !email || !token) return { ok: false, detail: 'Expected a Site URL, an Email and an API Token.' };
    return get(`${site.replace(/\/+$/, '')}/rest/api/3/myself`, { Authorization: basicAuthHeader(email, token), Accept: 'application/json' });
  },
  zendesk: async (c) => {
    const [subdomain, email, token] = c.split('|');
    if (!subdomain || !email || !token) return { ok: false, detail: 'Expected a Subdomain, an Email and an API Token.' };
    // Zendesk wants the literal "/token" suffix on the username.
    return get(`https://${subdomain}.zendesk.com/api/v2/users/me.json`, { Authorization: basicAuthHeader(`${email}/token`, token) });
  },
  salesforce: async (c) => {
    const [instance, clientId, secret] = c.split('|');
    if (!instance || !clientId || !secret) return { ok: false, detail: 'Expected an Instance URL, Client ID and Client Secret.' };
    return post(`${instance.replace(/\/+$/, '')}/services/oauth2/token`, { 'Content-Type': 'application/x-www-form-urlencoded' },
      `grant_type=client_credentials&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(secret)}`);
  },

  // ── Ecommerce + identity, verified 2026-08-01 by live probe.
  // Shopify and BigCommerce are addressed BY THE MERCHANT'S OWN STORE, so the
  // tester has to build the URL from the stored domain/hash. A fixed host 404s
  // for everyone and looks like a dead endpoint.
  shopify: async (c) => {
    const [domain, token] = c.split('|');
    if (!domain || !token) return { ok: false, detail: 'Expected a store domain and an Admin API access token.' };
    const host = domain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    return get(`https://${host}/admin/api/2024-10/shop.json`, { 'X-Shopify-Access-Token': token });
  },
  bigcommerce: async (c) => {
    const [hash, token] = c.split('|');
    if (!hash || !token) return { ok: false, detail: 'Expected a store hash and an access token.' };
    return get(`https://api.bigcommerce.com/stores/${encodeURIComponent(hash)}/v2/store`, { 'X-Auth-Token': token, Accept: 'application/json' });
  },
  squarespace: (c) => get('https://api.squarespace.com/1.0/profiles', {
    Authorization: `Bearer ${firstField(c)}`,
    'User-Agent': 'Therum OS (therum.studio)',
  }),
  lemonsqueezy: (c) => get('https://api.lemonsqueezy.com/v1/users/me', {
    Authorization: `Bearer ${firstField(c)}`,
    Accept: 'application/vnd.api+json',
  }),
  wix: (c) => get('https://www.wixapis.com/site-properties/v4/properties', { Authorization: firstField(c) }),
  etsy: (c) => get('https://openapi.etsy.com/v3/application/openapi-ping', { 'x-api-key': firstField(c) }),
  magento: async (c) => {
    const [base, token] = c.split('|');
    if (!base || !token) return { ok: false, detail: 'Expected a store base URL and an integration access token.' };
    return get(`${base.replace(/\/+$/, '')}/rest/V1/store/storeConfigs`, { Authorization: `Bearer ${token}` });
  },
  // Exchanging the refresh token is the only check that proves all THREE
  // values agree — a valid client pair with the wrong refresh token still
  // fails, which is the case a field-by-field check would miss.
  amazon: async (c) => {
    const [clientId, secret, refresh] = c.split('|');
    if (!clientId || !secret || !refresh) return { ok: false, detail: 'Expected an LWA Client ID, Client Secret and Refresh Token.' };
    return post('https://api.amazon.com/auth/o2/token', { 'Content-Type': 'application/x-www-form-urlencoded' },
      `grant_type=refresh_token&refresh_token=${encodeURIComponent(refresh)}&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(secret)}`);
  },
  // A client_credentials grant returns an app token when the pair is real.
  'facebook-login': async (c) => {
    const [appId, secret] = c.split('|');
    if (!appId || !secret) return { ok: false, detail: 'Expected an App ID and an App Secret.' };
    return get(`https://graph.facebook.com/oauth/access_token?client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(secret)}&grant_type=client_credentials`, {});
  },

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
  // ── Messaging verified 2026-08-01 by live probe.
  // The -us21 suffix on a Mailchimp key IS the datacenter, and the request must
  // go to that host — sent to a fixed one, every valid key from another
  // datacenter reads as invalid. Any username works; the key is the password.
  mailchimp: async (c) => {
    const key = firstField(c);
    const dc = key.split('-')[1];
    if (!dc) return { ok: false, detail: 'Key is missing its -us21 style suffix, which selects the datacenter.' };
    return get(`https://${dc}.api.mailchimp.com/3.0/ping`, { Authorization: basicAuthHeader('therum', key) });
  },
  onesignal: async (c) => {
    const [, restKey] = c.split('|');
    if (!restKey) return { ok: false, detail: 'Expected an App ID and a REST API Key.' };
    return get('https://api.onesignal.com/apps', { Authorization: `Basic ${restKey}` });
  },
  vonage: async (c) => {
    // Vonage joins with ':' not '|' — see its catalog entry. Splitting on the
    // wrong separator makes a correct credential look incomplete, and the test
    // that caught this is the reason the file exists.
    const parts = splitCredential(c);
    if (!parts) return { ok: false, detail: 'Expected an API Key and an API Secret.' };
    const [key, secret] = parts;
    return get(`https://rest.nexmo.com/account/get-balance?api_key=${encodeURIComponent(key)}&api_secret=${encodeURIComponent(secret)}`, {});
  },
  whatsapp: async (c) => {
    const [, token] = c.split('|');
    if (!token) return { ok: false, detail: 'Expected a Phone Number ID and a Permanent Access Token.' };
    return get(`https://graph.facebook.com/v21.0/me?access_token=${encodeURIComponent(token)}`, {});
  },
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
  // Every print-on-demand partner here connects the same way: it hands you a
  // website, a consumer key and a consumer secret, and the pair authenticates
  // against that website's WooCommerce-compatible REST API. One check, because
  // it is one flow — nine slightly different ones is nine things to get wrong.
  printful: wooStyle,
  printify: wooStyle,
  gooten: wooStyle,
  podplus: wooStyle,
  podpartner: wooStyle,
  tapstitch: wooStyle,
  contrado: wooStyle,
  // Endpoints and header names probed live (both answer 401 to a bad key, so a
  // 200 means the credential is real) rather than taken from a summary.
  gelato: wooStyle,
  spod: wooStyle,

  // Payments
  stripe: (c) => bearerGet('https://api.stripe.com/v1/balance', c),
  square: (c) => bearerGet('https://connect.squareup.com/v2/locations', c),
  'coinbase-commerce': (c) => get('https://api.commerce.coinbase.com/charges', { 'X-CC-Api-Key': firstField(c) }),
  whop: (c) => bearerGet('https://api.whop.com/api/v2/me', c),
  // ── Payments verified 2026-08-01 by probing each API with a deliberately
  // bad key. A tester that was never run against the real endpoint is a green
  // tick that means nothing.
  mollie: (c) => bearerGet('https://api.mollie.com/v2/methods', firstField(c)),
  razorpay: async (c) => {
    const [id, secret] = c.split('|');
    if (!id || !secret) return { ok: false, detail: 'Expected a Key ID and a Key Secret.' };
    return get('https://api.razorpay.com/v1/payments', { Authorization: basicAuthHeader(id, secret) });
  },
  payu: async (c) => {
    const [clientId, secret] = c.split('|');
    if (!clientId || !secret) return { ok: false, detail: 'Expected a Client ID (POS ID) and a Client Secret.' };
    return post('https://secure.payu.com/pl/standard/user/oauth/authorize', { 'Content-Type': 'application/x-www-form-urlencoded' },
      `grant_type=client_credentials&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(secret)}`);
  },
  // Adyen and Klarna run SEPARATE live and test hosts, and a key is only valid
  // on one of them. Trying live first and falling back means a sandbox key
  // still reports connected instead of "invalid".
  adyen: async (c) => {
    const key = firstField(c);
    const live = await get('https://management-live.adyen.com/v3/me', { 'X-API-Key': key });
    return live.ok ? live : get('https://management-test.adyen.com/v3/me', { 'X-API-Key': key });
  },
  klarna: async (c) => {
    const [uid, pw] = c.split('|');
    if (!uid || !pw) return { ok: false, detail: 'Expected a Username (UID) and a Password (API key).' };
    const auth = { Authorization: basicAuthHeader(uid, pw), 'Content-Type': 'application/json' };
    const live = await post('https://api.klarna.com/payments/v1/sessions', auth, '{"purchase_country":"US","purchase_currency":"USD","order_amount":0,"order_lines":[]}');
    if (live.ok) return live;
    return post('https://api.playground.klarna.com/payments/v1/sessions', auth, '{"purchase_country":"US","purchase_currency":"USD","order_amount":0,"order_lines":[]}');
  },
  // Authorize.Net answers HTTP 200 EVEN WHEN AUTH FAILS — the real result is a
  // code in the body (E00007 = bad credentials). Trusting the status here
  // would mark every wrong key as connected.
  authorizenet: async (c) => {
    const [login, txKey] = c.split('|');
    if (!login || !txKey) return { ok: false, detail: 'Expected an API Login ID and a Transaction Key.' };
    try {
      const res = await fetch('https://api.authorize.net/xml/v1/request.api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ getMerchantDetailsRequest: { merchantAuthentication: { name: login, transactionKey: txKey } } }),
      });
      // Their response carries a UTF-8 BOM that breaks JSON.parse.
      const text = (await res.text()).replace(/^\uFEFF/, '').replace(/\u0000/g, '');
      const body = JSON.parse(text) as { messages?: { resultCode?: string; message?: { code?: string; text?: string }[] } };
      const ok = body.messages?.resultCode === 'Ok';
      const msg = body.messages?.message?.[0];
      return { ok, detail: ok ? '200 OK' : `${msg?.code ?? 'error'}: ${msg?.text ?? 'authentication failed'}` };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : 'Network error' };
    }
  },
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

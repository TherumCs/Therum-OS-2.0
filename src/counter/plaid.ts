import { db } from '../lib/db.js';
import { encryptSecret, decryptSecret } from '../lib/crypto.js';

// Plaid — shopper bank linking.
//
// The flow, and why it is shaped this way:
//
//   1. Server creates a short-lived link_token (needs the secret).
//   2. Browser runs Plaid Link with that token; the shopper picks their bank
//      and authenticates AT PLAID. Their credentials never touch this store.
//   3. Browser gets a public_token — useless on its own, single use.
//   4. Server exchanges it for an access_token and stores it ENCRYPTED.
//
// The access_token is the thing that can read someone's accounts. It is
// created server-side, stored encrypted, and never sent to a browser. The
// public_token exists precisely so the browser never has to hold the real one.

export type PlaidEnv = 'sandbox' | 'production';

const HOSTS: Record<PlaidEnv, string> = {
  sandbox: 'https://sandbox.plaid.com',
  production: 'https://production.plaid.com',
};

export interface PlaidApp {
  clientId: string;
  secret: string;
  env: PlaidEnv;
}

/**
 * The store's Plaid credentials, from Nexus. Null when not configured.
 *
 * Stored as "clientId|secret|env" — the catalogue's `join` convention, the
 * same one Sign in with Google uses.
 */
export async function plaidApp(): Promise<PlaidApp | null> {
  const row = await db.connection.findFirst({ where: { provider: 'plaid' } });
  if (!row?.credentialEncrypted) return null;
  try {
    const [clientId, secret, env] = decryptSecret(row.credentialEncrypted).split('|');
    if (!clientId?.trim() || !secret?.trim()) return null;
    // Default to sandbox, never production. Getting this backwards means
    // pointing real bank credentials at a test key, or worse, treating
    // production data as disposable.
    const environment: PlaidEnv = env?.trim() === 'production' ? 'production' : 'sandbox';
    return { clientId: clientId.trim(), secret: secret.trim(), env: environment };
  } catch {
    return null;
  }
}

async function plaidPost<T>(app: PlaidApp, path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${HOSTS[app.env]}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: app.clientId, secret: app.secret, ...body }),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    // Plaid's error_message is written for developers and can name the
    // institution or the item; surface only the coarse code upward.
    throw new Error(String(json.error_code ?? `plaid ${path} -> ${res.status}`));
  }
  return json as T;
}

/**
 * A link_token for one shopper.
 *
 * `client_user_id` is the store's own customer id, never an email — Plaid
 * stores it, and it should not be a piece of personal data.
 */
export async function createLinkToken(app: PlaidApp, customerId: string, webhookUrl?: string): Promise<string> {
  const out = await plaidPost<{ link_token: string }>(app, '/link/token/create', {
    user: { client_user_id: customerId },
    client_name: process.env.SITE_NAME || '',
    products: ['transactions'],
    country_codes: ['US'],
    language: 'en',
    ...(webhookUrl ? { webhook: webhookUrl } : {}),
  });
  return out.link_token;
}

export interface LinkedAccount {
  itemId: string;
  accessToken: string;
  institutionId?: string;
  institutionName?: string;
  accounts: { name?: string; mask?: string; type?: string }[];
}

/** Exchange the browser's single-use public_token for the real access token. */
export async function exchangePublicToken(app: PlaidApp, publicToken: string): Promise<LinkedAccount> {
  const ex = await plaidPost<{ access_token: string; item_id: string }>(
    app, '/item/public_token/exchange', { public_token: publicToken },
  );

  // Fetch the display-safe details in the same breath, so the shopper sees
  // which account they linked rather than an opaque id.
  let institutionId: string | undefined;
  let institutionName: string | undefined;
  let accounts: { name?: string; mask?: string; type?: string }[] = [];
  try {
    const got = await plaidPost<{
      accounts?: { name?: string; mask?: string; type?: string }[];
      item?: { institution_id?: string };
    }>(app, '/accounts/get', { access_token: ex.access_token });
    accounts = got.accounts ?? [];
    institutionId = got.item?.institution_id;
    if (institutionId) {
      const inst = await plaidPost<{ institution?: { name?: string } }>(
        app, '/institutions/get_by_id',
        { institution_id: institutionId, country_codes: ['US'] },
      );
      institutionName = inst.institution?.name;
    }
  } catch {
    // A missing display name is cosmetic; the link itself still worked, and
    // failing the whole exchange over a label would lose the access token.
  }

  return { itemId: ex.item_id, accessToken: ex.access_token, institutionId, institutionName, accounts };
}

/** Persist a link. Encrypted token, display-safe fields in the clear. */
export async function saveLink(customerId: string, linked: LinkedAccount): Promise<void> {
  const primary = linked.accounts[0];
  const data = {
    customerId,
    accessTokenEncrypted: encryptSecret(linked.accessToken),
    institutionName: linked.institutionName ?? null,
    institutionId: linked.institutionId ?? null,
    accountMask: primary?.mask ?? null,
    accountName: primary?.name ?? null,
    accountType: primary?.type ?? null,
    status: 'active',
  };
  await db.bankLink.upsert({
    where: { itemId: linked.itemId },
    update: data,
    create: { ...data, itemId: linked.itemId },
  });
}

/** What a shopper may see about their own links. Never the token. */
export async function linksFor(customerId: string) {
  const rows = await db.bankLink.findMany({
    where: { customerId },
    orderBy: { linkedAt: 'desc' },
    select: {
      id: true, institutionName: true, accountName: true,
      accountMask: true, accountType: true, status: true, linkedAt: true,
    },
  });
  return rows;
}

/**
 * Remove a link, at Plaid as well as here.
 *
 * /item/remove first: deleting our row while Plaid still holds a live item
 * means the shopper asked to disconnect and something upstream stayed
 * connected. If Plaid fails we still delete locally — the alternative is
 * refusing to honour a revocation.
 */
export async function unlink(customerId: string, id: string): Promise<boolean> {
  const row = await db.bankLink.findFirst({ where: { id, customerId } });
  if (!row) return false;
  const app = await plaidApp();
  if (app) {
    try {
      await plaidPost(app, '/item/remove', { access_token: decryptSecret(row.accessTokenEncrypted) });
    } catch { /* revoked locally regardless — see above */ }
  }
  await db.bankLink.delete({ where: { id: row.id } });
  return true;
}

import { db } from '../lib/db.js';
import { encryptSecret, decryptSecret } from '../lib/crypto.js';

// The credential Printful hands BACK to the store, once a connection is made.
//
// The direction is the confusing part, so it is worth stating plainly. There
// are two credentials in a Printful connection and they travel opposite ways:
//
//   1. Consumer key + secret — OURS. The merchant pastes them into Printful (or
//      approves the one-click handshake), and Printful uses them to log in to
//      this store and pull the catalogue. Those live in the Connection row.
//
//   2. An access token + store id — PRINTFUL'S. Once connected, Printful POSTs
//      them to the store, and everything the store wants to ask Printful
//      afterwards is authorised with them. That is what this file holds.
//
// This is also the answer to Printful's Basic-auth removal: their API now
// replies "Basic API token authentication is no longer supported… create a new
// OAuth 2.0 token" to a key/secret pair. The token below IS an OAuth 2.0 token,
// minted by Printful and delivered here — so the outbound direction works
// without the merchant generating anything by hand.
//
// Stored encrypted, in the settings row rather than a table of its own: it is a
// single credential for a single provider, and a migration on a live box to
// hold one string is not a trade worth making.

const KEY = 'printful_link';

export interface PrintfulLink {
  storeId: number;
  /** Never returned by the read path — see `printfulToken()`. */
  tokenEncrypted: string;
  linkedAt: string;
}

export const printfulLink = {
  /** Called by the Printful plugin route when Printful pushes its token. */
  async save(token: string, storeId: number): Promise<void> {
    const value: PrintfulLink = {
      storeId,
      tokenEncrypted: encryptSecret(token),
      linkedAt: new Date().toISOString(),
    };
    await db.setting.upsert({
      where: { key: KEY },
      update: { value: value as unknown as object },
      create: { key: KEY, value: value as unknown as object },
    });
  },

  /** The store id Printful is syncing with, or null if never linked. */
  async storeId(): Promise<number | null> {
    const row = await db.setting.findUnique({ where: { key: KEY } });
    const value = row?.value as PrintfulLink | null;
    return value?.storeId ?? null;
  },

  /**
   * The decrypted token, for outbound calls to Printful. Internal — never
   * routed, never logged, and deliberately not part of what `storeId()`
   * returns so that a debug endpoint cannot leak it by accident.
   */
  async token(): Promise<string | null> {
    const row = await db.setting.findUnique({ where: { key: KEY } });
    const value = row?.value as PrintfulLink | null;
    return value?.tokenEncrypted ? decryptSecret(value.tokenEncrypted) : null;
  },

  /** Undo the link. The merchant disconnecting Printful should clear it. */
  async clear(): Promise<void> {
    await db.setting.deleteMany({ where: { key: KEY } });
  },
};

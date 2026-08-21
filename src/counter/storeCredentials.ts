import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { db } from '../lib/db.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';

// Counter — credentials that let an OUTSIDE platform read this store.
//
// Every Nexus connection so far points outward: this site holds a key and
// calls someone else. Print-on-demand platforms work the other way round.
// Printful, Printify and Tapstitch all connect by asking for a WooCommerce
// consumer key and secret and then calling the store's own REST API on a
// schedule. Counter could consume a Woo store already (wooImporter.ts) but
// could not present itself as one, so there was nothing to hand them — the
// connection simply could not be completed from their side.
//
// Format is deliberately WooCommerce's: `ck_` + 40 hex, `cs_` + 40 hex. These
// platforms validate the shape client-side before they will even attempt a
// call, so a differently-shaped key gets rejected in their UI without ever
// reaching us.
//
// The secret is HASHED at rest. A store credential is a full API login to the
// catalogue and the order book; storing it recoverably would mean a database
// read hands over the shop. It is shown once, at creation, and never again.

const KEY_BYTES = 20; // 40 hex chars, matching WooCommerce
export type StoreScope = 'read' | 'read_write';

const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex');

export interface IssuedCredential {
  id: string;
  /** The WooCommerce-shaped numeric id handed back to a partner. */
  keyId: number;
  label: string;
  consumerKey: string;
  /** Returned ONCE. Never stored in a recoverable form. */
  consumerSecret: string;
  scope: StoreScope;
}

/**
 * Reads a Woo-style credential off a request.
 *
 * WooCommerce accepts two transports and the POD platforms use both: HTTP
 * Basic (key as username, secret as password) over HTTPS, and query-string
 * parameters as a fallback. Supporting only one means a partner that picked
 * the other gets a 401 that looks like a wrong key.
 */
export function readStoreCredential(req: FastifyRequest): { key: string; secret: string } | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Basic ')) {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    if (idx > 0) return { key: decoded.slice(0, idx), secret: decoded.slice(idx + 1) };
  }
  const q = req.query as Record<string, string | undefined>;
  if (q?.consumer_key && q?.consumer_secret) {
    return { key: q.consumer_key, secret: q.consumer_secret };
  }
  return null;
}

export const storeCredentials = {
  /** Issues a new pair. The secret is returned here and nowhere else, ever. */
  async issue(label: string, scope: StoreScope = 'read_write'): Promise<IssuedCredential> {
    const clean = label.trim();
    if (!clean) throw new ValidationError('Give this key a name so you can tell it apart later.', 'label');
    if (scope !== 'read' && scope !== 'read_write') {
      throw new ValidationError('Scope must be read or read_write.', 'scope');
    }

    const consumerKey = `ck_${randomBytes(KEY_BYTES).toString('hex')}`;
    const consumerSecret = `cs_${randomBytes(KEY_BYTES).toString('hex')}`;
    const row = await db.storeCredential.create({
      data: { label: clean, consumerKey, secretHash: sha256(consumerSecret), scope },
    });
    return { id: row.id, keyId: row.keyId, label: row.label, consumerKey, consumerSecret, scope };
  },

  /**
   * Verifies a presented pair.
   *
   * Compared in constant time: a byte-by-byte early exit leaks the secret one
   * character at a time to anyone willing to time the responses.
   */
  async verify(key: string, secret: string, ip?: string) {
    const row = await db.storeCredential.findUnique({ where: { consumerKey: key } });
    if (!row || row.revokedAt) return null;

    const given = Buffer.from(sha256(secret));
    const expected = Buffer.from(row.secretHash);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

    // Fire-and-forget: a failed bookkeeping write must not fail the API call
    // the partner is making.
    void db.storeCredential
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date(), lastUsedIp: ip ?? null } })
      .catch(() => {});
    return { id: row.id, label: row.label, scope: row.scope as StoreScope };
  },

  /** Never returns a secret — there is nothing recoverable to return. */
  async list() {
    const rows = await db.storeCredential.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      // Enough to recognise which key a partner is using, not enough to reuse.
      consumerKeyPreview: `${r.consumerKey.slice(0, 7)}…${r.consumerKey.slice(-4)}`,
      scope: r.scope as StoreScope,
      lastUsedAt: r.lastUsedAt,
      lastUsedIp: r.lastUsedIp,
      revokedAt: r.revokedAt,
      createdAt: r.createdAt,
    }));
  },

  /**
   * Revokes rather than deletes.
   *
   * The row is what tells you a partner was using this key and when it last
   * called; deleting it destroys the only evidence of what that key did.
   */
  async revoke(id: string) {
    const row = await db.storeCredential.findUnique({ where: { id } });
    if (!row) throw new NotFoundError('Store key not found', 'id');
    if (row.revokedAt) return { id, revoked: true as const };
    await db.storeCredential.update({ where: { id }, data: { revokedAt: new Date() } });
    return { id, revoked: true as const };
  },
};

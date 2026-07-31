import { db } from '../lib/db.js';
import { connectionService } from '../services/connection.service.js';
import { slugify } from '../lib/slug.js';
import { ValidationError } from '../lib/errors.js';

// Pull products FROM Printful into this catalog.
//
// Same model as WooCommerce: you can author products here, but most arrive
// from the POD provider. Printful's own connection is `store-pull-woo` — that
// is how Printful READS this store for fulfillment — which is the opposite
// direction and does not populate anything. This is the missing half.
//
// Idempotent by Printful's sync-product id, held in `Product.sourceId`. Re-run
// it as often as you like: existing products are updated, not duplicated.

const API = 'https://api.printful.com';

// Print-on-demand has no stock to run out of. Zero would make every synced
// product addable to a cart and then fail at checkout with "Insufficient
// stock", so POD lines land effectively unlimited.
const POD_INVENTORY = 999_999;

interface SyncProductSummary {
  id: number;
  name: string;
  thumbnail_url?: string;
  variants?: number;
}

interface SyncVariant {
  id: number;
  name?: string;
  sku?: string | null;
  retail_price?: string | null;
  size?: string | null;
  color?: string | null;
  product?: { image?: string | null; name?: string | null };
}

export interface PrintfulSyncResult {
  created: number;
  updated: number;
  variants: number;
  skipped: { name: string; reason: string }[];
}

/**
 * BEARER ONLY. Printful retired Basic API-key auth — its own API answers:
 * "Basic API token authentication is no longer supported... create a new
 * OAuth 2.0 token". Verified live against a stored legacy key, which 401s.
 *
 * The credential is stored joined with '|' (token | unused | store id), so a
 * legacy key+secret pair still parses; the first field is used as the token
 * and Printful rejects it with a message that says exactly what to do.
 */
function authHeaders(credential: string): Record<string, string> {
  const [token, , storeId] = credential.split('|');
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `Bearer ${token ?? credential}`,
  };
  // Accounts with more than one store 400 without this.
  if (storeId) headers['X-PF-Store-Id'] = storeId;
  return headers;
}

async function pf<T>(path: string, headers: Record<string, string>): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers, signal: AbortSignal.timeout(20_000) });
  const body = (await res.json().catch(() => ({}))) as { result?: T; error?: { message?: string } };
  if (!res.ok) throw new ValidationError(body.error?.message ?? `Printful returned ${res.status} for ${path}`);
  return body.result as T;
}

/** Money arrives as a decimal string; everything here is minor units. */
function toMinor(retail: string | null | undefined): number | null {
  if (!retail) return null;
  const n = Number(retail);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

export const printfulSyncService = {
  async available(): Promise<boolean> {
    return (await connectionService.credentialFor('printful')) !== null;
  },

  /**
   * Pull every sync product and upsert it.
   *
   * A product whose variants all lack a usable price is skipped with a reason
   * rather than created at zero — a catalog silently full of free items is
   * worse than a short report saying what did not come across.
   */
  async run(): Promise<PrintfulSyncResult> {
    const credential = await connectionService.credentialFor('printful');
    if (!credential) throw new ValidationError('Printful is not connected. Add it in Connections first.');
    const headers = authHeaders(credential);

    const summaries = await pf<SyncProductSummary[]>('/store/products', headers);
    const result: PrintfulSyncResult = { created: 0, updated: 0, variants: 0, skipped: [] };

    for (const summary of summaries ?? []) {
      const detail = await pf<{ sync_product?: SyncProductSummary; sync_variants?: SyncVariant[] }>(
        `/store/products/${summary.id}`,
        headers,
      ).catch(() => null);
      if (!detail) {
        result.skipped.push({ name: summary.name, reason: 'could not be read from Printful' });
        continue;
      }

      const product = detail.sync_product ?? summary;
      const sourceId = String(product.id);
      const variants = (detail.sync_variants ?? [])
        .map((v) => {
          const price = toMinor(v.retail_price);
          if (price === null) return null;
          return {
            price,
            sku: v.sku ?? null,
            sourceId: String(v.id),
            // Printful does not always split these out; the variant name is
            // the fallback rather than losing the distinction entirely.
            color: v.color ?? null,
            size: v.size ?? null,
            inventory: POD_INVENTORY,
          };
        })
        .filter((v): v is NonNullable<typeof v> => v !== null);

      if (variants.length === 0) {
        // Usually a product that has not had a retail price set in Printful.
        result.skipped.push({ name: product.name, reason: 'no variant has a retail price set in Printful' });
        continue;
      }

      const image = product.thumbnail_url ?? detail.sync_variants?.[0]?.product?.image ?? null;
      const existing = await db.product.findFirst({ where: { sourceId, vendorId: null }, select: { id: true } });

      if (existing) {
        // Name and image only. Description, categories, tags and status are
        // left alone on purpose: those are edited HERE, and a re-sync that
        // overwrote them would punish anyone who improved a product page.
        await db.product.update({
          where: { id: existing.id },
          data: { name: product.name, ...(image ? { image } : {}) },
        });
        for (const v of variants) {
          const existingVariant = await db.productVariant.findFirst({
            where: { productId: existing.id, sourceId: v.sourceId },
            select: { id: true },
          });
          if (existingVariant) {
            // Price and stock track Printful; everything else is ours.
            await db.productVariant.update({
              where: { id: existingVariant.id },
              data: { price: v.price, inventory: v.inventory },
            });
          } else {
            await db.productVariant.create({ data: { ...v, productId: existing.id } });
          }
          result.variants++;
        }
        result.updated++;
      } else {
        await db.product.create({
          data: {
            name: product.name,
            slug: `${slugify(product.name)}-${sourceId}`,
            status: 'active',
            sourceId,
            ...(image ? { image } : {}),
            variants: { create: variants },
          },
        });
        result.variants += variants.length;
        result.created++;
      }
    }

    return result;
  },
};

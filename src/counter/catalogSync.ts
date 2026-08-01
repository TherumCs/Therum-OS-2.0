import { db } from '../lib/db.js';
import { connectionService } from '../services/connection.service.js';
import { slugify } from '../lib/slug.js';
import { ValidationError } from '../lib/errors.js';

// Pull a catalog FROM any connected provider.
//
// Same model as WooCommerce: products can be authored here, but most arrive
// from a provider. A provider is a REGISTRY ENTRY — it turns its own API into
// the normalised shape below and nothing else. Everything after that (matching,
// upserting, what a re-sync is allowed to overwrite) is shared, so adding a
// provider is one adapter, not another sync.
//
// The first version of this was written against Printful alone, which was the
// wrong shape: the interesting logic is provider-agnostic and was trapped
// inside one integration.

/** What every provider must produce, whatever its own API looks like. */
export interface NormalizedVariant {
  /** The provider's own id for this variant — the idempotency key. */
  sourceId: string;
  sku: string | null;
  /** Minor units. Providers quote decimals, cents, or strings; adapters convert. */
  price: number;
  color: string | null;
  size: string | null;
  inventory: number;
}

export interface NormalizedProduct {
  sourceId: string;
  name: string;
  image: string | null;
  variants: NormalizedVariant[];
}

export interface CatalogProvider {
  id: string;
  label: string;
  /** Throw for auth/transport problems — the caller reports them verbatim. */
  fetch(credential: string): Promise<NormalizedProduct[]>;
}

export interface SyncResult {
  provider: string;
  created: number;
  updated: number;
  variants: number;
  skipped: { name: string; reason: string }[];
}

// Print-on-demand has no stock to run out of. Zero would make every synced
// product addable to a cart and then fail at checkout with "Insufficient
// stock", so POD lines land effectively unlimited.
const POD_INVENTORY = 999_999;

async function json<T>(url: string, headers: Record<string, string>, label: string): Promise<T> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  const body = (await res.json().catch(() => ({}))) as {
    result?: T;
    data?: T;
    error?: { message?: string } | string;
  };
  if (!res.ok) {
    const err = typeof body.error === 'string' ? body.error : body.error?.message;
    throw new ValidationError(err ?? `${label} returned ${res.status}`);
  }
  return (body.result ?? body.data ?? (body as unknown)) as T;
}

const money = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};

// ── Printful ──────────────────────────────────────────────────────────────
// BEARER ONLY. Printful retired Basic API-key auth; its API answers "Basic API
// token authentication is no longer supported... create a new OAuth 2.0 token".
// Verified live against a stored legacy key, which 401s.
const printful: CatalogProvider = {
  id: 'printful',
  label: 'Printful',
  async fetch(credential) {
    // The vault stores the fields joined with '|' IN CATALOG ORDER: token,
    // then Store ID. This read skipped index 1 and took index 2, so the Store
    // ID a merchant typed was silently ignored — and an account with more than
    // one store 400s without that header. It looked like a Printful problem.
    const [token, storeId] = credential.split('|');
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      authorization: `Bearer ${token ?? credential}`,
    };
    // Accounts with more than one store 400 without this.
    if (storeId) headers['X-PF-Store-Id'] = storeId;

    const summaries = await json<{ id: number; name: string; thumbnail_url?: string }[]>(
      'https://api.printful.com/store/products',
      headers,
      'Printful',
    );
    const out: NormalizedProduct[] = [];
    for (const s of summaries ?? []) {
      const detail = await json<{
        sync_product?: { id: number; name: string; thumbnail_url?: string };
        sync_variants?: { id: number; sku?: string | null; retail_price?: string | null; size?: string | null; color?: string | null; product?: { image?: string | null } }[];
      }>(`https://api.printful.com/store/products/${s.id}`, headers, 'Printful').catch(() => null);
      if (!detail) continue;
      const p = detail.sync_product ?? s;
      out.push({
        sourceId: String(p.id),
        name: p.name,
        image: p.thumbnail_url ?? detail.sync_variants?.[0]?.product?.image ?? null,
        variants: (detail.sync_variants ?? [])
          .map((v) => {
            const price = money(v.retail_price);
            return price === null
              ? null
              : { sourceId: String(v.id), sku: v.sku ?? null, price, color: v.color ?? null, size: v.size ?? null, inventory: POD_INVENTORY };
          })
          .filter((v): v is NormalizedVariant => v !== null),
      });
    }
    return out;
  },
};

// ── Printify ──────────────────────────────────────────────────────────────
// Prices are ALREADY in minor units here, unlike Printful's decimal strings —
// the exact kind of per-provider detail an adapter exists to absorb.
const printify: CatalogProvider = {
  id: 'printify',
  label: 'Printify',
  async fetch(credential) {
    const [token, shopId] = credential.split('|');
    if (!shopId) throw new ValidationError('Printify needs a Shop ID as well as the token.');
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const page = await json<{ id: number | string; title: string; images?: { src: string }[]; variants?: { id: number; sku?: string | null; price?: number; title?: string; is_enabled?: boolean }[] }[]>(
      `https://api.printify.com/v1/shops/${encodeURIComponent(shopId)}/products.json`,
      headers,
      'Printify',
    );
    return (page ?? []).map((p) => ({
      sourceId: String(p.id),
      name: p.title,
      image: p.images?.[0]?.src ?? null,
      variants: (p.variants ?? [])
        .filter((v) => v.is_enabled !== false)
        .map((v) => ({
          sourceId: String(v.id),
          sku: v.sku ?? null,
          price: typeof v.price === 'number' ? v.price : 0,
          // Printify puts the option combination in the variant title.
          color: null,
          size: v.title ?? null,
          inventory: POD_INVENTORY,
        }))
        .filter((v) => v.price > 0),
    }));
  },
};

/** Add a provider here and it appears in the admin automatically. */
export const CATALOG_PROVIDERS: CatalogProvider[] = [printful, printify];

export const catalogSyncService = {
  /** Every provider that can sync, and whether its credential exists. */
  async providers(): Promise<{ id: string; label: string; connected: boolean }[]> {
    return Promise.all(
      CATALOG_PROVIDERS.map(async (p) => ({
        id: p.id,
        label: p.label,
        connected: (await connectionService.credentialFor(p.id)) !== null,
      })),
    );
  },

  /**
   * Pull one provider's catalog and upsert it.
   *
   * Matching is on the provider's own ids, so re-running is safe — that is the
   * whole point of a sync. A re-sync updates name, image, price and stock ONLY:
   * description, categories, tags and status are edited here, and overwriting
   * them would punish anyone who improved a product page.
   */
  async run(providerId: string): Promise<SyncResult> {
    const provider = CATALOG_PROVIDERS.find((p) => p.id === providerId);
    if (!provider) {
      throw new ValidationError(`Unknown catalog provider "${providerId}". Available: ${CATALOG_PROVIDERS.map((p) => p.id).join(', ')}.`);
    }
    const credential = await connectionService.credentialFor(provider.id);
    if (!credential) throw new ValidationError(`${provider.label} is not connected. Add it in Connections first.`);

    const products = await provider.fetch(credential);
    const result: SyncResult = { provider: provider.id, created: 0, updated: 0, variants: 0, skipped: [] };

    for (const p of products) {
      if (p.variants.length === 0) {
        // Almost always a product with no retail price set at the provider.
        // Named with a reason rather than created at zero: a catalog quietly
        // full of free items is worse than a short list of what did not come.
        result.skipped.push({ name: p.name, reason: `no variant has a usable price in ${provider.label}` });
        continue;
      }

      const existing = await db.product.findFirst({ where: { sourceId: p.sourceId, vendorId: null }, select: { id: true } });
      if (existing) {
        await db.product.update({
          where: { id: existing.id },
          data: { name: p.name, ...(p.image ? { image: p.image } : {}) },
        });
        for (const v of p.variants) {
          const found = await db.productVariant.findFirst({
            where: { productId: existing.id, sourceId: v.sourceId },
            select: { id: true },
          });
          if (found) {
            await db.productVariant.update({ where: { id: found.id }, data: { price: v.price, inventory: v.inventory } });
          } else {
            await db.productVariant.create({ data: { ...v, productId: existing.id } });
          }
          result.variants++;
        }
        result.updated++;
      } else {
        await db.product.create({
          data: {
            name: p.name,
            slug: `${slugify(p.name)}-${p.sourceId}`,
            status: 'active',
            sourceId: p.sourceId,
            ...(p.image ? { image: p.image } : {}),
            variants: { create: p.variants },
          },
        });
        result.variants += p.variants.length;
        result.created++;
      }
    }
    return result;
  },
};

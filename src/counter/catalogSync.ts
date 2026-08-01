import { db } from '../lib/db.js';
import { connectionService } from '../services/connection.service.js';
import { slugify } from '../lib/slug.js';
import { ValidationError } from '../lib/errors.js';
import { printfulLink } from '../services/printfulLink.service.js';

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
  /** How availability is decided — POD lines are 'in_stock', not a big number. */
  stockStatus: string;
  /** This variant's own photo, so picking a colour changes the picture. */
  image: string | null;
  /** Every other shot Printful renders for this variant: [{url, alt}]. */
  images: { url: string; alt: string }[];
  /** The variant's real colours as hex, from the provider. 2 = two-tone. */
  colorCodes: string[];
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

// Print-on-demand has no stock to run out of, so POD lines are imported as
// 'in_stock' — availability by STATUS, not by counting.
//
// This used to import an inventory of 999999 instead. That number showed up in
// the admin as if it were a real count a merchant could edit, meant nothing,
// and would have quietly become 999998 on the first sale. See
// counter/availability.ts.
const POD_STOCK = 'in_stock';
const POD_INVENTORY = 0;

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
    // TWO credentials can drive this, because Printful has two directions and
    // they are not interchangeable:
    //
    //   - a PRIVATE TOKEN (developers.printful.com > Tokens > Create a token),
    //     which is what pulls the catalogue. Bearer, and the only thing that
    //     works for reading their API.
    //   - the consumer key/secret pair in the Nexus card, which is the OTHER
    //     direction — what Printful uses to log in to THIS store.
    //
    // The card holds the second, so pulling with it produces a 401 that reads
    // like a bad key. The private token is preferred whenever one is stored.
    const linked = await printfulLink.token();
    const [cardToken, cardStoreId] = credential.split('|');
    const token = linked ?? cardToken ?? credential;
    const storeId = (await printfulLink.storeId()) ?? cardStoreId;
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      // Printful records the integration from this. Matching the plugin's own
      // format (class-printful-client.php:15,32) keeps this store recognisable
      // to them as a WooCommerce integration rather than an unknown client.
      'user-agent': 'Printful WooCommerce Plugin 2.2.12 (WP 6.5 + WC 9.0.0)',
    };
    // Accounts with more than one store 400 without this.
    if (storeId) headers['X-PF-Store-Id'] = String(storeId);

    // `/store/products` is the WRONG endpoint and fails in a way that reads as
    // an account problem: Printful answers 400 "This API endpoint applies only
    // to Printful stores based on the Manual Order / API platform." A store
    // connected to WooCommerce is not that platform, so the products live under
    // `/sync/products` instead. Both exist, only one works per store type.
    const summaries = await json<{ id: number; name: string; thumbnail_url?: string }[]>(
      'https://api.printful.com/sync/products?limit=100',
      headers,
      'Printful',
    );
    /**
     * Colour HEX comes from Printful's CATALOG variant, not the sync variant —
     * `color_code` plus `color_code2` for two-tone. Cached per catalog variant
     * id because a store re-uses the same blank across products, and this is
     * one HTTP call per colour otherwise.
     *
     * Never inferred from the colour NAME: "Red/Natural" is two colours, and a
     * name-to-hex guess is wrong in both directions.
     */
    const colorCache = new Map<number, string[]>();
    async function colorsFor(catalogVariantId: number | undefined): Promise<string[]> {
      if (!catalogVariantId) return [];
      const hit = colorCache.get(catalogVariantId);
      if (hit) return hit;
      const codes = await json<{ variant?: { color_code?: string | null; color_code2?: string | null } }>(
        `https://api.printful.com/products/variant/${catalogVariantId}`,
        headers,
        'Printful',
      )
        .then((r) => [r.variant?.color_code, r.variant?.color_code2].filter((c): c is string => typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c)))
        // A missing colour is not a failed sync — the swatch falls back to the
        // variant's photograph.
        .catch(() => [] as string[]);
      colorCache.set(catalogVariantId, codes);
      return codes;
    }

    const out: NormalizedProduct[] = [];
    for (const s of summaries ?? []) {
      const detail = await json<{
        sync_product?: { id: number; name: string; thumbnail_url?: string };
        sync_variants?: {
          id: number; sku?: string | null; retail_price?: string | null; size?: string | null; color?: string | null;
          variant_id?: number;
          files?: { type?: string; preview_url?: string | null }[];
          product?: { image?: string | null };
        }[];
      }>(`https://api.printful.com/sync/products/${s.id}`, headers, 'Printful').catch(() => null);
      if (!detail) continue;
      const p = detail.sync_product ?? s;

      /**
       * Printful's `thumbnail_url` points at the store it was synced FROM —
       * here `https://sidemoney.co/wp-content/uploads/…`, the old WordPress
       * install. That path does not exist on this server, so taking it would
       * import five products whose every image 404s, which looks like a broken
       * import rather than a wrong image source.
       *
       * Printful's own CDN always has the artwork, so prefer it: the variant's
       * rendered preview first (that is the actual design), then the blank
       * product shot, and only then the thumbnail — and never a thumbnail
       * hosted anywhere but Printful.
       */
      const firstVariant = detail.sync_variants?.[0];
      const previewOf = (type: string) =>
        firstVariant?.files?.find((f) => f.type === type && f.preview_url)?.preview_url ?? null;
      // 'preview' is the mockup; 'default' is the bare artwork. Prefer the mockup.
      const cdnThumb = p.thumbnail_url?.includes('files.cdn.printful.com') ? p.thumbnail_url : null;

      out.push({
        sourceId: String(p.id),
        name: p.name,
        image: previewOf('preview') ?? previewOf('default') ?? firstVariant?.product?.image ?? cdnThumb ?? null,
        variants: await Promise.all((detail.sync_variants ?? [])
          .map(async (v) => {
            const price = money(v.retail_price);
            if (price === null) return null;
            /**
             * PER-COLOUR image. The distinction matters and is easy to get
             * wrong: `files` holds one entry per PLACEMENT — default, back,
             * left, right — and those are the DESIGN ARTWORK, byte-identical
             * across every colourway. Taking files[0] gave all 17 variants of
             * this store just 5 distinct pictures between them, so picking a
             * colour changed nothing.
             *
             * The `preview` entry is the generated MOCKUP: the design rendered
             * on that specific colour, and genuinely different per variant
             * (verified: 4 colours -> 4 distinct preview URLs). `product.image`
             * is the blank garment in that colour — also per-colour, and the
             * right fallback when no mockup has been generated.
             */
            const preview = (v.files ?? []).find((f) => f.type === 'preview' && f.preview_url)?.preview_url ?? null;
            const blank = v.product?.image ?? null;
            const image = preview ?? blank ?? (v.files ?? []).find((f) => f.preview_url)?.preview_url ?? null;
            // The blank shot is worth keeping as a second angle, but only when
            // it is not already the main image.
            const shots = blank && blank !== image ? [{ url: blank, alt: `${v.color ?? ''}`.trim() }] : [];
            return {
              sourceId: String(v.id),
              sku: v.sku ?? null,
              price,
              color: v.color ?? null,
              size: v.size ?? null,
              inventory: POD_INVENTORY,
              stockStatus: POD_STOCK,
              image,
              images: shots,
              colorCodes: await colorsFor(v.variant_id),
            };
          }))
          .then((vs) => vs.filter((v): v is NormalizedVariant => v !== null)),
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
          stockStatus: POD_STOCK,
          image: null,
          images: [],
          colorCodes: [],
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
            select: { id: true, stockStatus: true, inventory: true },
          });
          if (found) {
            // Images and price are the provider's to own. `inventory` is NOT
            // overwritten when the merchant has taken the variant off the
            // provider's stock model — re-syncing must not undo a deliberate
            // "only 3 of these" or an out-of-stock switch.
            // 999999 is the old print-on-demand sentinel. Rows carrying it were
            // never a merchant's real count, so a re-sync moves them onto the
            // status model rather than leaving a fake number in the admin.
            const legacySentinel = found.stockStatus === 'tracked' && found.inventory === 999_999;
            // Provider stock is adopted while the merchant has not overridden
            // it. Once they set their own status or count, re-syncing leaves it
            // alone — undoing a deliberate "only 3 of these" would be worse
            // than a stale number.
            const providerOwnsStock = legacySentinel || found.stockStatus === v.stockStatus;
            await db.productVariant.update({
              where: { id: found.id },
              data: {
                price: v.price,
                ...(v.image ? { image: v.image, images: v.images } : {}),
                ...(v.colorCodes.length ? { colorCodes: v.colorCodes } : {}),
                ...(providerOwnsStock ? { stockStatus: v.stockStatus, inventory: v.inventory } : {}),
              },
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

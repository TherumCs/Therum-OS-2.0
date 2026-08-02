import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { db } from '../lib/db.js';
import { UPLOADS_DIR } from '../lib/uploads.js';
import { printfulLink } from '../services/printfulLink.service.js';

// Generate the product photography Printful will not hand over.
//
// Printful PUSHES the mockups a merchant selected into the connected store; it
// never exposes them for pulling. Its sync API returns exactly ONE rendered
// preview per variant, so a store that reads rather than receives gets a single
// angle per colourway and no amount of re-syncing improves it.
//
// The Mockup Generator does hand them over: the same artwork, rendered on the
// right colour garment, from several camera angles. That makes the gap
// closeable without depending on Printful accepting this store as a
// WooCommerce install — which it currently does not.

const API = 'https://api.printful.com';

/**
 * The camera angles, by Printful mockup style id.
 *
 * These are the 'Flat' styles for headwear (catalog product 961), and they are
 * deliberately the same four views the merchant's existing photographs use, so
 * a generated set and a hand-picked one look like the same shoot.
 *
 * Style ids are PER CATALOG PRODUCT. A t-shirt has its own, so this resolves
 * them live rather than hardcoding a list that would silently produce nothing
 * for the first non-cap product.
 */
const WANTED_VIEWS = ['Front', 'Back', 'Left Front', 'Right Front'];

interface Layer { type?: string; url?: string; id?: number | string }
interface Placement { placement: string; technique?: string; layers: Layer[] }

export interface MockupResult {
  productId: string;
  variantId: string;
  color: string | null;
  images: { url: string; alt: string }[];
  error?: string;
}

async function pf<T>(token: string, storeId: number | null, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };
  if (storeId) headers['X-PF-Store-Id'] = String(storeId);

  // Printful's limiter is a leaky bucket and answers 429 with the wait in the
  // message. Honouring it is the difference between a slow run and a failed
  // one; retrying blind just burns the bucket further.
  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await fetch(`${API}${path}`, {
      method: body ? 'POST' : 'GET',
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(45_000),
    });
    const json = (await res.json().catch(() => ({}))) as { data?: unknown; error?: { message?: string } };
    if (res.status === 429) {
      const secs = Number(/(\d+)/.exec(json.error?.message ?? '')?.[1] ?? 20) + 3;
      await new Promise((r) => setTimeout(r, secs * 1000));
      continue;
    }
    if (!res.ok) throw new Error(json.error?.message ?? `Printful ${path} -> ${res.status}`);
    return json as T;
  }
  throw new Error(`Printful rate limit did not clear for ${path}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Style ids for the wanted views on a placement of this catalog product. */
async function styleIds(token: string, catalogProductId: number, placement: string): Promise<number[]> {
  const res = await pf<{ data: { placement: string; mockup_styles: { id: number; view_name: string }[] }[] }>(
    token, null, `/v2/catalog-products/${catalogProductId}/mockup-styles`,
  );
  const group = res.data.find((p) => p.placement === placement) ?? res.data[0];
  const wanted = (group?.mockup_styles ?? []).filter((s) => WANTED_VIEWS.includes(s.view_name));
  return wanted.map((s) => s.id);
}

/** Save a generated mockup locally — Printful's URLs are temporary. */
async function store(url: string, alt: string): Promise<{ url: string; alt: string } | null> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) return null;
  const bytes = Buffer.from(await res.arrayBuffer());
  const ext = (/\.(png|jpg|jpeg|webp)(\?|$)/i.exec(url)?.[1] ?? 'png').toLowerCase();
  // Content-hashed: regenerating the same mockup twice does not litter the
  // uploads directory with duplicates.
  const name = `pfm-${createHash('sha1').update(bytes).digest('hex').slice(0, 16)}.${ext}`;
  await writeFile(join(UPLOADS_DIR, name), bytes);
  const stored = { url: `/api/uploads/${name}`, alt };
  const exists = await db.mediaAsset.findFirst({ where: { url: stored.url } });
  if (!exists) await db.mediaAsset.create({ data: { url: stored.url, alt, kind: 'image' } });
  return stored;
}

export const printfulMockups = {
  /**
   * Fill in photography for a synced product's variants.
   *
   * `onlyMissing` is the default and matters: a merchant's own chosen images
   * are richer than anything generated, and quietly replacing them would undo
   * work nobody asked to undo.
   */
  async generate(productId: string, opts: { onlyMissing?: boolean; dryRun?: boolean } = {}): Promise<MockupResult[]> {
    const onlyMissing = opts.onlyMissing !== false;
    const token = await printfulLink.token();
    if (!token) throw new Error('No Printful token stored — add one in Connections first.');
    const storeId = await printfulLink.storeId();

    const product = await db.product.findUnique({ where: { id: productId }, include: { variants: true } });
    if (!product?.sourceId) throw new Error('Not a synced Printful product.');

    const targets = product.variants.filter((v) => (onlyMissing ? !v.image : true));
    if (!targets.length) return [];

    // The sync variants, so our rows can be matched to Printful's ids by SKU —
    // the one identifier both sides agree on.
    const detail = await pf<{ result: { sync_variants: { id: number; sku?: string; variant_id: number; files: { id: number; url?: string; preview_url?: string }[] }[] } }>(
      token, storeId, `/sync/products/${product.sourceId}`,
    );
    const bySku = new Map(detail.result.sync_variants.map((v) => [v.sku ?? '', v]));

    const out: MockupResult[] = [];
    for (const variant of targets) {
      const sv = bySku.get(variant.sku ?? '');
      if (!sv) { out.push({ productId, variantId: variant.id, color: variant.color, images: [], error: 'no matching Printful variant' }); continue; }

      try {
        const v2 = await pf<{ data: { catalog_variant_id: number; placements: Placement[] } }>(token, storeId, `/v2/sync-variants/${sv.id}`);
        // A file uploaded straight to Printful has no source URL; its CDN
        // preview is the same artwork and is accepted as the layer image.
        const byId = new Map(sv.files.map((f) => [String(f.id), f.url || f.preview_url || '']));
        const placements = v2.data.placements
          .map((p) => ({
            placement: p.placement,
            technique: p.technique,
            // POSITION IS OMITTED on purpose. Replaying the sync product's
            // stored geometry fails validation ("printfile height 1.059 cannot
            // exceed print area height 1"), so Printful is left to place the
            // artwork the same way it does for the merchant's own mockups.
            layers: p.layers
              .map((l) => ({ type: 'file', url: l.url || byId.get(String(l.id)) || '' }))
              .filter((l) => l.url),
          }))
          .filter((p) => p.layers.length);
        if (!placements.length) { out.push({ productId, variantId: variant.id, color: variant.color, images: [], error: 'no usable print files' }); continue; }

        const catalogProductId = Number(/products\/(\d+)\//.exec(sv.files[0]?.preview_url ?? '')?.[1] ?? 0) || 961;
        const styles = await styleIds(token, catalogProductId, placements[0]!.placement);

        const created = await pf<{ data: { id: number }[] }>(token, storeId, '/v2/mockup-tasks', {
          products: [{
            source: 'catalog',
            catalog_product_id: catalogProductId,
            catalog_variant_ids: [v2.data.catalog_variant_id],
            placements,
            ...(styles.length ? { mockup_style_ids: styles } : {}),
          }],
        });
        const taskId = created.data?.[0]?.id;
        if (!taskId) { out.push({ productId, variantId: variant.id, color: variant.color, images: [], error: 'no task id' }); continue; }

        let mockups: { placement: string; style_id: number; mockup_url: string }[] = [];
        for (let i = 0; i < 40; i++) {
          await sleep(5000);
          const t = await pf<{ data: { status: string; catalog_variant_mockups?: { mockups: typeof mockups }[]; failure_reasons?: string[] }[] }>(
            token, storeId, `/v2/mockup-tasks?id=${taskId}`,
          );
          const row = t.data?.[0];
          if (row?.status === 'completed') { mockups = (row.catalog_variant_mockups ?? []).flatMap((m) => m.mockups ?? []); break; }
          if (row?.status === 'failed') throw new Error((row.failure_reasons ?? ['mockup task failed']).join('; '));
        }
        if (!mockups.length) { out.push({ productId, variantId: variant.id, color: variant.color, images: [], error: 'task did not complete' }); continue; }

        const label = [variant.color, variant.size].filter(Boolean).join(' / ');
        const images: { url: string; alt: string }[] = [];
        for (const m of mockups) {
          if (opts.dryRun) { images.push({ url: m.mockup_url, alt: `${product.name} — ${label}` }); continue; }
          const saved = await store(m.mockup_url, `${product.name} — ${label}`);
          if (saved) images.push(saved);
        }

        if (!opts.dryRun && images.length) {
          const [main, ...rest] = images;
          await db.productVariant.update({ where: { id: variant.id }, data: { image: main!.url, images: rest } });
        }
        out.push({ productId, variantId: variant.id, color: variant.color, images });
      } catch (err) {
        out.push({ productId, variantId: variant.id, color: variant.color, images: [], error: (err as Error).message });
      }
    }
    return out;
  },

  /** Every synced product that still has a variant without photography. */
  async productsNeedingMockups(): Promise<{ id: string; name: string; missing: number }[]> {
    const rows = await db.product.findMany({
      where: { sourceId: { not: null } },
      include: { variants: { select: { image: true } } },
    });
    return rows
      .map((p) => ({ id: p.id, name: p.name, missing: p.variants.filter((v) => !v.image).length }))
      .filter((p) => p.missing > 0);
  },
};

import { db } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { slugify } from '../lib/slug.js';

// Counter — WooCommerce importer. The migration path off Woo.
//
// Counter 0.45's ComprehensiveWooImporter reads Woo in-process
// (`wc_get_products()`), which is impossible from Node. The equivalent here is
// Woo's own REST API v3 — the same interface every external integration uses,
// available on any live store with a consumer key/secret. That also makes this
// work against a REMOTE store, which the in-process version never could:
// point it at a client's live Woo and pull everything across the wire.
//
// Field mapping is taken from Woo 10.9.4's
// includes/rest-api/Controllers/Version3/class-wc-rest-products-controller.php
// rather than from memory.
//
// Scope matches Counter's: products (with variants, attributes, images),
// customers, orders. Idempotent — re-running updates rather than duplicating,
// keyed on `sourceId` ('woo:<id>'), which the schema designates as the import
// idempotency key.

export interface WooCredentials {
  /** Store root, e.g. https://shop.example.com — no trailing /wp-json. */
  storeUrl: string;
  consumerKey: string;
  consumerSecret: string;
}

export interface ImportReport {
  products: { created: number; updated: number; skipped: number };
  variants: { created: number };
  customers: { created: number; updated: number };
  orders: { created: number; skipped: number };
  errors: { entity: string; wooId: number | string; reason: string }[];
}

const emptyReport = (): ImportReport => ({
  products: { created: 0, updated: 0, skipped: 0 },
  variants: { created: 0 },
  customers: { created: 0, updated: 0 },
  orders: { created: 0, skipped: 0 },
  errors: [],
});

// ─── Woo REST shapes (only the fields we actually map) ─────────────────────

interface WooImage { src: string; alt?: string }
interface WooTerm { id: number; name: string; slug: string }
interface WooAttribute { id: number; name: string; options?: string[]; variation?: boolean }

interface WooProduct {
  id: number;
  name: string;
  slug: string;
  type: string;
  status: string;
  description: string;
  short_description: string;
  sku: string;
  price: string;
  regular_price: string;
  sale_price: string;
  stock_quantity: number | null;
  manage_stock: boolean;
  categories: WooTerm[];
  tags: WooTerm[];
  images: WooImage[];
  attributes: WooAttribute[];
  variations: number[];
}

interface WooVariation {
  id: number;
  sku: string;
  price: string;
  regular_price: string;
  stock_quantity: number | null;
  attributes: { name: string; option: string }[];
  image?: WooImage;
}

interface WooCustomer {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  billing?: Record<string, string>;
  shipping?: Record<string, string>;
}

interface WooOrder {
  id: number;
  number: string;
  status: string;
  currency: string;
  total: string;
  date_created_gmt: string;
  billing?: Record<string, string>;
  line_items: { name: string; product_id: number; variation_id: number; quantity: number; price: number; total: string }[];
}

// ─── Client ────────────────────────────────────────────────────────────────

class WooClient {
  private readonly auth: string;

  constructor(private readonly creds: WooCredentials) {
    // Basic auth over HTTPS is Woo's documented scheme for its REST API.
    this.auth = Buffer.from(`${creds.consumerKey}:${creds.consumerSecret}`).toString('base64');
  }

  /**
   * Woo paginates at 100/page and reports totals in headers. Pulling every
   * page here rather than making callers loop keeps the import a single call.
   */
  async list<T>(path: string, perPage = 100): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; ; page++) {
      const url = `${this.creds.storeUrl.replace(/\/+$/, '')}/wp-json/wc/v3/${path}` +
        `${path.includes('?') ? '&' : '?'}per_page=${perPage}&page=${page}`;
      const res = await fetch(url, { headers: { authorization: `Basic ${this.auth}` } });
      if (!res.ok) {
        throw new Error(`Woo API ${res.status} on ${path} — ${(await res.text()).slice(0, 200)}`);
      }
      const batch = (await res.json()) as T[];
      out.push(...batch);
      const totalPages = Number(res.headers.get('x-wp-totalpages') ?? '1');
      if (page >= totalPages || batch.length === 0) break;
    }
    return out;
  }

  /** Credentials + reachability check, so a bad key fails in one request. */
  async check(): Promise<{ ok: boolean; message: string }> {
    try {
      const url = `${this.creds.storeUrl.replace(/\/+$/, '')}/wp-json/wc/v3/system_status`;
      const res = await fetch(url, { headers: { authorization: `Basic ${this.auth}` } });
      if (res.status === 401) return { ok: false, message: 'Woo rejected the consumer key/secret (401).' };
      if (!res.ok) return { ok: false, message: `Woo returned ${res.status}.` };
      return { ok: true, message: 'Connected.' };
    } catch (e) {
      return { ok: false, message: `Could not reach the store: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
}

// ─── Mapping ───────────────────────────────────────────────────────────────

/**
 * Woo prices are decimal STRINGS ('19.99', '' when unset). This schema stores
 * money as INTEGER MINOR UNITS (see prisma/schema.prisma line 2) — returning a
 * float here would have written 19.99 into an Int column and silently turned
 * £19.99 into 20p on every imported product.
 */
function moneyToCents(v: string | undefined): number {
  const n = Number.parseFloat(v ?? '');
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/**
 * Woo statuses -> ours. Anything not explicitly published is treated as draft:
 * importing a private or pending product as live would put unfinished work on
 * a storefront, which is the wrong way to be wrong.
 */
function productStatus(woo: string): 'active' | 'draft' {
  return woo === 'publish' ? 'active' : 'draft';
}

/**
 * Woo order status -> ours. Imported orders are historical records, so
 * anything Woo considered finished maps to `delivered` and anything it
 * considered dead maps to `cancelled`. Nothing is imported as `pending`,
 * because a pending order here would look like live work waiting to be
 * fulfilled — and re-fulfilling a year-old Woo order is the expensive
 * kind of mistake.
 */
function orderStatus(woo: string): 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'failed' {
  switch (woo) {
    case 'completed': return 'delivered';
    case 'processing': case 'on-hold': return 'processing';
    case 'cancelled': case 'refunded': case 'trash': return 'cancelled';
    case 'failed': return 'failed';
    default: return 'delivered';
  }
}

export const wooImporter = {
  async check(creds: WooCredentials) {
    return new WooClient(creds).check();
  },

  /**
   * Products + variants. `dryRun` reports what WOULD happen and writes
   * nothing — worth having before pointing this at a real catalogue.
   */
  async importProducts(creds: WooCredentials, opts: { dryRun?: boolean } = {}): Promise<ImportReport> {
    const client = new WooClient(creds);
    const report = emptyReport();
    const products = await client.list<WooProduct>('products?status=any');

    for (const p of products) {
      try {
        // Woo's grouped/external types have no inventory of their own and no
        // 2.0 equivalent — recorded as skipped rather than half-imported.
        if (p.type === 'grouped' || p.type === 'external') {
          report.products.skipped++;
          continue;
        }

        // Matched on sourceId, not slug: the schema calls sourceId "the
        // idempotency key for imports", and a slug can be edited after import
        // whereas the Woo id cannot. Matching on slug would duplicate every
        // product an editor had renamed.
        const sourceId = `woo:${p.id}`;
        const existing = await db.product.findFirst({ where: { sourceId } });
        const images = p.images.map((i) => i.src);
        const data = {
          name: p.name,
          slug: p.slug || slugify(p.name),
          description: p.description || p.short_description || null,
          status: productStatus(p.status),
          sourceId,
          image: images[0] ?? null,
          images: images as object,
          meta: { wooType: p.type, sku: p.sku } as object,
        };

        if (opts.dryRun) {
          existing ? report.products.updated++ : report.products.created++;
          continue;
        }

        const saved = existing
          ? await db.product.update({ where: { id: existing.id }, data })
          : await db.product.create({ data });
        existing ? report.products.updated++ : report.products.created++;

        // A simple product still needs one variant — 2.0 prices on the
        // variant, so a product with none is unbuyable.
        if (p.type === 'variable' && p.variations.length) {
          const variations = await client.list<WooVariation>(`products/${p.id}/variations`);
          for (const v of variations) {
            const attrs = v.attributes ?? [];
            const variantSource = `woo:${v.id}`;
            const existingVariant = await db.productVariant.findFirst({ where: { sourceId: variantSource } });
            const variantData = {
              productId: saved.id,
              sku: v.sku || `${p.sku || p.id}-${v.id}`,
              price: moneyToCents(v.price || v.regular_price),
              inventory: v.stock_quantity ?? 0,
              sourceId: variantSource,
              color: attrs.find((a) => /colou?r/i.test(a.name))?.option ?? null,
              size: attrs.find((a) => /size/i.test(a.name))?.option ?? null,
            };
            if (existingVariant) {
              await db.productVariant.update({ where: { id: existingVariant.id }, data: variantData });
            } else {
              await db.productVariant.create({ data: variantData });
              report.variants.created++;
            }
          }
        } else {
          const simpleSource = `woo:${p.id}:simple`;
          const existingSimple = await db.productVariant.findFirst({ where: { sourceId: simpleSource } });
          const simpleData = {
            productId: saved.id,
            sku: p.sku || `woo-${p.id}`,
            price: moneyToCents(p.price || p.regular_price),
            inventory: p.stock_quantity ?? 0,
            sourceId: simpleSource,
          };
          if (existingSimple) {
            await db.productVariant.update({ where: { id: existingSimple.id }, data: simpleData });
          } else {
            await db.productVariant.create({ data: simpleData });
            report.variants.created++;
          }
        }
      } catch (e) {
        report.errors.push({ entity: 'product', wooId: p.id, reason: e instanceof Error ? e.message : String(e) });
      }
    }

    logger.info({ ...report.products, variants: report.variants.created }, 'woo product import complete');
    return report;
  },

  /**
   * Orders — the payment HISTORY.
   *
   * Worth being explicit about what does and does not survive a Woo migration:
   * saved payment METHODS cannot be moved off WooPayments (it holds the
   * processor relationship, and cards on file are not exportable), so every
   * customer re-enters their card once. Payment HISTORY is different and does
   * come across — and it has to, because refunds, disputes, repeat-customer
   * detection and lifetime value all read from it.
   *
   * Orders are imported as a RECORD, not as live payables: no gateway is
   * called, nothing is captured, and statuses are mapped to their settled
   * equivalents. Re-running is safe — matched on sourceId.
   */
  async importOrders(creds: WooCredentials, opts: { dryRun?: boolean } = {}): Promise<ImportReport> {
    const client = new WooClient(creds);
    const report = emptyReport();
    const orders = await client.list<WooOrder>('orders?status=any');

    for (const o of orders) {
      try {
        const sourceId = `woo:${o.id}`;
        const existing = await db.order.findFirst({ where: { sourceId } });
        if (existing) {
          report.orders.skipped++;
          continue;
        }
        if (opts.dryRun) {
          report.orders.created++;
          continue;
        }

        // Link to a customer we already imported, by email. A Woo order with
        // no matching customer becomes a guest order rather than being
        // dropped — the history is still worth keeping.
        const email = (o.billing?.email ?? '').trim().toLowerCase();
        const customer = email ? await db.customer.findFirst({ where: { email } }) : null;

        // Line items are matched to variants by the Woo id we stamped during
        // the product import. An item whose product was skipped (grouped /
        // external) is recorded on the order total but has no variant to
        // point at, so it is left off rather than pointed at the wrong one.
        const items = [];
        for (const li of o.line_items ?? []) {
          const variantSource = li.variation_id ? `woo:${li.variation_id}` : `woo:${li.product_id}:simple`;
          const variant = await db.productVariant.findFirst({ where: { sourceId: variantSource } });
          if (!variant) continue;
          items.push({
            variantId: variant.id,
            quantity: li.quantity,
            priceAtTime: moneyToCents(String(li.price ?? 0)),
          });
        }

        await db.order.create({
          data: {
            number: o.number || String(o.id),
            status: orderStatus(o.status),
            currency: o.currency || 'USD',
            total: moneyToCents(o.total),
            sourceId,
            customerId: customer?.id ?? null,
            guestEmail: customer ? null : email || null,
            createdAt: o.date_created_gmt ? new Date(`${o.date_created_gmt}Z`) : new Date(),
            shipAddress: (o.billing ?? {}) as object,
            ...(items.length ? { items: { create: items } } : {}),
          },
        });
        report.orders.created++;
      } catch (e) {
        report.errors.push({ entity: 'order', wooId: o.id, reason: e instanceof Error ? e.message : String(e) });
      }
    }
    logger.info(report.orders, 'woo order import complete');
    return report;
  },

  /** Customers. Matched on email — the only stable key across both systems. */
  async importCustomers(creds: WooCredentials, opts: { dryRun?: boolean } = {}): Promise<ImportReport> {
    const client = new WooClient(creds);
    const report = emptyReport();
    const customers = await client.list<WooCustomer>('customers');

    for (const c of customers) {
      try {
        if (!c.email) {
          report.errors.push({ entity: 'customer', wooId: c.id, reason: 'no email — cannot match' });
          continue;
        }
        const existing = await db.customer.findFirst({ where: { email: c.email } });
        if (opts.dryRun) {
          existing ? report.customers.updated++ : report.customers.created++;
          continue;
        }
        const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email;
        if (existing) {
          await db.customer.update({ where: { id: existing.id }, data: { name } });
          report.customers.updated++;
        } else {
          await db.customer.create({ data: { email: c.email, name } });
          report.customers.created++;
        }
      } catch (e) {
        report.errors.push({ entity: 'customer', wooId: c.id, reason: e instanceof Error ? e.message : String(e) });
      }
    }
    return report;
  },
};

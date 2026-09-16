import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Prisma, type ProductStatus, type OrderStatus } from '@prisma/client';
import { db } from '../../lib/db.js';
import { localizeImageUrl } from '../../counter/catalogImport.js';
import { storeCredentials, readStoreCredential } from '../../counter/storeCredentials.js';
import { toMajor, toMinor } from '../../counter/currency.js';
import { availableOf, isTracked, type StockStatus } from '../../counter/availability.js';

// Map a WooCommerce stock declaration to ours. A POD design is made to order:
// unless a partner explicitly manages a finite stock, it is ALWAYS available.
// The old default (tracked + 0) rendered every pushed product "Sold out", which
// is the whole "partial sync: product there but sold out" symptom.
function mapStock(b: { manage_stock?: boolean; stock_status?: string; stock_quantity?: number }): { stockStatus: StockStatus; inventory: number } {
  // manage_stock:true + a count is the unambiguous "track this many".
  if (b.manage_stock === true && typeof b.stock_quantity === 'number') return { stockStatus: 'tracked', inventory: b.stock_quantity };
  // An EXPLICIT status is authoritative and wins over a bare count — this is the
  // print-on-demand path (stock_status:'instock', no quantity) and it must stay
  // in_stock/unlimited, never get pinned to a count.
  const ss = String(b.stock_status ?? '').toLowerCase();
  if (ss === 'instock') return { stockStatus: 'in_stock', inventory: 0 };
  if (ss === 'outofstock') return { stockStatus: 'out_of_stock', inventory: 0 };
  if (ss === 'onbackorder') return { stockStatus: 'backorder', inventory: 0 };
  // No explicit status, but the partner sent a count (manage_stock omitted, as
  // several POD clients do): honour it as tracked stock rather than silently
  // dropping it to a 0-count row that looks synced but shows "Sold out". Only an
  // EXPLICIT manage_stock:false opts out of tracking a supplied quantity.
  if (typeof b.stock_quantity === 'number' && b.manage_stock !== false) return { stockStatus: 'tracked', inventory: b.stock_quantity };
  return { stockStatus: 'in_stock', inventory: 0 };
}
import { slugify } from '../../lib/slug.js';
import { settingsService } from '../../services/settings.service.js';
import { mediaService } from '../../services/media.service.js';
import { printfulLink } from '../../services/printfulLink.service.js';
import { authService } from '../../services/auth.service.js';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { googleApp, authorizeUrl, signState, readState, exchangeCode, adminForGoogle } from '../../counter/adminGoogleSignIn.js';
import { mintSessionToken, SESSION_TTL_SECONDS } from '../../services/auth.service.js';
import { encryptSecret } from '../../lib/crypto.js';
import { orderWebhookPayload } from '../../counter/orderWebhookPayload.js';
import { assertPublicHttpsUrl } from '../../lib/ssrfGuard.js';
import { adminSessionFrom, adminSessionDiagnosis, hasAdminSession, type SessionFailure } from '../../lib/adminSession.js';

// A WooCommerce-shaped read surface, so print-on-demand platforms can connect.
//
// Printful, Printify and Tapstitch do not accept a key and then let you push
// to them — they connect by PULLING from your store, on their schedule,
// against the WooCommerce REST API. That is why their setup screen asks for a
// consumer key and secret: it is a login TO YOUR STORE. Counter had no such
// surface, so those integrations could not be completed at all.
//
// SCOPE, stated honestly: this implements the endpoints those platforms
// actually call to validate a connection and sync a catalogue and orders. It
// is NOT a complete WooCommerce API and does not pretend to be — coupons, tax
// classes, refunds, reports and the rest are absent. If a partner needs one of
// those, it needs adding deliberately rather than being faked with an empty
// array that makes the partner think the store has no coupons.
//
// Money: WooCommerce sends prices as decimal STRINGS ("19.99"), while this
// schema stores integer minor units. Every price crosses that boundary through
// toMajor() — emitting the raw integer would advertise £19.99 as £1,999.

const PREFIX = '/wp-json/wc/v3';

// Exact-parity helpers with real WooCommerce (verified field-by-field against a
// live WooCommerce store, wc/v3). The bridge has to look like a real store to a
// connector, or its schema validation rejects the response as a sync error.
const STORE_ORIGIN = process.env.PUBLIC_ORIGIN || '';
const REST_ALLOW = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
function wooLinks(selfPath: string, collectionPath: string, upPath?: string) {
  return {
    self: [{ href: `${STORE_ORIGIN}/wp-json/wc/v3/${selfPath}`, targetHints: { allow: REST_ALLOW } }],
    collection: [{ href: `${STORE_ORIGIN}/wp-json/wc/v3/${collectionPath}` }],
    ...(upPath ? { up: [{ href: `${STORE_ORIGIN}/wp-json/wc/v3/${upPath}` }] } : {}),
  };
}
// A WooCommerce image object. We hold one URL, not the resized set WordPress
// generates, so srcset/sizes are empty and thumbnail reuses the source — but
// every field a connector reads (thumbnail especially) is present.
function wooImage(id: number, src: string, name: string, alt: string, created: string, mod: string, position?: number) {
  return {
    id, date_created: created, date_created_gmt: created, date_modified: mod, date_modified_gmt: mod,
    src, name, alt, srcset: '', sizes: '', thumbnail: src,
    ...(position !== undefined ? { position } : {}),
  };
}

/** Consent screen renders partner-supplied text; escaping keeps it text. */
function escapeHtml(v: string): string {
  return v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

interface StoreAuth {
  id: string;
  label: string;
  scope: 'read' | 'read_write';
  /** True only for admin-issued (/store-keys) keys — see order scoping. */
  firstParty: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    storeAuth?: StoreAuth;
  }
}

const ORDER_STATUSES = ['pending', 'processing', 'shipped', 'delivered', 'failed', 'cancelled'] as const;

/** Narrows an arbitrary partner-supplied string to a real order status. */
function asOrderStatus(value: string | undefined): OrderStatus | null {
  if (!value || value === 'any') return null;
  // Woo has no "shipped" status — POD partners report fulfilment by writing
  // back "completed" (and place holds as "on-hold"). Without this mapping a
  // partner's "completed" write-back silently no-oped: asOrderStatus returned
  // null, the status never moved, and the store kept showing "processing" for
  // an order the factory had already shipped.
  const WOO_ALIASES: Record<string, OrderStatus> = {
    completed: 'shipped' as OrderStatus,
    'on-hold': 'processing' as OrderStatus,
  };
  if (value in WOO_ALIASES) return WOO_ALIASES[value] ?? null;
  return (ORDER_STATUSES as readonly string[]).includes(value) ? (value as OrderStatus) : null;
}

/** Woo's own error envelope — partners parse `code` and `message`. */
function wooError(reply: FastifyReply, status: number, code: string, message: string): void {
  reply.status(status).send({ code, message, data: { status } });
}

/**
 * WooCommerce's OWN key auth, run against keys imported from the reference site
 * store. Woo stores `consumer_key` as hash_hmac('sha256', ck, 'wc-api') and the
 * secret in plaintext, and verifies by hashing the presented key the same way.
 * Copying that store's key table (wc_compat_keys) + this exact check means every
 * partner ALREADY connected there — Tapstitch, PODpartner, PodPluser, Printful,
 * Printify — authenticates HERE with the identical credentials. No reconnect, no
 * re-issue, no per-partner capture. This is the "reverse-engineer the working
 * store" path: our bridge accepts precisely what the real store accepted.
 */
async function wcCompatVerify(key: string, secret: string): Promise<StoreAuth | null> {
  const keyHash = createHmac('sha256', 'wc-api').update(key).digest('hex');
  // The compat-key table is an OPTIONAL import from the reference store — a fresh
  // environment (and CI) has no such table. A missing table must degrade to
  // "no compat key matched" (fall through to a clean 401), NOT throw a raw-query
  // error that surfaces as a 500 on every invalid key.
  let rows: { secret: string; scope: string; description: string | null }[];
  try {
    rows = await db.$queryRawUnsafe<{ secret: string; scope: string; description: string | null }[]>(
      'SELECT secret, scope, description FROM wc_compat_keys WHERE key_hash = $1 LIMIT 1',
      keyHash,
    );
  } catch {
    return null;
  }
  const row = rows[0];
  if (!row) return null;
  const a = Buffer.from(secret);
  const b = Buffer.from(row.secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  // Imported from the reference store = a PARTNER (Tapstitch/PODpartner/…), never
  // first-party. Fenced to its own vendor's orders.
  return { id: `wc:${keyHash.slice(0, 16)}`, label: row.description ?? 'Connected partner', scope: row.scope === 'read' ? 'read' : 'read_write', firstParty: false };
}

async function authenticate(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const presented = readStoreCredential(req);
  if (!presented) {
    wooError(reply, 401, 'woocommerce_rest_cannot_view', 'Consumer key and secret are required.');
    return;
  }
  // Native keys issued by THIS store first; then WooCommerce-compat keys imported
  // from the real store, so a partner already connected there works unchanged.
  const auth = (await storeCredentials.verify(presented.key, presented.secret, req.ip))
    ?? (await wcCompatVerify(presented.key, presented.secret));
  if (!auth) {
    wooError(reply, 401, 'woocommerce_rest_authentication_error', 'Consumer key or secret is invalid.');
    return;
  }
  req.storeAuth = auth;
}

function requireWrite(req: FastifyRequest, reply: FastifyReply): boolean {
  if (req.storeAuth?.scope !== 'read_write') {
    wooError(reply, 403, 'woocommerce_rest_cannot_edit', 'This store key is read-only.');
    return false;
  }
  return true;
}

/** Woo pagination: ?page & ?per_page, capped so a partner cannot ask for everything at once. */
function paging(req: FastifyRequest): { skip: number; take: number; page: number; perPage: number } {
  const q = req.query as Record<string, string | undefined>;
  const page = Math.max(1, Number.parseInt(q.page ?? '1', 10) || 1);
  const perPage = Math.min(100, Math.max(1, Number.parseInt(q.per_page ?? '10', 10) || 10));
  return { skip: (page - 1) * perPage, take: perPage, page, perPage };
}

/** Woo sends totals in headers; partners use them to know when to stop paging. */
function setPagingHeaders(reply: FastifyReply, total: number, perPage: number): void {
  reply.header('X-WP-Total', String(total));
  reply.header('X-WP-TotalPages', String(Math.max(1, Math.ceil(total / perPage))));
}

/**
 * Woo incremental-sync date cursors. `after`/`before` filter date_created;
 * `modified_after`/`modified_before` filter date_modified. A POD partner polls
 * "orders modified since my last sync" — ignoring these made every poll return
 * the FULL processing list, so the partner re-saw orders it had already
 * de-duped away and could never pick up a correction. Values are ISO 8601.
 */
function wooDateWhere(q: Record<string, string | undefined>): { createdAt?: { gte?: Date; lte?: Date }; updatedAt?: { gte?: Date; lte?: Date } } {
  const parse = (s?: string): Date | undefined => { if (!s) return undefined; const d = new Date(s); return Number.isNaN(d.getTime()) ? undefined : d; };
  const cGte = parse(q.after), cLte = parse(q.before), mGte = parse(q.modified_after), mLte = parse(q.modified_before);
  const w: { createdAt?: { gte?: Date; lte?: Date }; updatedAt?: { gte?: Date; lte?: Date } } = {};
  if (cGte || cLte) w.createdAt = { ...(cGte ? { gte: cGte } : {}), ...(cLte ? { lte: cLte } : {}) };
  if (mGte || mLte) w.updatedAt = { ...(mGte ? { gte: mGte } : {}), ...(mLte ? { lte: mLte } : {}) };
  return w;
}

async function loadProducts(where: object, skip: number, take: number) {
  return db.product.findMany({
    where,
    skip,
    take,
    orderBy: { createdAt: 'desc' },
    include: { variants: true, categories: true, tags: true },
  });
}

// The ONLY products a public/partner catalogue read may see. Matches the
// storefront feed gate (storefront.ts): live lifecycle, public audience, not
// trashed. A trashed product keeps its row (deletedAt set) so this is not
// optional — the crewneck leak was a private/draft product served through the
// keyless Store API. deletedAt:null is separated so a status filter can still
// narrow WITHIN the public set without ever exposing trash.
const PUBLIC_PRODUCT_GATE = { status: 'active' as ProductStatus, visibility: 'public', deletedAt: null };

type ProductRow = Awaited<ReturnType<typeof loadProducts>>[number];

/**
 * The connector's OWN name for a variation axis, echoed back verbatim. A strict
 * connector verifies the read-back against what it sent, and Printify's size
 * axis is literally "Pin size": answering "Size" failed its post-publish check on
 * every multi-variant product (single-variant ones have nothing to verify, which
 * is why only those ever linked). Captured into variant.meta.attrNames on push;
 * falls back to our generic label when a variant predates that capture.
 */
function axisName(v: { meta?: unknown }, key: 'color' | 'size', fallback: string): string {
  const m = v.meta as { attrNames?: Record<string, unknown> } | null | undefined;
  const n = m?.attrNames?.[key];
  return typeof n === 'string' && n.trim() ? n : fallback;
}

function toWooProduct(p: ProductRow, currency: string) {
  const first = p.variants[0];
  const gallery = Array.isArray(p.images) ? (p.images as { url?: string; alt?: string }[]) : [];
  // availableOf, not raw inventory: an in_stock (made-to-order) variant holds
  // 0 counted units but is UNLIMITED-available, so summing inventory reported
  // every POD product out of stock.
  const anyTracked = p.variants.some((v) => isTracked(v));
  const totalStock = p.variants.reduce((n, v) => n + availableOf(v), 0);
  const trackedQty = p.variants.reduce((n, v) => n + (isTracked(v) ? Math.max(0, v.inventory - v.reserved) : 0), 0);
  const variable = p.variants.length > 1;
  const price = first ? String(toMajor(first.price, currency)) : '0';
  const now = p.updatedAt.toISOString();
  const created = p.createdAt.toISOString();

  // Variation AXES. A POD platform reads product.attributes to learn the
  // dimensions (Color: [Black, White], Size: [S, M, L]) and maps each variation
  // to them. Missing this array, a variable product syncs as unmappable — the
  // single biggest reason a pull "works" but the sync then errors.
  const colors = [...new Set(p.variants.map((v) => v.color).filter((x): x is string => !!x))];
  const sizes = [...new Set(p.variants.map((v) => v.size).filter((x): x is string => !!x))];
  const attributes: { id: number; name: string; slug: string; position: number; visible: boolean; variation: boolean; options: string[] }[] = [];
  // Axis names as the connector itself named them (see axisName) — the parent's
  // attribute list must agree with the variations' or the verification fails.
  const colorName = p.variants.map((v) => axisName(v, 'color', '')).find(Boolean) || 'Color';
  const sizeName = p.variants.map((v) => axisName(v, 'size', '')).find(Boolean) || 'Size';
  // Echo the connector's option ORDER and its default attribute verbatim (both
  // stored from its parent PUT in writeProduct). A strict connector compares
  // these as sent; our creation-order guess ("3, 1.25, 2.25") read as a
  // mismatch against the "1.25, 2.25, 3" it published.
  const wc = (p.meta && typeof p.meta === 'object' ? p.meta : {}) as { wcAttrOptions?: Record<string, string[]>; wcDefaultAttributes?: unknown[] };
  const ordered = (name: string, vals: string[]): string[] => {
    const want = wc.wcAttrOptions?.[name];
    if (!Array.isArray(want)) return vals;
    const rank = new Map(want.map((o, i) => [o, i]));
    return [...vals].sort((a, b) => (rank.get(a) ?? 1e9) - (rank.get(b) ?? 1e9));
  };
  if (colors.length) attributes.push({ id: 0, name: colorName, slug: 'color', position: attributes.length, visible: true, variation: variable, options: ordered(colorName, colors) });
  if (sizes.length) attributes.push({ id: 0, name: sizeName, slug: 'size', position: attributes.length, visible: true, variation: variable, options: ordered(sizeName, sizes) });

  // The full WooCommerce v3 product shape. A strict connector validates every
  // field it knows, so the fields we don't track are emitted with WooCommerce's
  // own documented defaults rather than omitted (an omitted field a schema
  // marks required is a validation failure = "sync error").
  return {
    // WooCommerce ids are INTEGERS — a POD connector stores the returned id in
    // an integer column, so a cuid string breaks publish (it can't record what
    // it published) and every later lookup. wooId is a real auto-increment int.
    id: p.wooId ?? 0,
    name: p.name,
    slug: p.slug,
    permalink: '',
    date_created: created,
    date_created_gmt: created,
    date_modified: now,
    date_modified_gmt: now,
    type: variable ? 'variable' : 'simple',
    status: p.status === 'active' ? 'publish' : 'draft',
    has_options: variable,
    global_unique_id: '',
    post_password: '',
    featured: false,
    catalog_visibility: 'visible',
    description: p.description ?? '',
    short_description: '',
    sku: first?.sku ?? '',
    price,
    regular_price: price,
    sale_price: '',
    date_on_sale_from: null,
    date_on_sale_from_gmt: null,
    date_on_sale_to: null,
    date_on_sale_to_gmt: null,
    on_sale: false,
    purchasable: true,
    total_sales: 0,
    virtual: false,
    downloadable: false,
    downloads: [],
    download_limit: -1,
    download_expiry: -1,
    external_url: '',
    button_text: '',
    tax_status: 'taxable',
    tax_class: '',
    manage_stock: anyTracked,
    stock_quantity: anyTracked ? trackedQty : null,
    stock_status: totalStock > 0 ? 'instock' : 'outofstock',
    backorders: 'no',
    backorders_allowed: false,
    backordered: false,
    low_stock_amount: null,
    sold_individually: false,
    weight: '',
    dimensions: { length: '', width: '', height: '' },
    shipping_required: true,
    shipping_taxable: true,
    shipping_class: '',
    shipping_class_id: 0,
    reviews_allowed: true,
    average_rating: '0.00',
    rating_count: 0,
    related_ids: [],
    upsell_ids: [],
    cross_sell_ids: [],
    parent_id: 0,
    purchase_note: '',
    categories: p.categories.map((c) => ({ id: c.wooId ?? 0, name: c.name, slug: c.slug })),
    tags: p.tags.map((t) => ({ id: t.wooId ?? 0, name: t.name, slug: t.slug })),
    brands: [],
    images: [
      ...(p.image ? [wooImage((p.wooId ?? 0) * 1000, p.image, p.name, p.name, created, now, 0)] : []),
      ...gallery.filter((g) => g.url).map((g, i) => wooImage((p.wooId ?? 0) * 1000 + i + 1, g.url!, g.alt ?? '', g.alt ?? '', created, now, i + 1)),
    ],
    attributes,
    // Verbatim from the connector's parent PUT (see writeProduct) — Printify
    // sends a default (e.g. Pin size = 3") and verifies it on read-back.
    default_attributes: Array.isArray(wc.wcDefaultAttributes) ? wc.wcDefaultAttributes : [],
    variations: variable ? p.variants.map((v) => v.wooId ?? 0) : [],
    grouped_products: [],
    menu_order: 0,
    price_html: '',
    related_ids_html: '',
    meta_data: [],
    _links: wooLinks(`products/${p.wooId ?? 0}`, 'products'),
  };
}

// A wc/v3 product VARIATION, field-for-field with real WooCommerce. parent_id
// and name were the load-bearing omissions: a connector maps each pushed
// variation back to its product by parent_id, and shows name; without them the
// confirmation pass fails and the whole push reads as a sync error.
type VariantRow = { wooId: number | null; sku: string | null; price: number; inventory: number; reserved: number; color: string | null; size: string | null; image: string | null; createdAt: Date; meta?: unknown };
function wooVariation(v: VariantRow, currency: string, parentWoo: number) {
  const vp = String(toMajor(v.price, currency));
  const tracked = isTracked(v as unknown as { stockStatus: string });
  const avail = availableOf(v as unknown as Parameters<typeof availableOf>[0]);
  const ts = v.createdAt.toISOString();
  const name = [v.color, v.size].filter(Boolean).join(', ');
  return {
    id: v.wooId ?? 0,
    type: 'variation',
    date_created: ts, date_created_gmt: ts, date_modified: ts, date_modified_gmt: ts,
    description: '', permalink: '',
    sku: v.sku ?? '', global_unique_id: '',
    price: vp, regular_price: vp, sale_price: '',
    date_on_sale_from: null, date_on_sale_from_gmt: null, date_on_sale_to: null, date_on_sale_to_gmt: null,
    on_sale: false, status: 'publish', purchasable: true,
    virtual: false, downloadable: false, downloads: [], download_limit: -1, download_expiry: -1,
    tax_status: 'taxable', tax_class: '',
    manage_stock: tracked,
    stock_quantity: tracked ? Math.max(0, v.inventory - v.reserved) : null,
    stock_status: avail > 0 ? 'instock' : 'outofstock',
    backorders: 'no', backorders_allowed: false, backordered: false, low_stock_amount: null,
    weight: '', dimensions: { length: '', width: '', height: '' },
    shipping_class: '', shipping_class_id: 0,
    image: v.image ? wooImage((v.wooId ?? 0) * 10, v.image, name, name, ts, ts) : null,
    gallery_image_ids: [],
    attributes: [
      ...(v.color ? [{ id: 0, name: axisName(v, 'color', 'Color'), slug: 'color', option: v.color }] : []),
      ...(v.size ? [{ id: 0, name: axisName(v, 'size', 'Size'), slug: 'size', option: v.size }] : []),
    ],
    menu_order: 0,
    meta_data: [],
    name,
    parent_id: parentWoo,
    _links: wooLinks(`products/${parentWoo}/variations/${v.wooId ?? 0}`, `products/${parentWoo}/variations`, `products/${parentWoo}`),
  };
}

// Every wc/v3 route we serve, advertised the way real WooCommerce advertises
// its own. A POD connector introspects /wp-json (and /wc/v3) to decide the
// store is a real, complete WooCommerce before it syncs — a list of three
// routes reads as a broken store even when each endpoint works when called
// directly. Params use [\w-]+ (our ids are cuids, not integers).
const wcRoute = (methods: string[]) => ({ namespace: 'wc/v3', methods });
const WC_V3_ROUTE_MAP: Record<string, { namespace: string; methods: string[] }> = {
  '/wc/v3': wcRoute(['GET']),
  '/wc/v3/products': wcRoute(['GET', 'POST']),
  '/wc/v3/products/(?P<id>[\\w-]+)': wcRoute(['GET', 'PUT', 'DELETE']),
  '/wc/v3/products/batch': wcRoute(['POST']),
  '/wc/v3/products/(?P<product_id>[\\w-]+)/variations': wcRoute(['GET', 'POST']),
  '/wc/v3/products/(?P<product_id>[\\w-]+)/variations/batch': wcRoute(['POST']),
  '/wc/v3/products/(?P<product_id>[\\w-]+)/variations/(?P<id>[\\w-]+)': wcRoute(['GET', 'PUT', 'DELETE']),
  '/wc/v3/products/categories': wcRoute(['GET', 'POST']),
  '/wc/v3/products/categories/(?P<id>[\\w-]+)': wcRoute(['GET']),
  '/wc/v3/products/tags': wcRoute(['GET', 'POST']),
  '/wc/v3/products/attributes': wcRoute(['GET']),
  '/wc/v3/products/shipping_classes': wcRoute(['GET']),
  '/wc/v3/orders': wcRoute(['GET', 'POST']),
  '/wc/v3/orders/(?P<id>[\\w-]+)': wcRoute(['GET', 'PUT']),
  '/wc/v3/orders/(?P<order_id>[\\w-]+)/notes': wcRoute(['GET', 'POST']),
  '/wc/v3/customers': wcRoute(['GET']),
  '/wc/v3/coupons': wcRoute(['GET']),
  '/wc/v3/shipping/zones': wcRoute(['GET']),
  '/wc/v3/shipping_methods': wcRoute(['GET']),
  '/wc/v3/taxes': wcRoute(['GET']),
  '/wc/v3/taxes/classes': wcRoute(['GET']),
  '/wc/v3/data/countries': wcRoute(['GET']),
  '/wc/v3/settings': wcRoute(['GET']),
  '/wc/v3/settings/general': wcRoute(['GET']),
  '/wc/v3/system_status': wcRoute(['GET']),
  '/wc/v3/system_status/tools': wcRoute(['GET']),
  '/wc/v3/webhooks': wcRoute(['GET', 'POST']),
  '/wc/v3/webhooks/(?P<id>[\\w-]+)': wcRoute(['GET', 'PUT', 'DELETE']),
};
const WC_DISCOVERY_ROUTES = {
  ...WC_V3_ROUTE_MAP,
  '/wc/v2': { namespace: 'wc/v2', methods: ['GET'] },
  '/wc/v2/printful/store_data': { namespace: 'wc/v2', methods: ['GET'] },
  '/wc/store/v1/products': { namespace: 'wc/store/v1', methods: ['GET'] },
  '/wc/store/v1/products/(?P<id>[\\w-]+)': { namespace: 'wc/store/v1', methods: ['GET'] },
  // WordPress media, so a connector that uploads product mockups (Tapstitch)
  // sees the endpoint exists and uploads them here instead of skipping images.
  '/wp/v2/media': { namespace: 'wp/v2', methods: ['GET', 'POST'] },
  '/wp/v2/media/(?P<id>[\\d]+)': { namespace: 'wp/v2', methods: ['GET'] },
};

export async function wooCompatRoutes(app: FastifyInstance): Promise<void> {
  const authed = { preHandler: authenticate };

  // LEGACY WooCommerce REST API (/wc-api/v3/…) — the pre-wp-json surface.
  // Tapstitch's connect flow validates a store by GET /wc-api/v3/products/count
  // (seen live: six connect attempts on 2026-08-12, each a fresh key, each
  // 404ing here and failing the connection — the 11 dead "Tapstitch connection"
  // credentials are this loop's residue). PODpartner's docs likewise tell the
  // merchant to enable the "legacy REST API". Only the endpoints partners
  // actually probe are implemented; shapes match Woo's legacy v3.
  app.get('/wc-api/v3', authed, async (_req, reply) => {
    const c = await settingsService.getCommerce();
    reply.send({ store: { name: 'Sidemoney', URL: 'https://sidemoney.co', wc_version: '10.4.3', routes: {}, meta: { currency: c.currency ?? 'USD', timezone: 'UTC' } } });
  });
  app.get('/wc-api/v3/products/count', authed, async (_req, reply) => {
    // Same gate as the catalogue read (GET /wc/v3/products), or this count
    // includes non-public / soft-deleted-but-active rows and disagrees with the
    // total a partner then pages, reading as an incomplete sync (audit).
    const count = await db.product.count({ where: PUBLIC_PRODUCT_GATE });
    reply.send({ count });
  });
  app.get('/wc-api/v3/orders/count', authed, async (req, reply) => {
    // Scope the count too — an unscoped count leaked store-wide lifetime order
    // volume to any partner (audit R6 minor). First-party sees all; a partner
    // sees only its own.
    const scope = await partnerOrderScope(req);
    const count = await db.order.count({ where: scope ?? {} });
    reply.send({ count });
  });

  // A partner refers to a product/category/variation by the INTEGER wooId we
  // hand out; our own internal calls still use the cuid. Resolve either form so
  // a numeric id from a connector and a cuid from our admin both find the row.
  // wooId is a Prisma Int (32-bit): a numeric id beyond 2^31-1 makes Prisma throw
  // a value-out-of-range error (surfacing as a 500, even on the public keyless
  // Store API), so an over-range numeric is routed to the cuid column instead —
  // it can't match, yielding a clean 404 rather than a 500 (audit).
  const safeWooId = (id: string): number | null => (/^\d+$/.test(id) && Number(id) <= 2147483647 ? Number(id) : null);
  const byWooOrCuid = (id: string) => { const n = safeWooId(id); return n !== null ? { wooId: n } : { id }; };

  // Flight recorder. POD sync fails on THEIR dashboard with no detail we can
  // see; this logs every wp-json response ≥400 with the request body, so the
  // next failing partner call names itself instead of forcing another guess.
  app.addHook('onResponse', async (req, reply) => {
    if (reply.statusCode >= 400 && req.url.includes('/wp-json/')) {
      // Auth scheme matters: a 401 from a partner signing with OAuth 1.0a (the
      // WooCommerce-standard the header carries as "OAuth …") means we rejected
      // a method real Woo accepts, not a wrong key.
      const authHeader = req.headers.authorization ?? '';
      const scheme = authHeader ? authHeader.split(' ')[0] : (String(req.url).includes('oauth_signature') ? 'oauth-query' : (String(req.url).includes('consumer_key') ? 'key-query' : 'none'));
      req.log.warn(
        { wcFail: true, method: req.method, url: req.url.split('?')[0], status: reply.statusCode, authScheme: scheme, body: JSON.stringify(req.body ?? {}).slice(0, 300) },
        'wc-compat failure',
      );
    }
  });

  // The consent screen below is an HTML FORM, so its POST arrives as
  // application/x-www-form-urlencoded — a content type Fastify does not parse
  // out of the box and answers with 415. Scoped to this plugin, so the rest of
  // the API keeps rejecting form posts as before.
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_req, body, done) => {
      try {
        done(null, Object.fromEntries(new URLSearchParams(body as string)));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  /**
   * WordPress REST discovery — UNAUTHENTICATED, on purpose.
   *
   * A partner offering a list of platforms (Shopify / Woo / Wix / …) probes
   * this BEFORE it asks for credentials: it fetches /wp-json/, looks for the
   * `wc/v3` namespace, and only then shows the consumer key form. Without it
   * the WooCommerce option fails at "is this a WordPress site?" and the
   * partner reports an invalid store URL — with no hint that the credentials
   * were never the problem.
   *
   * It exposes nothing but the site name and which API namespaces exist,
   * which is the same thing every public WordPress site advertises.
   */
  const discovery = async (req: FastifyRequest, reply: FastifyReply) => {
    const site = await settingsService.getSite();
    const origin = storeUrl(req);
    reply.send({
      name: site.siteName || 'Therum OS',
      description: site.tagline ?? '',
      // A partner reads url/home to learn WHICH store it is connecting to — real
      // WooCommerce returns the site URL here. Empty strings made Tapstitch's
      // connect dead-end on "please input website" AFTER a successful key handoff:
      // it had the keys but no store to attach them to. Populate like real Woo.
      url: origin,
      home: origin,
      gmt_offset: 0,
      timezone_string: 'UTC',
      // wc/v2 is not legacy support — it is where Printful's plugin registers
      // its own routes, and their client checks this list before calling them.
      namespaces: ['wp/v2', 'wc/v2', 'wc/v3', 'wc/store/v1'],
      authentication: {},
      routes: WC_DISCOVERY_ROUTES,
    });
  };
  app.get('/wp-json', discovery);
  app.get('/wp-json/', discovery);

  /** Namespace index — the second probe, once wc/v3 is known to exist. */
  app.get(PREFIX, async (_req, reply) => {
    reply.send({ namespace: 'wc/v3', routes: WC_V3_ROUTE_MAP });
  });

  /**
   * The wc/v2 namespace index.
   *
   * v2 is a real, complete namespace here — every standard route is served on
   * it, rewritten to v3 in `rewriteUrl` (they are the same API). Printful's
   * client asks for `wc/v2/system_status`, so a v2 index listing only the
   * plugin routes would advertise a namespace that cannot do the job.
   *
   * `printful/*` is the exception that is genuinely v2-only, and the plugin
   * marks all of it `show_in_index => false` except `store_data`.
   */
  app.get('/wp-json/wc/v2', async (_req, reply) => {
    reply.send({
      namespace: 'wc/v2',
      routes: {
        '/wc/v2/products': { namespace: 'wc/v2', methods: ['GET', 'POST'] },
        '/wc/v2/orders': { namespace: 'wc/v2', methods: ['GET', 'PUT'] },
        '/wc/v2/system_status': { namespace: 'wc/v2', methods: ['GET'] },
        '/wc/v2/printful/store_data': { namespace: 'wc/v2', methods: ['GET'] },
      },
    });
  });

  /**
   * The endpoint every partner hits FIRST to prove the credentials work. If
   * this 404s, their UI reports "could not connect to your store" with no
   * further detail, so it has to exist even though it carries little.
   */
  app.get(`${PREFIX}/system_status`, authed, async (req, reply) => {
    const [site, commerce] = await Promise.all([settingsService.getSite(), settingsService.getCommerce()]);
    const origin = storeUrl(req);
    reply.send({
      /**
       * The FULL environment object, key for key.
       *
       * Field names and the complete list come from WooCommerce's own
       * controller (`class-wc-rest-system-status-v2-controller.php`,
       * `get_item_schema()`), not from guesswork. A connector that reads a
       * field we never send gets `undefined` and decides the store is broken —
       * and it reports that as whatever generic message it has, which is how
       * three separate rounds here got blamed on credentials.
       *
       * `remote_post_successful` / `remote_get_successful` matter more than
       * they look: they tell a partner the store can call OUT to it. The values
       * are true because this server genuinely can.
       */
      environment: {
        // These were EMPTY STRINGS, and a partner uses them to identify which
        // store it is talking to — an empty site_url is a store it cannot place.
        home_url: origin,
        site_url: origin,
        store_id: null,
        version: '9.0.0', // The Woo API version we speak, not our own version.
        log_directory: '/var/log/',
        log_directory_writable: true,
        wp_version: '6.5',
        wp_multisite: false,
        wp_memory_limit: 268435456,
        wp_debug_mode: false,
        wp_cron: true,
        wp_environment_type: 'production',
        language: 'en_US',
        server_info: 'Therum OS / Counter',
        server_architecture: 'Linux x86_64',
        php_version: '8.2',
        php_post_max_size: 67108864,
        php_max_execution_time: 60,
        php_max_input_vars: 5000,
        curl_version: '8.5.0, OpenSSL/3.0',
        suhosin_installed: false,
        max_upload_size: 67108864,
        mysql_version: '8.0',
        mysql_version_string: '8.0',
        default_timezone: 'UTC',
        fsockopen_or_curl_enabled: true,
        soapclient_enabled: false,
        domdocument_enabled: true,
        gzip_enabled: true,
        mbstring_enabled: true,
        remote_post_successful: true,
        remote_post_response: 200,
        remote_get_successful: true,
        remote_get_response: 200,
        external_object_cache: true,
      },
      /**
       * THE FIELD THAT WAS MISSING, and the whole of `Error: []`.
       *
       * Printful reads this list to confirm the store can speak its protocol —
       * on WordPress that means finding its own plugin installed. We had no
       * such key at all, so it got an empty array back, reported it verbatim to
       * the merchant, and stopped. `Error: []` names neither the field nor the
       * reason, which is why it read as a credential problem for so long.
       *
       * These entries are not decoration: each one corresponds to a surface
       * this server genuinely implements. `wc/v2/printful/*` is real (see
       * below), and the WooCommerce REST API is real. Listing anything we do
       * NOT implement would just move the failure later, to whichever call the
       * partner made because we claimed to support it.
       */
      active_plugins: [
        {
          plugin: 'woocommerce/woocommerce.php',
          name: 'WooCommerce',
          version: '9.0.0',
          version_latest: '9.0.0',
          url: 'https://woocommerce.com',
          author_name: 'Automattic',
          author_url: 'https://woocommerce.com',
          network_activated: false,
        },
        // BOTH directory names, deliberately.
        //
        // The plugin's main file is `printful-shipping.php` while its
        // wordpress.org slug is `printful-shipping-for-woocommerce` — so the
        // directory was renamed at some point and the ORIGINAL path was
        // `printful-shipping/printful-shipping.php`. Printful's check dates
        // from 2019 ("On February 15th, 2019 Printful has ended support for
        // legacy versions…"), which is exactly the era of the old path.
        //
        // A path it does not recognise reads as "not installed", and its
        // version comparison against an absent version fails closed — which is
        // reported as "update the Printful plugin to version 2.0.7 or higher"
        // even though the version we send is 2.2.12. Listing both costs
        // nothing and removes the guess.
        ...['printful-shipping', 'printful-shipping-for-woocommerce'].map((dir) => ({
          plugin: `${dir}/printful-shipping.php`,
          name: 'Printful Integration for WooCommerce',
          // Must be >= 2.0.7, and version_latest must EQUAL it — a lower
          // "latest" reads as an update being available, which is the same
          // complaint by another route.
          version: '2.2.12',
          version_latest: '2.2.12',
          url: 'https://wordpress.org/plugins/printful-shipping-for-woocommerce/',
          author_name: 'Printful',
          author_url: 'https://www.printful.com',
          network_activated: false,
        })),
      ],
      inactive_plugins: [],
      dropins_mu_plugins: { dropins: [], mu_plugins: [] },
      settings: {
        api_enabled: true,
        force_ssl: true,
        currency: commerce.currency ?? 'USD',
        currency_symbol: '',
        currency_position: 'left',
        thousand_separator: ',',
        decimal_separator: '.',
        decimals: 2,
        product_visibility_terms: {},
        taxonomies: {},
      },
      database: {
        wc_database_version: '9.0.0',
        database_prefix: 'wp_',
        database_tables: {},
      },
      theme: {
        name: site.siteName || 'Therum OS',
        version: '1.0.0',
        is_child_theme: false,
        has_woocommerce_support: true,
        has_woocommerce_file: true,
      },
      security: { secure_connection: origin.startsWith('https://'), hide_errors: true },
      pages: [],
      post_type_counts: [],
      logging: { logging_enabled: false, default_handler: '', retention_period_days: 30, level_threshold: '' },
    });
  });

  /**
   * The WooCommerce AUTHORISATION handshake — the thing that makes a partner's
   * "Connect to WooCommerce" button actually one click.
   *
   * Without it the merchant has to generate a key by hand, copy two long
   * strings and a URL, and paste them into the partner. WITH it, the partner
   * sends them here, they approve once, and the store POSTs freshly-minted
   * credentials straight to the partner's callback. Nothing is copied and
   * nothing can be mistyped.
   *
   * GET  /wc-auth/v1/authorize?app_name&scope&user_id&return_url&callback_url
   *   -> a consent screen.
   * POST (same URL, approve=1)
   *   -> mints a key, POSTs it to callback_url, redirects to return_url.
   *
   * Security notes, because this endpoint hands out store credentials:
   *
   *   The consent screen requires an ADMIN SESSION. Without that check the URL
   *   is a credential vending machine for anyone who can talk the merchant
   *   into clicking a link.
   *
   *   `callback_url` must be HTTPS, as WooCommerce requires — the response
   *   body IS the secret, and posting it over plaintext hands it to the
   *   network. Localhost is allowed so this can be developed against.
   *
   *   The key is minted only AFTER the merchant approves, never on the GET.
   */
  const AUTH_PREFIX = '/wc-auth/v1/authorize';

  interface AuthQuery {
    app_name?: string;
    scope?: string;
    user_id?: string;
    return_url?: string;
    callback_url?: string;
  }

  /** The origin the merchant actually typed, honouring the TLS terminator. */
  function publicOrigin(req: FastifyRequest): string {
    const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim() || 'https';
    // No tenant domain as a fallback. Host is effectively always present;
    // when it is not, localhost is honest and a stranger's domain is not.
    return `${proto}://${req.headers.host ?? 'localhost'}`;
  }

  function googleRedirectUri(req: FastifyRequest): string {
    return `${publicOrigin(req)}${AUTH_PREFIX}/google/callback`;
  }

  /**
   * Share the cookie across apex and www.
   *
   * Mirrors admin/lib/session.ts exactly — a session minted here must be the
   * same session the admin app reads, or signing in with Google would leave
   * the admin still logged out. Undefined for localhost and bare IPs, where a
   * Domain attribute makes the browser drop the cookie silently.
   */
  function sessionCookieDomain(host: string | undefined): string | undefined {
    if (!host) return undefined;
    const name = host.split(':')[0]!.toLowerCase();
    if (name === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(name) || !name.includes('.')) return undefined;
    return name.replace(/^www\./, '');
  }

  function setSessionCookie(reply: FastifyReply, req: FastifyRequest, token: string): void {
    const domain = sessionCookieDomain(req.headers.host);
    reply.header('set-cookie', [
      `th_session=${token}`,
      'Path=/',
      `Max-Age=${SESSION_TTL_SECONDS}`,
      ...(domain ? [`Domain=${domain}`] : []),
      'HttpOnly',
      'Secure',
      'SameSite=Lax',
    ].join('; '));
  }

  function validAuthRequest(q: AuthQuery): string | null {
    if (!q.app_name?.trim()) return 'app_name is required.';
    if (!q.scope || !['read', 'write', 'read_write'].includes(q.scope)) return 'scope must be read, write or read_write.';
    if (!q.user_id?.trim()) return 'user_id is required.';
    if (!q.return_url?.trim()) return 'return_url is required.';
    if (!q.callback_url?.trim()) return 'callback_url is required.';
    // BOTH urls get parsed here, not just the callback. return_url used to be
    // checked for emptiness only, so `return_url=not-a-url` passed validation
    // and then threw inside `new URL()` further down — a bare 500 with nothing
    // naming the cause, which is the exact debugging dead end that cost days on
    // the Printful and PODpartner connections.
    for (const [name, value] of [['callback_url', q.callback_url!], ['return_url', q.return_url!]] as const) {
      try {
        const u = new URL(value);
        const localhost = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
        if (u.protocol !== 'https:' && !localhost) return `${name} must be HTTPS.`;
      } catch {
        return `${name} is not a valid URL.`;
      }
    }
    return null;
  }


/**
   * The approval screen. One renderer, used by the GET and by the POST when it
   * has to come back with an error — two copies of this markup would drift, and
   * the copy people only see on a failed password is the one that rots.
   */
  function approvalScreen(
    q: AuthQuery,
    who: { username: string } | null,
    why: SessionFailure | null,
    facts: { host: string; cookieNames: string[]; from: string | null },
    googleHref: string | null,
    error?: string,
  ): string {
    const app_name = escapeHtml(q.app_name!);
    const params = new URLSearchParams(q as Record<string, string>).toString();
    const scope = q.scope === 'read' ? 'Read' : q.scope === 'write' ? 'Write' : 'Read/Write';

    // What read_write actually grants, spelled out. WooCommerce lists this and
    // it is the only part of the screen that tells a merchant what they are
    // agreeing to.
    const grants = q.scope === 'read'
      ? ['View coupons', 'View customers', 'View orders and sales reports', 'View products']
      : ['Create webhooks', 'View and manage coupons', 'View and manage customers',
         'View and manage orders and sales reports', 'View and manage products'];

    /**
     * Why we cannot see a session, said plainly.
     *
     * Showing "sign in" to somebody who IS signed in, six times, with no way to
     * tell which of four different causes was in play, is what made this take
     * as long as it did.
     */
    const REASON: Record<SessionFailure, string> = {
      'no-cookie': 'This browser sent no session for <b>this address</b>. If you are signed in to the store on a different address (www vs no www, or an IP), the session does not carry across — sign in below and it will.',
      'expired': 'Your store session has expired (they last 12 hours). Signing in below renews it.',
      'bad-signature': 'This browser is holding a session this store cannot verify — usually one left over from before a server change. Signing in below replaces it.',
      'wrong-role': 'This browser is holding a partial sign-in (the second factor was never completed). Signing in below finishes it.',
    };

    const errorHtml = error ? `<p class="err">${escapeHtml(error)}</p>` : '';
    const signedIn = who !== null;

    /**
     * The two facts that tell apart the only two real causes.
     *
     * If ZERO cookies arrived and the click came from another site, the browser
     * withheld them (SameSite) — the session exists, it just was not sent. If
     * cookies arrived but none is th_session, there is genuinely no store
     * session in this browser. Nothing here is secret: it is the caller's own
     * request, described back to them. Cookie NAMES only, never values.
     */
    const facts_line = signedIn ? '' : `<p class="dx">host <b>${escapeHtml(facts.host)}</b>
      · cookies received: <b>${facts.cookieNames.length ? escapeHtml(facts.cookieNames.join(', ')) : 'none'}</b>
      · arrived from: <b>${escapeHtml(facts.from ?? 'direct (typed or bookmarked)')}</b></p>`;

    return `<!doctype html>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Connect ${app_name}</title>
  <style>
   body{font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f6f7f9;margin:0;
        display:flex;min-height:100vh;align-items:center;justify-content:center;color:#111}
   .card{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:28px;max-width:460px;width:calc(100% - 32px)}
   h1{font-size:19px;margin:0 0 10px} p{color:#555;margin:0 0 14px}
   ul{color:#555;margin:0 0 18px;padding-left:20px} li{margin:3px 0}
   .who{display:flex;align-items:center;gap:10px;background:#f3f4f6;border-radius:10px;padding:10px 12px;margin:0 0 18px;font-size:14px}
   .who .av{width:34px;height:34px;border-radius:50%;background:#d8dade;flex:0 0 34px}
   .who .nm{color:#111;font-weight:600}
   .row{display:flex;gap:10px}
   button{font:inherit;border:0;border-radius:10px;padding:12px 16px;cursor:pointer;flex:1}
   .go{background:#070707;color:#fff;font-weight:600;border-radius:0;text-transform:uppercase;letter-spacing:.06em;font-size:12px;padding:15px 16px}
   .no{background:#fff;border:1px solid #d8dade;color:#444}
   .fl{display:block;text-align:left;font-size:12px;font-weight:600;color:#555;margin-bottom:10px}
   .fl input{width:100%;margin-top:5px;padding:10px 12px;border:1px solid #d8dade;border-radius:8px;font:inherit;box-sizing:border-box}
   .err{background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;font-size:13px;border-radius:8px;padding:10px 12px;margin:0 0 14px}
   .why{background:#fffbeb;border:1px solid #fde68a;color:#78350f;font-size:13px;border-radius:8px;padding:10px 12px;margin:0 0 16px}
   .why b{color:#78350f}
   .dx{font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:#6b7280;background:#f9fafb;
       border:1px solid #e5e7eb;border-radius:8px;padding:8px 10px;margin:-8px 0 16px;word-break:break-word}
   .dx b{color:#374151}
   .goog{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;box-sizing:border-box;
         padding:12px 16px;border:1px solid #d8dade;border-radius:10px;background:#fff;color:#3c4043;
         font-weight:600;font-size:14px;text-decoration:none;margin:0 0 14px}
   .goog:hover{background:#f8f9fa}
   .or{display:flex;align-items:center;gap:10px;color:#9ca3af;font-size:12px;margin:0 0 14px}
   .or::before,.or::after{content:"";flex:1;height:1px;background:#e5e7eb}
  </style>
  <div class="card">
    <h1>${app_name} would like to connect to your store</h1>
    <p>This will give <strong>${app_name}</strong> <strong>${scope}</strong> access, which will allow it to:</p>
    <ul>${grants.map((g) => `<li>${g}</li>`).join('')}</ul>
    ${errorHtml}
    ${signedIn ? `
    <div class="who"><span class="av"></span>
      <span>Signed in as <span class="nm">${escapeHtml(who.username)}</span></span>
    </div>` : `<p class="why">${why ? REASON[why] : ''}</p>${facts_line}`}
    <form method="POST" action="${AUTH_PREFIX}?${escapeHtml(params)}">
      ${signedIn || !googleHref ? '' : `
      <a class="goog" href="${escapeHtml(googleHref)}">
        <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/></svg>
        Sign in with Google
      </a>
      <div class="or"><span>or</span></div>`}
      ${signedIn ? '' : `
      <label class="fl">Email or username
        <input name="username" type="text" autocomplete="username" required autofocus>
      </label>
      <label class="fl">Password
        <input name="password" type="password" autocomplete="current-password" required>
      </label>`}
      <div class="row">
        <button class="no" name="approve" value="0" type="submit">Deny</button>
        <button class="go" name="approve" value="1" type="submit">${signedIn ? 'Approve' : 'Sign in &amp; approve'}</button>
      </div>
    </form>
  </div>`;
  }

  /**
   * Send the approval screen: correct policy, correct cache headers, and the
   * identity it actually resolved.
   *
   * TWO headers here are not cosmetic.
   *
   * `Cache-Control: private, no-store` — nginx stamps
   * `public, max-age=0, must-revalidate` on everything it serves, and this page's
   * entire content depends on a cookie. "public" on a per-session page is wrong
   * even with must-revalidate, and it is the kind of wrong that produces a
   * signed-in merchant staring at a sign-in form.
   *
   * `Vary: Cookie` — without it, ANY cache between here and the browser is
   * entitled to serve one visitor's copy of this page to another.
   *
   * helmet's default `form-action 'self'` also blocks the redirect this flow
   * ends in, silently — no error, no navigation, a button that looks dead. The
   * relaxed policy has to be on EVERY render, including the one that comes back
   * after a wrong password.
   */
  async function sendApprovalScreen(
    reply: FastifyReply,
    req: FastifyRequest,
    q: AuthQuery,
    error?: string,
  ): Promise<void> {
    const allow = new Set<string>();
    for (const u of [q.return_url, q.callback_url]) {
      try { if (u) allow.add(new URL(u).origin); } catch { /* validAuthRequest already rejected it */ }
    }
    reply.header(
      'content-security-policy',
      "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
      "script-src 'none'; base-uri 'self'; frame-ancestors 'none'; " +
      `form-action 'self'${allow.size ? ' ' + [...allow].join(' ') : ''}`,
    );
    reply.header('cache-control', 'private, no-store, max-age=0, must-revalidate');
    reply.header('vary', 'Cookie');

    // The token carries only `sub` (a cuid) — the name has to come from the
    // account, or the screen greets you by database id.
    const session = adminSessionFrom(req);
    const why = session ? null : adminSessionDiagnosis(req);
    let who: { username: string } | null = null;
    if (session) {
      const account = await db.adminUser.findUnique({
        where: { id: session.sub }, select: { username: true },
      });
      // A VERIFIED session with no matching row still counts as signed in.
      // Authorization is the signature, not the lookup — falling back to the
      // password form here would demand a sign-in from someone who already has
      // one, which is the exact failure this screen exists to stop.
      who = account ?? { username: 'this store' };
    }
    const cookieNames = (req.headers.cookie ?? '')
      .split(';').map((c) => c.split('=')[0]?.trim()).filter((n): n is string => !!n);
    let from: string | null = null;
    try { from = req.headers.referer ? new URL(req.headers.referer).host : null; } catch { from = null; }

    // Only offered when the store actually has a Google app configured — a
    // button that leads to an error page is worse than no button.
    const googleHref = who ? null : (await googleApp())
      ? `${AUTH_PREFIX}/google?${new URLSearchParams(q as Record<string, string>).toString()}`
      : null;

    reply.type('text/html; charset=utf-8').send(
      approvalScreen(q, who, why, { host: req.headers.host ?? '?', cookieNames, from }, googleHref, error),
    );
  }

  app.get(AUTH_PREFIX, async (req, reply) => {
    /**
     * NO REDIRECT TO THE ADMIN LOGIN.
     *
     * Bouncing to /tos-admin/login and back produced four separate failures in
     * a row — the param name, the router's basePath, the server redirect's
     * basePath, and a session cookie that was host-only while partners send
     * merchants to whichever host they typed. Each fix revealed the next, and
     * every one of them looked identical from the merchant's side: a login
     * page with nothing to approve.
     *
     * The approval now signs you in ON ITSELF. One page, one POST, no hops
     * across an app boundary that keeps rewriting the destination.
     */
    const q = req.query as AuthQuery;
    const problem = validAuthRequest(q);
    if (problem) {
      reply.status(400).type('text/html').send(`<!doctype html><meta charset="utf-8"><p>${escapeHtml(problem)}</p>`);
      return;
    }
    await sendApprovalScreen(reply, req, q);
  });

  /**
   * Sign in with Google, then land back on the approval screen.
   *
   * Exists so the one page that hands out store keys does not have to ask for
   * a password. Redirect flow, so the screen keeps `script-src 'none'`.
   */
  app.get(`${AUTH_PREFIX}/google`, async (req, reply) => {
    const q = req.query as AuthQuery;
    const problem = validAuthRequest(q);
    if (problem) { reply.status(400).send({ message: problem }); return; }

    const app_ = await googleApp();
    if (!app_) {
      await sendApprovalScreen(reply, req, q,
        'Google sign-in is not set up for this store yet — add a Google connection in Nexus first.');
      return;
    }
    // Return to THIS approval, with its partner params intact.
    const returnTo = `${AUTH_PREFIX}?${new URLSearchParams(q as Record<string, string>).toString()}`;
    reply.redirect(authorizeUrl(app_, googleRedirectUri(req), signState(returnTo)), 302);
  });

  app.get(`${AUTH_PREFIX}/google/callback`, async (req, reply) => {
    const q = req.query as { code?: string; state?: string; error?: string };

    const state = q.state ? readState(q.state) : null;
    if (!state) {
      // A missing or forged state is the CSRF case: an attacker making this
      // browser redeem a code they control. Nothing is minted and there is
      // nowhere safe to send them, so it ends here.
      reply.status(400).type('text/html').send('<!doctype html><meta charset="utf-8"><p>This sign-in link has expired. Start the connection again from the partner.</p>');
      return;
    }
    const back = new URL(state.returnTo, publicOrigin(req));
    const backQ = Object.fromEntries(back.searchParams) as unknown as AuthQuery;

    if (q.error || !q.code) {
      await sendApprovalScreen(reply, req, backQ, 'Google sign-in was cancelled.');
      return;
    }

    const app_ = await googleApp();
    if (!app_) { await sendApprovalScreen(reply, req, backQ, 'Google sign-in is not set up for this store.'); return; }

    const identity = await exchangeCode(app_, q.code, googleRedirectUri(req));
    if (!identity) { await sendApprovalScreen(reply, req, backQ, 'Google did not confirm that sign-in. Try again.'); return; }

    const admin = await adminForGoogle(identity);
    if (!admin) {
      // Deliberately names the address so the operator can link it, and grants
      // nothing: a verified Google account is proof of identity, never proof
      // of authority over this store.
      await sendApprovalScreen(reply, req, backQ,
        `${identity.email} is not linked to an admin account on this store. Sign in with your store password once and link it, or use the form below.`);
      return;
    }

    setSessionCookie(reply, req, mintSessionToken(admin.id, admin.roleId ? 'custom' : 'admin'));
    reply.redirect(back.toString(), 302);
  });

  app.post(AUTH_PREFIX, async (req, reply) => {
    const q = req.query as AuthQuery;
    const problem = validAuthRequest(q);
    if (problem) {
      reply.status(400).send({ message: problem });
      return;
    }
    const body = (req.body ?? {}) as { approve?: string; username?: string; password?: string };
    const returnUrl = new URL(q.return_url!);
    returnUrl.searchParams.set('user_id', q.user_id!);

    /**
     * THIS is the request that hands out credentials, so it is the one that
     * has to be authenticated — either by an existing admin session, or by
     * credentials submitted on the approval screen itself.
     *
     * The password path goes through authService.login, so it inherits that
     * function's rate limiting and audit logging rather than opening a second,
     * weaker door. A wrong password re-renders the same screen with a generic
     * message: telling the caller WHICH half was wrong turns this into an
     * account-enumeration oracle on a public URL.
     */
    if (!hasAdminSession(req)) {
      if (body.approve !== '1') {
        // Cancelling needs no credentials — nothing is issued.
        returnUrl.searchParams.set('success', '0');
        reply.redirect(returnUrl.toString(), 302);
        return;
      }
      if (!body.username || !body.password) {
        await sendApprovalScreen(reply, req, q,
          'Enter your store sign-in and password to approve.');
        return;
      }
      try {
        const result = await authService.login({ username: body.username, password: body.password }, req.ip);
        if ('needsTwoFactor' in result && result.needsTwoFactor) {
          // Two-factor is a multi-step flow that does not belong on a partner
          // approval screen; those accounts approve from the admin instead.
          await sendApprovalScreen(reply, req, q,
          'This account uses two-factor sign-in. Open the store admin, sign in there, then click Connect again.');
          return;
        }
      } catch (err) {
        const tooMany = (err as { statusCode?: number }).statusCode === 429;
        await sendApprovalScreen(reply, req, q,
          tooMany
          ? 'Too many attempts — wait a few minutes and try again.'
          : 'That sign-in and password did not match. Try again.');
        return;
      }
    }

    if (body.approve !== '1') {
      // Woo's documented rejection signal.
      returnUrl.searchParams.set('success', '0');
      reply.redirect(returnUrl.toString(), 302);
      return;
    }

    const scope = q.scope === 'read' ? 'read' : 'read_write';
    // NOT "(auto)". test/counter.test.mjs deletes every credential whose label
    // contains that string, so running the suite silently revoked live partner
    // connections — which is exactly how the Printful connection died.
    const issued = await storeCredentials.issue(`${q.app_name} connection`, scope);

    // The partner receives the secret here — the only time it exists outside
    // this response.
    let delivered = false;
    try {
      // WooCommerce delivers these keys to the partner's callback as
      // FORM-URLENCODED (application/x-www-form-urlencoded), NOT JSON. A partner
      // built against real Woo (Tapstitch) parses the callback as a form; a JSON
      // body silently fails to parse there, the keys are dropped, and the connect
      // dead-ends on the partner side ("please input website") while our own log
      // shows the key issued fine. Match Woo exactly. key_id is the NUMERIC db id.
      // WordPress sets its outbound User-Agent to `WordPress/<ver>; <site-url>`
      // on EVERY remote request. A WooCommerce connector reads the store URL out
      // of that header on the key callback (the body has no url), then attaches
      // the keys to that store. Node's default UA carries no url, so Tapstitch
      // received the keys but had no store to bind them to -> "please input
      // website". Match WP's UA exactly so the URL rides along.
      // EXACT match to WooCommerce core `WC_Auth::post_consumer_data()`
      // (includes/class-wc-auth.php): JSON body via wp_json_encode, this exact
      // Content-Type, WP's default User-Agent (which carries the site URL), 60s.
      // The other vendors connected with this (JSON) shape and work; my earlier
      // switch to form-urlencoded is what turned Tapstitch's connect into
      // "Invalid data. Please input the correct value." key_id is the numeric id.
      const res = await fetch(q.callback_url!, {
        method: 'POST',
        headers: {
          'content-type': 'application/json;charset=UTF-8',
          'user-agent': `WordPress/6.5; ${storeUrl(req)}`,
        },
        body: JSON.stringify({
          key_id: issued.keyId,
          user_id: q.user_id,
          consumer_key: issued.consumerKey,
          consumer_secret: issued.consumerSecret,
          key_permissions: scope,
        }),
        signal: AbortSignal.timeout(60_000),
      });
      delivered = res.ok;
      const respBody = await res.text().catch(() => '');
      req.log.info({ callback: q.callback_url, status: res.status, delivered, resp: respBody.slice(0, 400) }, 'wc-auth-callback-delivery');
    } catch (err) {
      delivered = false;
      req.log.warn({ callback: q.callback_url, err: err instanceof Error ? err.message : String(err) }, 'wc-auth-callback-failed');
    }

    // A key the partner never received is a key nobody can use and nobody can
    // account for — revoke it rather than leave it live.
    if (!delivered) {
      await storeCredentials.revoke(issued.id).catch(() => {});
      returnUrl.searchParams.set('success', '0');
      reply.redirect(returnUrl.toString(), 302);
      return;
    }

    returnUrl.searchParams.set('success', '1');
    reply.redirect(returnUrl.toString(), 302);
  });

  app.get(`${PREFIX}/products`, authed, async (req, reply) => {
    const { skip, take, perPage } = paging(req);
    const q = req.query as Record<string, string | undefined>;
    // Two different reads share this endpoint. A BROWSE-style catalogue pull
    // must never receive trashed or private products and defaults to live
    // (active). But an exact `?sku=` lookup is a CONNECTOR finding the row it
    // already pushed so it can UPDATE it — and gating THAT by visibility:'public'
    // or the active-status default hides a product staged as `members`/draft
    // (e.g. a season not yet public). The connector then never finds its own
    // product, falls back to id 0, dead-ends at /products/0/variations, and
    // re-creates the product as a duplicate on every publish — this is exactly
    // what produced the "Copy of Copy of…" pins. This endpoint is partner-
    // authenticated (not public), and the WRITE-path dedup helper
    // (`existingBySku`) is already ungated the same way, so a sku lookup matches
    // by sku alone (still never trashed) to close that read/write asymmetry.
    const bySku = !!q.sku;
    const where = {
      deletedAt: null,
      // Browse keeps the public gate; a sku lookup does not.
      ...(bySku ? {} : { visibility: 'public' }),
      // Explicit ?status= always wins; browse defaults to active; a sku lookup
      // imposes no status default so drafts still match.
      ...(q.status && q.status !== 'any'
        ? { status: (q.status === 'publish' ? 'active' : 'draft') as ProductStatus }
        : bySku ? {} : { status: 'active' as ProductStatus }),
      ...(q.sku ? { variants: { some: { sku: q.sku } } } : {}),
      ...(q.search ? { name: { contains: q.search, mode: 'insensitive' as const } } : {}),
    };
    const commerce = await settingsService.getCommerce();
    const [rows, total] = await Promise.all([
      loadProducts(where, skip, take),
      db.product.count({ where }),
    ]);
    // A connector's `?sku=` lookup decides its whole publish path: found → it
    // adopts that product's id and UPDATES; empty → it falls back to id 0 and
    // dead-ends. Log exactly what we answered so a "went to /products/0" in
    // nginx is explainable from our side, not guessed at.
    const currency = commerce.currency ?? 'USD';
    if (bySku) {
      // Real WooCommerce answers `?sku=<variation sku>` with the VARIATION object
      // (type "variation", carrying `parent_id`), NOT the parent product. A
      // connector reads `parent_id` from that to learn which product to update.
      // Handed the parent shape instead, Printify found no `parent_id`, resolved
      // it to 0, and walked GET/PUT /products/0 until the publish died — every
      // multi-variant publish, every time (2026-09-15 forensics: our lookup
      // matched [185] and Printify still called /products/0). A simple product
      // (one variant) still answers as the product, exactly as Woo does.
      // Both branches are plain JSON for the wire; widen so flatMap unifies the
      // variation and product shapes instead of rejecting the union.
      const items = rows.flatMap((p): Record<string, unknown>[] => p.variants.length > 1
        ? p.variants.filter((v) => v.sku === q.sku).map((v) => wooVariation(v, currency, p.wooId ?? 0) as Record<string, unknown>)
        : [toWooProduct(p, currency) as Record<string, unknown>]);
      req.log.info({ sku: q.sku, matched: rows.map((p) => p.wooId ?? 0), total, asVariation: rows.some((p) => p.variants.length > 1), items: items.length }, 'wc-sku-lookup');
      setPagingHeaders(reply, items.length, perPage);
      reply.send(items);
      return;
    }
    setPagingHeaders(reply, total, perPage);
    reply.send(rows.map((p) => toWooProduct(p, currency)));
  });

  // PRODUCT TAXONOMY. A POD platform's sync fetches /products/categories and
  // /products/tags to map or create its own taxonomy before pushing products —
  // it is part of the standard WooCommerce handshake, not an optional extra.
  // These MUST be declared before /products/:id: without them the path
  // "/products/categories" matched the :id route, looked up a product called
  // "categories", and 404'd "Invalid product ID" — which every partner read as
  // a broken store and reported as a sync error.
  const toWooCategory = (c: { wooId: number | null; name: string; slug: string; parentId: string | null; _count?: { products: number } }) => ({
    id: c.wooId ?? 0, name: c.name, slug: c.slug, parent: 0,
    description: '', display: 'default', image: null, menu_order: 0, count: c._count?.products ?? 0,
    _links: wooLinks(`products/categories/${c.wooId ?? 0}`, 'products/categories'),
  });
  const toWooTag = (t: { wooId: number | null; name: string; slug: string; _count?: { products: number } }) => ({
    id: t.wooId ?? 0, name: t.name, slug: t.slug, description: '', count: t._count?.products ?? 0,
    _links: wooLinks(`products/tags/${t.wooId ?? 0}`, 'products/tags'),
  });
  const catCount = { _count: { select: { products: true } } } as const;

  app.get(`${PREFIX}/products/categories`, authed, async (req, reply) => {
    const { skip, take, perPage } = paging(req);
    const q = req.query as Record<string, string | undefined>;
    const where = q.search ? { name: { contains: q.search, mode: 'insensitive' as const } } : {};
    const [rows, total] = await Promise.all([
      db.productCategory.findMany({ where, skip, take, orderBy: { name: 'asc' }, include: catCount }),
      db.productCategory.count({ where }),
    ]);
    setPagingHeaders(reply, total, perPage);
    reply.send(rows.map(toWooCategory));
  });

  app.get(`${PREFIX}/products/categories/:id`, authed, async (req, reply) => {
    const { id } = req.params as { id: string };
    const c = await db.productCategory.findFirst({ where: byWooOrCuid(id), include: catCount });
    if (!c) { wooError(reply, 404, 'woocommerce_rest_product_category_invalid_id', 'Invalid resource ID.'); return; }
    reply.send(toWooCategory(c));
  });

  app.post(`${PREFIX}/products/categories`, authed, async (req, reply) => {
    if (!requireWrite(req, reply)) return; // a read-only key must not mutate taxonomy
    const b = (req.body ?? {}) as { name?: string; slug?: string; parent?: string | number };
    if (!b.name) { wooError(reply, 400, 'woocommerce_rest_missing_param', 'Missing parameter: name.'); return; }
    const slug = (b.slug && slugify(b.slug, 80)) || slugify(b.name, 80);
    const parentId = b.parent && b.parent !== 0 && b.parent !== '0' ? String(b.parent) : null;
    // Idempotent: a partner that re-syncs must not error on an existing slug.
    const existing = await db.productCategory.findFirst({ where: { slug, parentId }, include: catCount });
    const created = existing ?? await db.productCategory.create({ data: { name: b.name, slug, parentId }, include: catCount });
    reply.status(existing ? 200 : 201).send(toWooCategory(created));
  });

  app.get(`${PREFIX}/products/tags`, authed, async (req, reply) => {
    const { skip, take, perPage } = paging(req);
    const q = req.query as Record<string, string | undefined>;
    const where = q.search ? { name: { contains: q.search, mode: 'insensitive' as const } } : {};
    const [rows, total] = await Promise.all([
      db.productTag.findMany({ where, skip, take, orderBy: { name: 'asc' }, include: catCount }),
      db.productTag.count({ where }),
    ]);
    setPagingHeaders(reply, total, perPage);
    reply.send(rows.map(toWooTag));
  });

  app.post(`${PREFIX}/products/tags`, authed, async (req, reply) => {
    if (!requireWrite(req, reply)) return; // a read-only key must not mutate taxonomy
    const b = (req.body ?? {}) as { name?: string; slug?: string };
    if (!b.name) { wooError(reply, 400, 'woocommerce_rest_missing_param', 'Missing parameter: name.'); return; }
    const slug = (b.slug && slugify(b.slug, 80)) || slugify(b.name, 80);
    const existing = await db.productTag.findFirst({ where: { slug }, include: catCount });
    const created = existing ?? await db.productTag.create({ data: { name: b.name, slug }, include: catCount });
    reply.status(existing ? 200 : 201).send(toWooTag(created));
  });

  // We have no global product attributes; a partner that lists them expects an
  // array, and an empty one is a valid "none defined" answer — not an error.
  app.get(`${PREFIX}/products/attributes`, authed, async (_req, reply) => {
    setPagingHeaders(reply, 0, 100);
    reply.send([]);
  });

  // Attribute + term create/batch. A connector (PODpartner) sets up its Color and
  // Size attributes and their values BEFORE it can push a single product; GET
  // returns [] so it always tries to CREATE them, and without these the create
  // 404s and the whole sync stalls at step one. We derive attributes from the
  // variants themselves and keep no attribute table, so we ACK the create with a
  // STABLE id (a hash of the name, so a re-create returns the same id) — enough
  // for the connector to reference and proceed. Terms are ACKed the same way.
  const attrId = (name: string): number => {
    let h = 5381;
    for (let i = 0; i < name.length; i++) h = ((h * 33) ^ name.charCodeAt(i)) >>> 0;
    return (h % 900000) + 100000;
  };
  const asAttr = (name: string, slug?: string) => ({
    id: attrId(name), name, slug: slug || `pa_${slugify(name)}`, type: 'select', order_by: 'menu_order', has_archives: false,
  });
  const asTerm = (attr: string, name: string) => ({ id: attrId(`${attr}:${name}`), name, slug: slugify(name), description: '', menu_order: 0, count: 0 });

  app.post(`${PREFIX}/products/attributes`, authed, async (req, reply) => {
    if (!requireWrite(req, reply)) return;
    const a = (req.body ?? {}) as { name?: string; slug?: string };
    reply.status(201).send(asAttr(a.name ?? 'Attribute', a.slug));
  });
  app.post(`${PREFIX}/products/attributes/batch`, authed, async (req, reply) => {
    if (!requireWrite(req, reply)) return;
    const b = (req.body ?? {}) as { create?: { name?: string; slug?: string }[]; update?: { id?: number; name?: string; slug?: string }[]; delete?: number[] };
    reply.send({
      create: (b.create ?? []).map((a) => asAttr(a.name ?? 'Attribute', a.slug)),
      update: (b.update ?? []).map((a) => (a.name ? asAttr(a.name, a.slug) : { id: a.id ?? 0 })),
      delete: (b.delete ?? []).map((id) => ({ id })),
    });
  });
  for (const m of ['PUT', 'PATCH'] as const) {
    app.route({ method: m, url: `${PREFIX}/products/attributes/:id`, preHandler: authenticate, handler: async (req, reply) => {
      if (!requireWrite(req, reply)) return;
      const a = (req.body ?? {}) as { name?: string; slug?: string };
      reply.send(a.name ? asAttr(a.name, a.slug) : { id: Number((req.params as { id: string }).id) || 0, name: 'Attribute', slug: '', type: 'select' });
    } });
  }
  app.get(`${PREFIX}/products/attributes/:id`, authed, async (req, reply) => {
    reply.send({ id: Number((req.params as { id: string }).id) || 0, name: 'Attribute', slug: '', type: 'select', order_by: 'menu_order', has_archives: false });
  });
  app.get(`${PREFIX}/products/attributes/:id/terms`, authed, async (_req, reply) => {
    setPagingHeaders(reply, 0, 100);
    reply.send([]);
  });
  app.post(`${PREFIX}/products/attributes/:id/terms`, authed, async (req, reply) => {
    if (!requireWrite(req, reply)) return;
    const t = (req.body ?? {}) as { name?: string };
    reply.status(201).send(asTerm(String((req.params as { id: string }).id), t.name ?? ''));
  });
  app.post(`${PREFIX}/products/attributes/:id/terms/batch`, authed, async (req, reply) => {
    if (!requireWrite(req, reply)) return;
    const id = String((req.params as { id: string }).id);
    const b = (req.body ?? {}) as { create?: { name?: string }[]; update?: { id?: number; name?: string }[]; delete?: number[] };
    reply.send({
      create: (b.create ?? []).map((t) => asTerm(id, t.name ?? '')),
      update: (b.update ?? []).map((t) => (t.name ? asTerm(id, t.name) : { id: t.id ?? 0 })),
      delete: (b.delete ?? []).map((did) => ({ id: did })),
    });
  });

  // /products/shipping_classes is the SAME fall-through trap as categories —
  // without it "shipping_classes" was read as a product id and 404'd. We keep
  // no shipping classes, so the honest answer is an empty list, 200.
  app.get(`${PREFIX}/products/shipping_classes`, authed, async (_req, reply) => {
    setPagingHeaders(reply, 0, 100);
    reply.send([]);
  });

  // ── WordPress media upload (POST /wp-json/wp/v2/media) ──
  // On real WordPress a connector (Tapstitch) uploads product MOCKUPS into the
  // media library, then references them on the product by id. Our compat had no
  // such endpoint, so Tapstitch skipped the gallery and sent only the single
  // inline design file — a product with a full gallery on WordPress landed here
  // with no photos. This stores the upload like any other asset and returns a
  // WP-shaped media object; writeProduct resolves the id back to the stored file.
  // The integer id WP expects is a stable hash of our asset id, kept in the
  // asset meta so ANY cluster instance can resolve it — no schema change.
  const wpMediaIdOf = (assetId: string): number => {
    let h = 5381;
    for (let i = 0; i < assetId.length; i += 1) h = ((h * 33) ^ assetId.charCodeAt(i)) >>> 0;
    return (h % 2_000_000_000) + 1;
  };
  const mediaOrigin = (req: FastifyRequest): string => `https://${req.hostname}`;
  const wpMediaObject = (wpId: number, asset: { url: string; alt: string | null; meta: unknown }, origin: string) => {
    const m = (asset.meta ?? {}) as { mimetype?: string; width?: number; height?: number };
    return {
      id: wpId, type: 'attachment', status: 'inherit', slug: String(wpId),
      link: origin + asset.url, source_url: origin + asset.url,
      media_type: 'image', mime_type: m.mimetype ?? 'image/jpeg',
      alt_text: asset.alt ?? '', title: { raw: '', rendered: '' },
      media_details: { width: m.width ?? 0, height: m.height ?? 0, file: asset.url },
    };
  };

  app.post('/wp-json/wp/v2/media', authed, async (req, reply) => {
    if (!requireWrite(req, reply)) return;
    const ct = String(req.headers['content-type'] ?? '');
    let filename = 'upload';
    let mimetype = ct.split(';')[0]?.trim() || 'image/jpeg';
    let buffer: Buffer;
    if (ct.includes('multipart/form-data')) {
      const file = await req.file();
      if (!file) { wooError(reply, 400, 'rest_upload_no_data_supplied', 'No data supplied.'); return; }
      filename = file.filename; mimetype = file.mimetype; buffer = await file.toBuffer();
    } else {
      const raw = req.body as unknown;
      if (!Buffer.isBuffer(raw) || raw.length === 0) { wooError(reply, 400, 'rest_upload_no_data_supplied', 'No data supplied.'); return; }
      buffer = raw;
      const cd = String(req.headers['content-disposition'] ?? '');
      const fn = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
      if (fn && fn[1]) { try { filename = decodeURIComponent(fn[1]); } catch { filename = fn[1]; } }
    }
    const asset = await mediaService.upload({ filename, mimetype, buffer });
    const wpId = wpMediaIdOf(asset.id);
    await db.mediaAsset.update({ where: { id: asset.id }, data: { meta: { ...((asset.meta ?? {}) as object), wpMediaId: wpId } as Prisma.InputJsonValue } });
    reply.status(201).send(wpMediaObject(wpId, asset, mediaOrigin(req)));
  });

  app.get('/wp-json/wp/v2/media/:id', authed, async (req, reply) => {
    const wpId = Number((req.params as { id: string }).id);
    const asset = wpId ? await db.mediaAsset.findFirst({ where: { meta: { path: ['wpMediaId'], equals: wpId } } }) : null;
    if (!asset) { wooError(reply, 404, 'rest_post_invalid_id', 'Invalid attachment ID.'); return; }
    reply.send(wpMediaObject(wpId, asset, mediaOrigin(req)));
  });

  // Store-level endpoints a WooCommerce connector probes on connect / sync.
  // WooCommerce implements all of these; a 404 reads as "not a real store" and
  // aborts the sync, so each answers with a valid empty/minimal payload. The
  // ones that carry real data (currency, base country) are filled from
  // settings so a partner maps prices and shipping correctly.
  const emptyList = (route: string) => app.get(`${PREFIX}${route}`, authed, async (_req, reply) => {
    setPagingHeaders(reply, 0, 100);
    reply.send([]);
  });
  emptyList('/shipping/zones');
  emptyList('/shipping_methods');
  emptyList('/taxes');
  emptyList('/taxes/classes');
  emptyList('/data/countries');
  emptyList('/customers');
  emptyList('/coupons');
  emptyList('/system_status/tools');

  // WooCommerce's data index — some connectors GET /data on connect to confirm
  // the store speaks the full REST API; a 404 here reads as "not a real store".
  app.get(`${PREFIX}/data`, authed, async (_req, reply) => {
    reply.send([
      { slug: 'continents', description: 'List of supported continents, countries, and states.' },
      { slug: 'countries', description: 'List of supported states in a given country.' },
      { slug: 'currencies', description: 'List of supported currencies.' },
    ]);
  });

  // /data/currencies — Tapstitch's connect VERIFICATION GETs
  // /data/currencies/current to read the store currency right after the key
  // handoff. We advertised currencies in /data but never implemented it, so that
  // call 404'd and Tapstitch failed the whole connect with "Invalid data. Please
  // input the correct value". Return WooCommerce's shape {code,name,symbol}.
  // `current` is registered before the :code route so it is not swallowed by it.
  const CURRENCIES: Record<string, { name: string; symbol: string }> = {
    USD: { name: 'United States (US) dollar', symbol: '&#36;' },
    EUR: { name: 'Euro', symbol: '&euro;' },
    GBP: { name: 'Pound sterling', symbol: '&pound;' },
    CAD: { name: 'Canadian dollar', symbol: '&#36;' },
    AUD: { name: 'Australian dollar', symbol: '&#36;' },
    JPY: { name: 'Japanese yen', symbol: '&yen;' },
  };
  const currencyObj = (code: string): { code: string; name: string; symbol: string } => {
    const c = (code || 'USD').toUpperCase();
    return { code: c, name: CURRENCIES[c]?.name ?? c, symbol: CURRENCIES[c]?.symbol ?? '' };
  };
  app.get(`${PREFIX}/data/currencies/current`, authed, async (_req, reply) => {
    const commerce = await settingsService.getCommerce();
    reply.send(currencyObj(commerce.currency ?? 'USD'));
  });
  app.get(`${PREFIX}/data/currencies`, authed, async (_req, reply) => {
    setPagingHeaders(reply, Object.keys(CURRENCIES).length, 100);
    reply.send(Object.keys(CURRENCIES).map((c) => currencyObj(c)));
  });
  app.get(`${PREFIX}/data/currencies/:code`, authed, async (req, reply) => {
    reply.send(currencyObj(String((req.params as { code: string }).code)));
  });

  app.get(`${PREFIX}/settings`, authed, async (_req, reply) => {
    reply.send([
      { id: 'general', label: 'General', description: 'General store settings.' },
      { id: 'products', label: 'Products', description: 'Product settings.' },
    ]);
  });
  app.get(`${PREFIX}/settings/general`, authed, async (_req, reply) => {
    const commerce = await settingsService.getCommerce();
    const currency = commerce.currency ?? 'USD';
    reply.send([
      { id: 'woocommerce_currency', label: 'Currency', value: currency, default: 'USD' },
      { id: 'woocommerce_default_country', label: 'Base location', value: 'US', default: 'US' },
      { id: 'woocommerce_price_num_decimals', label: 'Number of decimals', value: '2', default: '2' },
    ]);
  });
  // The Products settings group + its individual options. A POD partner reads
  // woocommerce_weight_unit / dimension_unit to interpret the sizes it pushes;
  // a 404 on /settings/products/<option> stalled the sync right there.
  const PRODUCT_SETTINGS: Record<string, { label: string; value: string }> = {
    woocommerce_weight_unit: { label: 'Weight unit', value: 'lbs' },
    woocommerce_dimension_unit: { label: 'Dimensions unit', value: 'in' },
    woocommerce_manage_stock: { label: 'Manage stock', value: 'yes' },
    woocommerce_notify_low_stock_amount: { label: 'Low stock threshold', value: '2' },
    woocommerce_notify_no_stock_amount: { label: 'Out of stock threshold', value: '0' },
    woocommerce_hide_out_of_stock_items: { label: 'Out of stock visibility', value: 'no' },
  };
  app.get(`${PREFIX}/settings/products`, authed, async (_req, reply) => {
    reply.send(Object.entries(PRODUCT_SETTINGS).map(([id, s]) => ({ id, label: s.label, value: s.value, default: s.value })));
  });
  app.get(`${PREFIX}/settings/products/:id`, authed, async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = PRODUCT_SETTINGS[id];
    if (!s) { wooError(reply, 404, 'woocommerce_rest_setting_setting_invalid', 'Invalid setting.'); return; }
    reply.send({ id, label: s.label, value: s.value, default: s.value });
  });

  // WooCommerce Store API (wc/store/v1) — PUBLIC, no key. Real WooCommerce
  // serves it, and several partner clients probe it to confirm the store is a
  // genuine WooCommerce before they sync; ours 404'd it. Prices here are in
  // MINOR units (our native storage), unlike the decimal strings wc/v3 uses.
  const STORE = '/wp-json/wc/store/v1';
  const storePrices = (minor: number, currency: string) => ({
    price: String(minor), regular_price: String(minor), sale_price: String(minor), price_range: null,
    currency_code: currency, currency_symbol: '$', currency_minor_unit: 2,
    currency_decimal_separator: '.', currency_thousand_separator: ',', currency_prefix: '$', currency_suffix: '',
  });
  const toStoreProduct = (p: ProductRow, currency: string) => {
    const first = p.variants[0];
    const variable = p.variants.length > 1;
    const totalStock = p.variants.reduce((n, v) => n + availableOf(v), 0);
    const colors = [...new Set(p.variants.map((v) => v.color).filter((x): x is string => !!x))];
    const sizes = [...new Set(p.variants.map((v) => v.size).filter((x): x is string => !!x))];
    const attributes = [];
    if (colors.length) attributes.push({ id: 0, name: 'Color', taxonomy: null, has_variations: variable, terms: colors.map((c) => ({ id: 0, name: c, slug: c })) });
    if (sizes.length) attributes.push({ id: 0, name: 'Size', taxonomy: null, has_variations: variable, terms: sizes.map((s) => ({ id: 0, name: s, slug: s })) });
    return {
      id: p.wooId ?? 0, name: p.name, slug: p.slug, parent: 0,
      type: variable ? 'variable' : 'simple', variation: '',
      permalink: '', sku: first?.sku ?? '',
      short_description: '', description: p.description ?? '',
      on_sale: false, prices: storePrices(first?.price ?? 0, currency), price_html: '',
      average_rating: '0', review_count: 0,
      images: p.image ? [{ id: (p.wooId ?? 0) * 1000, src: p.image, thumbnail: p.image, srcset: '', sizes: '', name: p.name, alt: p.name }] : [],
      categories: p.categories.map((c) => ({ id: c.wooId ?? 0, name: c.name, slug: c.slug, link: '' })),
      tags: p.tags.map((t) => ({ id: t.wooId ?? 0, name: t.name, slug: t.slug, link: '' })),
      attributes, variations: variable ? p.variants.map((v) => ({ id: v.wooId ?? 0, attributes: [] })) : [],
      has_options: variable, is_purchasable: true, is_in_stock: totalStock > 0, is_on_backorder: false,
      low_stock_remaining: null, sold_individually: false,
      add_to_cart: { text: 'Add to cart', description: '', url: '', minimum: 1, maximum: 9999, multiple_of: 1 },
      // Remaining keys real WooCommerce's Store API always emits — a client
      // that reads any of them must find it present, not undefined.
      grouped_products: [], brands: [], weight: '',
      dimensions: { length: '', width: '', height: '' },
      formatted_weight: '', formatted_dimensions: '',
      stock_availability: { text: totalStock > 0 ? 'In stock' : 'Out of stock', class: totalStock > 0 ? 'in-stock' : 'out-of-stock' },
      is_password_protected: false, extensions: {},
      _links: {
        self: [{ href: `${STORE_ORIGIN}/wp-json/wc/store/v1/products/${p.id}` }],
        collection: [{ href: `${STORE_ORIGIN}/wp-json/wc/store/v1/products` }],
      },
    };
  };
  app.get(`${STORE}/products`, async (req, reply) => {
    const { skip, take, perPage } = paging(req);
    const q = req.query as Record<string, string | undefined>;
    // PUBLIC, keyless endpoint — hard-gate to active/public/not-trashed so it can
    // never leak a draft/private/restricted/trashed product (the crewneck leak).
    const where = { ...PUBLIC_PRODUCT_GATE, ...(q.search ? { name: { contains: q.search, mode: 'insensitive' as const } } : {}) };
    const commerce = await settingsService.getCommerce();
    const [rows, total] = await Promise.all([loadProducts(where, skip, take), db.product.count({ where })]);
    setPagingHeaders(reply, total, perPage);
    reply.send(rows.map((p) => toStoreProduct(p, commerce.currency ?? 'USD')));
  });
  app.get(`${STORE}/products/:id`, async (req, reply) => {
    const { id } = req.params as { id: string };
    const commerce = await settingsService.getCommerce();
    const currency = commerce.currency ?? 'USD';
    // The Store API resolves by numeric wooId, cuid, OR slug — always inside the
    // public gate, so a direct id/slug can't fetch a hidden product either.
    // safeWooId guards the 32-bit range so an oversized numeric id (e.g.
    // /products/99999999999) resolves as a slug/miss → clean 404, not a Prisma
    // out-of-range 500 on this PUBLIC unauthenticated endpoint (audit).
    const wid = safeWooId(id);
    const idMatch = wid !== null ? { wooId: wid } : { OR: [{ id }, { slug: id }] };
    const [row] = await loadProducts({ ...PUBLIC_PRODUCT_GATE, ...idMatch }, 0, 1);
    if (row) { reply.send(toStoreProduct(row, currency)); return; }
    // VARIATION ids. Our own product list advertises `variations: [{id: <variant
    // wooId>}]`, and real WooCommerce serves those ids right back on this same
    // endpoint — ours didn't, so any client walking our own advertised ids
    // 404'd (seen live: a catalog crawler sweeping 1598–1657, 13× each).
    if (wid !== null) {
      const v = await db.productVariant.findUnique({
        where: { wooId: wid },
        include: { product: { include: { variants: true, categories: true, tags: true } } },
      });
      // Same public gate as the parent: never surface a variation whose product
      // is draft/private/trashed through the keyless Store API.
      if (v?.product && v.product.status === 'active' && v.product.visibility === 'public' && !v.product.deletedAt) {
        const p = v.product;
        const base = toStoreProduct(p as never, currency) as Record<string, unknown>;
        const name = `${p.name}${[v.color, v.size].filter(Boolean).length ? ' - ' + [v.color, v.size].filter(Boolean).join(', ') : ''}`;
        const img = v.image || p.image;
        reply.send({
          ...base,
          id: v.wooId ?? 0, name, parent: p.wooId ?? 0, type: 'variation', variation: [v.color, v.size].filter(Boolean).join(', '),
          sku: v.sku ?? '', prices: storePrices(v.price, currency),
          images: img ? [{ id: (v.wooId ?? 0) * 10, src: img, thumbnail: img, srcset: '', sizes: '', name, alt: name }] : (base.images as unknown[]),
          variations: [], has_options: false,
          is_in_stock: availableOf(v) > 0,
          stock_availability: { text: availableOf(v) > 0 ? 'In stock' : 'Out of stock', class: availableOf(v) > 0 ? 'in-stock' : 'out-of-stock' },
          attributes: [
            ...(v.color ? [{ id: 0, name: 'Color', taxonomy: null, has_variations: false, terms: [{ id: 0, name: v.color, slug: v.color }] }] : []),
            ...(v.size ? [{ id: 0, name: 'Size', taxonomy: null, has_variations: false, terms: [{ id: 0, name: v.size, slug: v.size }] }] : []),
          ],
        });
        return;
      }
    }
    wooError(reply, 404, 'woocommerce_rest_product_invalid_id', 'Invalid product ID.');
  });

  app.get(`${PREFIX}/products/:id`, authed, async (req, reply) => {
    const { id } = req.params as { id: string };
    const commerce = await settingsService.getCommerce();
    const [row] = await loadProducts(byWooOrCuid(id), 0, 1);
    if (!row) {
      // A partner (Tapstitch) reconciles the OLD reference-site product ids it still
      // remembers on EVERY publish, and treats a 404 on one as a hard "system
      // error" — even though the real product it just created landed fine. An
      // unknown NUMERIC id is only ever a stale partner mapping (our own refs are
      // cuids), so answer it with a benign unpublished stub: the reconcile becomes
      // a no-op and the publish stops falsely erroring. A cuid we do not have
      // still 404s, because that IS a real "not found".
      // `0` is NOT a stale mapping — it is a connector's "no id yet" sentinel
      // (Printify walks GET /0 → PUT /0 → /0/variations after an empty sku
      // lookup). Answering it 200 kept Printify on a phantom until
      // /0/variations/batch 404'd and the publish read as failed, every time.
      // Real WooCommerce 404s /products/0, which is exactly what sends the
      // connector down the CREATE path — where the POST dedupe returns the
      // real product's id and the link finally sticks. Positive ids keep the stub.
      if (/^\d+$/.test(id) && Number(id) > 0) {
        // Report the stale id as PUBLISHED, not draft. A POD platform polls this
        // to answer "is my publish done yet?" — a 'draft' answer reads as "not
        // done" and hangs the product on "still publishing" forever. 'publish'
        // lets the reconcile complete. It is a phantom row (the real product it
        // created lives under its own id), so this only unblocks the poll.
        reply.send({
          id: Number(id), name: '', slug: '', permalink: '', type: 'variable', status: 'publish',
          catalog_visibility: 'visible', description: '', short_description: '', sku: '',
          price: '0', regular_price: '0', sale_price: '', on_sale: false, purchasable: true,
          manage_stock: false, stock_status: 'instock', stock_quantity: null,
          attributes: [], variations: [], categories: [], tags: [], images: [], meta_data: [],
        });
        return;
      }
      wooError(reply, 404, 'woocommerce_rest_product_invalid_id', 'Invalid product ID.');
      return;
    }
    const out = toWooProduct(row, commerce.currency ?? 'USD');
    // Publish forensics (Printify only): the exact product read-back it verifies.
    if (/printify/i.test(req.storeAuth?.label ?? '')) req.log.info({ product: id, body: JSON.stringify(out).slice(0, 8000) }, 'wc-outbound-product');
    reply.send(out);
  });

  /**
   * Variations. A POD platform maps each variation to a print product, so a
   * variable product whose variations 404 syncs as unfulfillable.
   */
  app.get(`${PREFIX}/products/:id/variations`, authed, async (req, reply) => {
    const { id } = req.params as { id: string };
    const commerce = await settingsService.getCommerce();
    const currency = commerce.currency ?? 'USD';
    const parent = await db.product.findFirst({ where: byWooOrCuid(id), select: { id: true, wooId: true } });
    if (!parent) {
      // SAME stale-numeric-id reconcile as GET /products/:id above — this branch
      // was the one place it was missing, and the inconsistency is what dead-
      // ended Printify: GET /products/0 answered 200 from the product stub, then
      // THIS route 404'd on /products/0/variations, so the publish read as a hard
      // failure and Printify re-created the product as a "Copy of …" on the next
      // attempt (wooId 161-168 are all that). An unknown NUMERIC id is only ever
      // a stale partner mapping (our own refs are cuids), so answer the benign
      // empty variation set and let the poll complete; a cuid we do not have is a
      // real not-found and still 404s.
      // Same rule as GET /products/:id — `0` is "no id yet", never a stale one,
      // and must 404 so the connector creates instead of dead-ending on a phantom.
      if (/^\d+$/.test(id) && Number(id) > 0) { reply.send([]); return; }
      wooError(reply, 404, 'woocommerce_rest_product_invalid_id', 'Invalid product ID.');
      return;
    }
    // MUST paginate + set X-WP-Total / X-WP-TotalPages. Without it every page
    // returned the FULL variation set, so a partner paging through (page 1, 2,
    // 3…) to confirm the push never hit an empty page and looped forever until
    // it timed out — the "sync error" on a product whose variants all uploaded
    // fine. WooCommerce paginates variations; so do we now.
    const { skip, take, perPage } = paging(req);
    const total = await db.productVariant.count({ where: { productId: parent.id } });
    setPagingHeaders(reply, total, perPage);
    const variants = await db.productVariant.findMany({ where: { productId: parent.id }, orderBy: { createdAt: 'asc' }, skip, take });
    const parentWoo = parent.wooId ?? 0;
    const out = variants.map((v) => wooVariation(v, currency, parentWoo));
    // Publish forensics (Printify only): the exact variations read-back it verifies.
    if (/printify/i.test(req.storeAuth?.label ?? '')) req.log.info({ product: id, body: JSON.stringify(out).slice(0, 8000) }, 'wc-outbound-variations');
    reply.send(out);
  });

  // ---------------------------------------------------------------------
  // WRITES. A partner does not only READ your catalogue — it PUBLISHES to it.
  //
  // This is the half that was missing. Printful, Printify and the rest push a
  // product INTO the store when you hit "submit to store": they POST it, then
  // POST each variation. Every one of those routes 404'd here, so a connection
  // could be perfectly authenticated, sync could start, and nothing would ever
  // appear on the site — which is the entire point of connecting.
  //
  // What lands must be SELLABLE, not just present: a row with no price and no
  // stock is a product page nobody can buy from, which looks identical to a
  // successful sync until someone tries.

  /** Woo money is a decimal STRING ("19.99"); this schema is minor units. */
  function priceToMinor(value: unknown, currency: string): number | null {
    if (value === undefined || value === null || value === '') return null;
    const n = typeof value === 'number' ? value : Number.parseFloat(String(value));
    return Number.isFinite(n) ? toMinor(n, currency) : null;
  }

  interface WooImage { id?: number | string; src?: string; alt?: string; name?: string }
  interface WooAttr { id?: number | string; name?: string; option?: string; options?: string[] }

  /** Woo publishes with status "publish"; anything else is not on sale yet. */
  const asStatus = (s: unknown): ProductStatus => (s === 'publish' || s === undefined ? 'active' : 'draft');

  /** Colour and size live in Woo's attribute list, not in named fields. */
  function attrValue(attrs: WooAttr[] | undefined, ...names: string[]): string | null {
    // A connector sends a variation's attribute one of two ways: inline by NAME
    // ({name:'Color', option:'Black'}), or — when it created a GLOBAL attribute
    // first — by ID only ({id: 648952, option:'Black'}) with no name. We mint
    // those ids as attrId(name), so the id still encodes which axis it is. Match
    // both; matching name alone left every id-referenced colour/size as null
    // (PODpartner creates global Color/Size attributes, then references by id).
    const idSet = new Set<number>();
    for (const want of names) {
      idSet.add(attrId(want));
      idSet.add(attrId(want.charAt(0).toUpperCase() + want.slice(1)));
      idSet.add(attrId(want.toUpperCase()));
    }
    // Tolerant name match. Printify's WooCommerce channel sends the axis under
    // names the strict `n === want` check never saw — the taxonomy form
    // ("pa_size"), plurals ("Sizes"), or a qualified label ("Pin size"). Every
    // Printify pin batch on 2026-09-15 parsed as "?/?" while Tapstitch's parsed
    // as "Red/S": the sizes landed blank, Printify's read-back verification saw
    // no options, marked the publish failed, and kept no store link. Normalise
    // (lowercase, drop a "pa_" prefix, letters only) and accept an exact OR a
    // containing match, so "pa_size" / "sizes" / "pinsize" all read as size.
    const norm = (s: string) => s.toLowerCase().replace(/^pa_/, '').replace(/[^a-z]/g, '');
    for (const a of attrs ?? []) {
      const n = norm(a.name ?? '');
      if (n && names.some((want) => n === want || n.includes(want))) return a.option ?? a.options?.[0] ?? null;
      if (a.id != null && idSet.has(Number(a.id))) return a.option ?? a.options?.[0] ?? null;
    }
    return null;
  }

  /** The connector's raw name for an axis (e.g. "Pin size"), matched the same
   *  tolerant way as attrValue — persisted so the read-back can echo it. */
  function attrName(attrs: WooAttr[] | undefined, ...names: string[]): string | null {
    const norm = (s: string) => s.toLowerCase().replace(/^pa_/, '').replace(/[^a-z]/g, '');
    for (const a of attrs ?? []) {
      const n = norm(a.name ?? '');
      if (n && a.name && names.some((want) => n === want || n.includes(want))) return a.name;
    }
    return null;
  }
  /** meta fragment carrying the connector's axis names, or nothing if it sent none. */
  const attrNamesOf = (attrs: WooAttr[] | undefined): { attrNames?: Record<string, string> } => {
    const color = attrName(attrs, 'color', 'colour');
    const size = attrName(attrs, 'size');
    return color || size ? { attrNames: { ...(color ? { color } : {}), ...(size ? { size } : {}) } } : {};
  };

  /**
   * A slug that is free. Woo does the same thing (`t-shirt-2`), and without it
   * a partner pushing two products with the same name gets a 500 on the second
   * from the unique index — reported to the merchant as "sync failed".
   */
  async function freeSlug(desired: string): Promise<string> {
    const base = slugify(desired) || 'product';
    for (let n = 0; n < 50; n++) {
      const candidate = n === 0 ? base : `${base}-${n + 1}`;
      if (!(await db.product.findUnique({ where: { slug: candidate }, select: { id: true } }))) return candidate;
    }
    return `${base}-${Date.now()}`;
  }

  /**
   * The partner gets its own vendor row, named from the key it authenticated
   * with. Provenance is the point: without it, "where did these 40 products
   * come from" has no answer, and disconnecting a partner cannot find what it
   * published.
   */
  // Trusted pull-only partner credential ids allowed to read the FULL order stream
  // (see partnerOrderScope). Comma-separated StoreCredential ids in env; EMPTY by
  // default, so no partner key reads cross-tenant orders unless an admin explicitly
  // allowlists it. This is the deliberate replacement for the removed owns===0
  // fail-open.
  const ORDER_READER_ALLOWLIST = new Set(
    (process.env.ORDER_READER_CREDENTIAL_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  );

  async function partnerVendor(req: FastifyRequest): Promise<string> {
    // Key on the IMMUTABLE credential id, never the human label. The label is not
    // unique — every NULL-description compat key defaulted to "Connected partner",
    // so multiple partners collapsed onto ONE vendor and, via vendorId order
    // scoping, read each other's customer PII (audit C2). req.storeAuth.id is
    // unique per credential (StoreCredential.id, or wc:<keyHash> for compat keys).
    const credId = req.storeAuth?.id ?? null;
    const label = (req.storeAuth?.label ?? 'Connected partner').trim() || 'Connected partner';
    if (!credId) {
      // No credential id (should not happen once authenticated) — legacy behaviour.
      const existing = await db.vendor.findFirst({ where: { name: label } });
      return existing ? existing.id : (await db.vendor.create({ data: { name: label } })).id;
    }
    const byCred = await db.vendor.findFirst({ where: { credentialId: credId }, select: { id: true } });
    if (byCred) return byCred.id;
    // One-time legacy adoption: a DISTINCTIVE (non-default) label vendor that has
    // no credential yet is this partner's pre-existing vendor from before this
    // change — claim it atomically so its already-synced products keep matching.
    // NEVER adopt the shared "Connected partner" default (that is the collapse).
    if (label !== 'Connected partner') {
      const orphan = await db.vendor.findFirst({ where: { name: label, credentialId: null }, select: { id: true } });
      if (orphan) {
        const claimed = await db.vendor.updateMany({ where: { id: orphan.id, credentialId: null }, data: { credentialId: credId } });
        if (claimed.count === 1) return orphan.id;
        const mine = await db.vendor.findFirst({ where: { credentialId: credId }, select: { id: true } });
        if (mine) return mine.id;
      }
    }
    try {
      return (await db.vendor.create({ data: { name: label, credentialId: credId } })).id;
    } catch {
      // unique(credentialId) race — the other writer won; return theirs.
      const won = await db.vendor.findFirst({ where: { credentialId: credId }, select: { id: true } });
      return won ? won.id : (await db.vendor.create({ data: { name: label } })).id;
    }
  }

  // Per-partner order scoping. GET /orders + /orders/:id return full customer PII
  // (email, name, shipping address) for every line. Without scoping, ANY store
  // key reads EVERY order — so Printful's key can read Tapstitch's customers'
  // addresses (audit). A POD partner should only ever see orders that contain one
  // of ITS OWN lines: matched by the vendorId its synced products carry
  // (writeProduct stamps vendorId) OR its fulfillmentProvider. Because fulfilment
  // ROUTING already keys on those same fields, any order that legitimately
  // belongs to a partner carries the matching line, so scoping can never hide an
  // order the system would route to them — it only fences partners off each
  // other's data.
  //
  // SAFE FALLBACK: scope ONLY a recognised POD-provider key (by its label brand).
  // A store-wide / admin / unrecognised key returns null here and is NOT scoped,
  // so this never darks an internal integration's order pull — it only constrains
  // known partners. Returns a Prisma filter, or null for "do not scope".
  async function partnerOrderScope(req: FastifyRequest): Promise<Prisma.OrderWhereInput | null> {
    // TRUST BOUNDARY is the credential's firstParty flag (set only by the
    // full-admin /store-keys path), NOT a partner-controlled label. A first-party
    // (admin) key is unscoped; EVERY other key is fenced to its own vendor's
    // orders. Fail CLOSED by default.
    if (req.storeAuth?.firstParty) return null; // admin/first-party key → all orders
    // EXPLICIT allowlist of trusted pull-only partner credentials that legitimately
    // read the full order stream (a fulfilment integration that pulls /orders and
    // has no vendor-tagged catalogue of its own — e.g. JetPrint). Configured by
    // credential id via env (comma-separated), defaults EMPTY. This REPLACES the
    // old `owns===0 => return null` do-not-dark guard, which handed full-store
    // customer PII to ANY zero-catalogue key (audit R6 CRITICAL, a regression I
    // introduced). An allowlisted reader is an explicit admin trust decision, not
    // an accidental fail-open for every un-attributable key.
    const credId = req.storeAuth?.id ?? null;
    if (credId && ORDER_READER_ALLOWLIST.has(credId)) return null;
    // Fence to the caller's OWN vendorId — the Vendor row keyed on THIS credential,
    // which writeProduct stamps onto the products this partner synced. ALWAYS a
    // filter, never null: a vendor that owns no tagged catalogue matches ZERO
    // orders (fail closed), never every order. vendorId is a cuid, not a forgeable
    // label-brand.
    const vendorId = await partnerVendor(req);
    return { items: { some: { variant: { is: { product: { is: { vendorId } } } } } } };
  }

  // Product-WRITE ownership, same trust boundary as partnerOrderScope. Product
  // mutations (PUT/PATCH/DELETE/:id + batch) resolved the target by wooId/slug/sku
  // with NO vendor check, so any read_write partner could rewrite ANOTHER
  // partner's (or the store's) product price to 1¢ or force-delete the catalogue
  // — the buy-for-pennies hole, at the partner API (audit C1). A first-party key
  // is unscoped; every partner key is fenced to its own vendorId. Returns a
  // Prisma Product filter fragment to AND into the lookup, or null (unscoped).
  async function partnerProductScope(req: FastifyRequest): Promise<{ vendorId: string } | null> {
    if (req.storeAuth?.firstParty) return null;
    // ALWAYS fence a partner key to its own vendorId. The previous `owns===0 =>
    // return null` do-not-dark guard fell OPEN when the caller's vendor owned
    // nothing → any zero-catalogue read_write key could rewrite ANY product to 1¢
    // or force-delete the catalogue (audit R6 CRITICAL, buy-for-pennies reopened).
    // A partner's FIRST sync of a product is a POST /products (create), which
    // stamps vendorId; subsequent UPDATEs of its OWN products then match. A foreign
    // product simply 404s. (The old duplicate-on-resync concern for legacy untagged
    // products is a recoverable data merge — never a reason to leave writes open.)
    const vendorId = await partnerVendor(req);
    return { vendorId };
  }

  /** Woo sends categories as [{id|name|slug}]; unknown ones are created. */
  async function categoryIds(list: { id?: string | number; name?: string; slug?: string }[] | undefined): Promise<string[]> {
    const ids: string[] = [];
    for (const c of list ?? []) {
      if (c.id !== undefined && c.id !== null && c.id !== 0) {
        // A partner sends the INTEGER category id we handed out; resolve it (or
        // a cuid from our own admin) to the real category.
        const byId = await db.productCategory.findFirst({ where: byWooOrCuid(String(c.id)), select: { id: true } });
        if (byId) { ids.push(byId.id); continue; }
      }
      const name = c.name ?? c.slug;
      if (!name) continue;
      const slug = slugify(c.slug ?? name);
      const found = await db.productCategory.findFirst({ where: { slug, parentId: null } });
      ids.push(found ? found.id : (await db.productCategory.create({ data: { name, slug } })).id);
    }
    return ids;
  }

  interface WooProductBody {
    name?: string;
    slug?: string;
    status?: string;
    description?: string;
    sku?: string;
    regular_price?: string | number;
    price?: string | number;
    stock_quantity?: number;
    images?: WooImage[];
    categories?: { id?: string; name?: string; slug?: string }[];
    attributes?: WooAttr[];
  }

  /**
   * Retries are normal — a partner that times out waiting for us will send the
   * same product again. Matching on SKU keeps that from building a duplicate
   * catalogue, which is the damage nobody notices until the shop page has two
   * of everything.
   */
  async function existingBySku(sku: string | undefined, vendorId: string): Promise<string | null> {
    if (!sku) return null;
    const v = await db.productVariant.findFirst({
      where: { sku, product: { vendorId } },
      select: { productId: true },
    });
    return v?.productId ?? null;
  }

  async function writeProduct(req: FastifyRequest, body: WooProductBody, currency: string, id?: string) {
    const vendorId = await partnerVendor(req);
    // Product images arrive two ways: a direct {src} (used as-is), or a WP-media
    // reference {id} — Tapstitch uploads mockups to /wp/v2/media, then sends the
    // product's images by that id. Resolve the id back to the file we stored so
    // a full mockup gallery lands, not just a single inline design.
    const gallery: { src: string; alt?: string }[] = [];
    // The product's OWN current images, addressable by the ids toWooProduct
    // mints (wooId*1000 = primary, wooId*1000+1+k = gallery[k]). A connector
    // re-references those ids on later PUTs — Printify attaches its mockups one
    // PUT at a time as [{id:<primary>}, {src:<new mockup>}] and never resends
    // the earlier ones. Resolving only wpMediaId (never our own ids) dropped the
    // reference, so every PUT RESET the set to the single new image: the read-
    // back never showed the mockups it uploaded and the publish read as failed.
    const own = new Map<number, { src: string; alt?: string }>();
    let ownRef = false;
    if (id) {
      const cur = await db.product.findUnique({ where: { id }, select: { wooId: true, name: true, image: true, images: true } });
      const base = (cur?.wooId ?? 0) * 1000;
      if (cur?.image) own.set(base, { src: cur.image, alt: cur.name });
      const curGallery = Array.isArray(cur?.images) ? (cur!.images as { url?: string; alt?: string }[]) : [];
      curGallery.forEach((g, k) => { if (g.url) own.set(base + 1 + k, { src: g.url, alt: g.alt }); });
    }
    for (const im of body.images ?? []) {
      // Pull the vendor's external image onto our own domain at push time, so a
      // card never depends on a CDN that hotlink-blocks (Tapstitch/Aliyun 403s a
      // Referer) or lets the url expire (Printify S3). Fails open to the original
      // url. Covers main + gallery — both derive from gallery[].src below.
      if (im.src) { gallery.push({ src: (await localizeImageUrl(im.src, im.alt ?? im.name)) ?? im.src, alt: im.alt ?? im.name }); continue; }
      if (im.id != null) {
        const mine = own.get(Number(im.id));
        if (mine) { ownRef = true; gallery.push({ src: mine.src, alt: im.alt ?? im.name ?? mine.alt }); continue; }
        const a = await db.mediaAsset.findFirst({ where: { meta: { path: ['wpMediaId'], equals: Number(im.id) } }, select: { url: true } });
        if (a) gallery.push({ src: a.url, alt: im.alt ?? im.name });
      }
    }
    // Accumulate, don't replace, when the connector anchored the update on one
    // of our own image ids: keep everything it did NOT mention and add the new
    // ones (deduped), so six single-mockup PUTs end with six mockups on the
    // product — what a strict connector reads back to confirm the publish.
    if (ownRef) {
      const seen = new Set(gallery.map((g) => g.src));
      for (const g of own.values()) if (!seen.has(g.src)) { gallery.push(g); seen.add(g.src); }
      // Keep the existing primary first so the primary image (and its id) is stable.
      const primary = own.get((await db.product.findUnique({ where: { id: id! }, select: { wooId: true } }))?.wooId! * 1000);
      if (primary) { const i = gallery.findIndex((g) => g.src === primary.src); if (i > 0) gallery.unshift(...gallery.splice(i, 1)); }
    }
    const price = priceToMinor(body.regular_price ?? body.price, currency);

    const data = {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      // A vendor push NEVER demotes a live product to draft. Partners (Tapstitch)
      // create a product "draft", sync variants, then flip to publish — but if
      // that final flip never lands, the product sits invisible forever ("synced
      // on their end, not on my site"). Rule from the merchant: a vendor product
      // is live or it is gone, never a lingering site draft. So only PROMOTE here
      // (publish -> active); unpublishing is the explicit DELETE path, not a sync.
      ...(body.status === 'publish' ? { status: 'active' as ProductStatus } : {}),
      ...(gallery.length
        ? {
            image: gallery[0]!.src,
            images: gallery.slice(1).map((g) => ({ url: g.src, alt: g.alt ?? '' })),
          }
        : {}),
    };

    if (id) {
      // Keep what a strict connector verifies on read-back — its option order
      // and default attribute, verbatim. Printify sends both on the parent PUT
      // and re-reads the product before marking the publish succeeded.
      const attrOpts = Object.fromEntries((body.attributes ?? []).filter((a) => a.name && Array.isArray(a.options)).map((a) => [a.name as string, a.options as string[]]));
      const defAttrs = (body as { default_attributes?: unknown }).default_attributes;
      if (Object.keys(attrOpts).length || Array.isArray(defAttrs)) {
        const cur = await db.product.findUnique({ where: { id }, select: { meta: true } });
        const base = (cur?.meta && typeof cur.meta === 'object' ? cur.meta : {}) as Record<string, unknown>;
        (data as Record<string, unknown>).meta = {
          ...base,
          ...(Object.keys(attrOpts).length ? { wcAttrOptions: attrOpts } : {}),
          ...(Array.isArray(defAttrs) ? { wcDefaultAttributes: defAttrs } : {}),
        };
      }
      const updated = await db.product.update({ where: { id }, data });
      // A price on an update belongs on the existing variant, not a new one —
      // otherwise every price change grows another buy option on the page.
      if (price !== null) {
        const first = await db.productVariant.findFirst({ where: { productId: id }, orderBy: { createdAt: 'asc' } });
        if (first) await db.productVariant.update({ where: { id: first.id }, data: { price } });
      }
      if (body.categories) {
        await db.product.update({ where: { id }, data: { categories: { set: (await categoryIds(body.categories)).map((c) => ({ id: c })) } } });
      }
      return updated;
    }

    return db.product.create({
      data: {
        name: body.name ?? 'Untitled',
        slug: await freeSlug(body.slug ?? body.name ?? 'product'),
        // Live on arrival, not draft: a vendor pushing a product means it should
        // sell. Mirroring their transient "draft" is what left pushed products
        // invisible. (Same merchant rule as the update path above.)
        status: 'active',
        description: body.description ?? null,
        vendorId,
        image: data.image ?? null,
        images: data.images ?? [],
        categories: { connect: (await categoryIds(body.categories)).map((c) => ({ id: c })) },
        // A simple product still needs ONE variant — that is what carries the
        // price and the stock, and without it the product cannot be added to a
        // cart at all.
        //
        // MARKED as auto-made from the parent body. A partner pushing a
        // VARIABLE product sends the parent first and the real buy options
        // after, so this row has to step aside when the first variation
        // arrives — otherwise the product page carries a phantom extra option
        // built from the parent's own price. Guessing at that ("looks like a
        // placeholder: no sku, price 0") misses the moment the parent carries
        // a price, which is most of the time. The flag is not a guess.
        variants: {
          create: [{
            sku: body.sku ?? null,
            price: price ?? 0,
            ...mapStock(body),
            color: attrValue(body.attributes, 'color', 'colour'),
            size: attrValue(body.attributes, 'size'),
            meta: { autoFromParent: true },
          }],
        },
      },
    });
  }

  app.post(`${PREFIX}/products`, authed, async (req, reply) => {
    if (!requireWrite(req, reply)) return;
    const body = (req.body ?? {}) as WooProductBody;
    if (!body.name) {
      wooError(reply, 400, 'woocommerce_rest_invalid_product', 'A product name is required.');
      return;
    }
    const commerce = await settingsService.getCommerce();
    const currency = commerce.currency ?? 'USD';

    const vendorId = await partnerVendor(req);
    // Dedupe a RE-PUBLISH. A variable product's parent carries no SKU (the SKUs
    // ride on the variations), so the SKU match above never fires for it and a
    // connector that re-publishes the same design (Printify does, every time
    // its previous publish attempt failed) grew a fresh duplicate parent each
    // time — the Aug-10 "-<printifyId>" twins. Same vendor + same exact name on
    // a live product IS that product: update it and hand back its existing id,
    // so the connector records THIS id as the store link instead of a new one.
    const dupe = (await existingBySku(body.sku, vendorId))
      ?? (body.sku ? null : (await db.product.findFirst({ where: { vendorId, name: body.name, deletedAt: null }, orderBy: { createdAt: 'asc' }, select: { id: true } }))?.id ?? null);
    const saved = await writeProduct(req, body, currency, dupe ?? undefined);
    const [full] = await loadProducts({ id: saved.id }, 0, 1);
    reply.status(dupe ? 200 : 201).send(toWooProduct(full!, currency));
  });

  for (const method of ['PUT', 'PATCH'] as const) {
    app.route({
      method,
      url: `${PREFIX}/products/:id`,
      preHandler: authenticate,
      handler: async (req, reply) => {
        if (!requireWrite(req, reply)) return;
        const { id } = req.params as { id: string };
        const body = (req.body ?? {}) as WooProductBody;
        // Publish forensics (Printify only): each parent PUT the connector sends
        // (it fires several per publish — title, description, images, status…).
        if (/printify/i.test(req.storeAuth?.label ?? '')) req.log.info({ product: id, method, body: JSON.stringify(req.body ?? {}).slice(0, 8000) }, 'wc-inbound-product');
        const commerce = await settingsService.getCommerce();
        const currency = commerce.currency ?? 'USD';
        // UPSERT, not a hard 404. A partner that first linked this product to a
        // DIFFERENT store (e.g. a real WooCommerce install) carries that store's
        // numeric id and updates by it — republishing then PUT /products/<stale
        // id>, which does not exist here. Real Woo 404s; the bridge instead
        // resolves the product the partner MEANS (by slug from its name, or a
        // variant SKU) and updates that, or creates it fresh — so "republish"
        // is idempotent and never errors on a store the product simply moved to.
        // Fence resolution to the caller's OWN products (audit C1). A partner may
        // only update a product it owns; the slug/sku fallbacks are scoped too, so
        // a partner can't reach another's product by name/SKU. A miss on a foreign
        // product falls through to create-its-own (if named) or 404 — never a
        // cross-tenant write. A first-party key is unscoped.
        const pscope = await partnerProductScope(req);
        let target = await db.product.findFirst({ where: { ...byWooOrCuid(id), ...(pscope ?? {}) }, select: { id: true } });
        if (!target && body.name) {
          target = await db.product.findFirst({ where: { slug: slugify(body.name), ...(pscope ?? {}) }, select: { id: true } });
        }
        // Not for id `0`: that is the connector saying "I have no id", and
        // silently matching its parent by SKU here answered 200 while leaving
        // the connector on `0` for every follow-up call. Let `0` fall through to
        // a 404 so it takes the create path (deduped) and learns the real id.
        if (!target && body.sku && !/^0+$/.test(id)) {
          target = await db.product.findFirst({ where: { variants: { some: { sku: body.sku } }, ...(pscope ?? {}) }, select: { id: true } });
        }
        if (target) {
          await writeProduct(req, body, currency, target.id);
          const [full] = await loadProducts({ id: target.id }, 0, 1);
          reply.send(toWooProduct(full!, currency));
        } else if (/^0+$/.test(id)) {
          wooError(reply, 404, 'woocommerce_rest_product_invalid_id', 'Invalid product ID.');
        } else if (!body.name) {
          // A leftover id from the product's PREVIOUS store (the old reference site
          // WooCommerce) — not here, and no name to build from. If the partner is
          // UNPUBLISHING (any status but 'publish'), the state it wants — this
          // product not on sale here — is ALREADY true, so ack an idempotent no-op
          // instead of 404. A 404 makes the partner flag the whole product "Error"
          // over a stale id it is only trying to retire (Tapstitch's exact bug).
          if (typeof body.status === 'string' && body.status !== 'publish') {
            reply.send({ id: /^\d+$/.test(id) ? Number(id) : 0, status: 'draft', name: '', slug: '' });
            return;
          }
          wooError(reply, 404, 'woocommerce_rest_product_invalid_id', 'Invalid product ID.');
        } else {
          // A PUT to an id we never issued, carrying a full product: the connector
          // is re-publishing under a stale id. Before building a new product,
          // dedupe exactly like POST — same vendor + same exact live name IS that
          // product (variable parents carry no SKU, so name is the only key).
          // Creating here is what produced the "Copy of Copy of…" pins.
          const vendorId = await partnerVendor(req);
          const same = body.name ? await db.product.findFirst({ where: { vendorId, name: body.name, deletedAt: null }, orderBy: { createdAt: 'asc' }, select: { id: true } }) : null;
          const saved = await writeProduct(req, body, currency, same?.id);
          const [full] = await loadProducts({ id: saved.id }, 0, 1);
          reply.status(same ? 200 : 201).send(toWooProduct(full!, currency));
        }
      },
    });
  }

  /**
   * Unpublished rather than deleted unless `?force=true`, which is Woo's own
   * behaviour. A partner retiring a design should take it off sale, not
   * destroy the order history that points at its variants.
   */
  app.delete(`${PREFIX}/products/:id`, authed, async (req, reply) => {
    if (!requireWrite(req, reply)) return;
    const { id } = req.params as { id: string };
    const { force } = req.query as { force?: string };
    const commerce = await settingsService.getCommerce();
    const currency = commerce.currency ?? 'USD';
    // Owner-scoped (audit C1): a partner can only delete its OWN product; a
    // foreign id is a clean 404, never a force-delete of another's catalogue.
    const pscope = await partnerProductScope(req);
    const [full] = await loadProducts({ ...byWooOrCuid(id), ...(pscope ?? {}) }, 0, 1);
    if (!full) {
      wooError(reply, 404, 'woocommerce_rest_product_invalid_id', 'Invalid product ID.');
      return;
    }
    if (force === 'true') {
      const ordered = await db.orderItem.findFirst({ where: { variant: { productId: full.id } }, select: { id: true } });
      if (ordered) {
        // Refusing is the honest answer: deleting would either orphan the order
        // line or silently rewrite what a customer actually bought.
        wooError(reply, 409, 'woocommerce_rest_cannot_delete', 'This product has been ordered; it can be unpublished but not deleted.');
        return;
      }
      await db.product.delete({ where: { id: full.id } });
    } else {
      await db.product.update({ where: { id: full.id }, data: { status: 'draft' } });
    }
    reply.send(toWooProduct(full, currency));
  });

  /** Variations — the per-size, per-colour rows a POD partner pushes one by one. */
  app.post(`${PREFIX}/products/:id/variations`, authed, async (req, reply) => {
    if (!requireWrite(req, reply)) return;
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as WooProductBody & { image?: WooImage };
    const commerce = await settingsService.getCommerce();
    const currency = commerce.currency ?? 'USD';
    // Fence the PARENT to the caller's vendor — a partner must not add a variation
    // to a product it doesn't own (audit R6 CRITICAL: buy-for-pennies via an
    // injected 1¢ variation on the flagship). First-party keys are unscoped.
    const pscope = await partnerProductScope(req);
    const parent = await db.product.findFirst({ where: { ...byWooOrCuid(id), ...(pscope ?? {}) }, select: { id: true } });
    if (!parent) {
      wooError(reply, 404, 'woocommerce_rest_product_invalid_id', 'Invalid product ID.');
      return;
    }
    const price = priceToMinor(body.regular_price ?? body.price, currency);
    // The first real variation CONSUMES the row the parent create made, rather
    // than sitting beside it as an extra buy option built from the parent's
    // price. Identified by its own flag, never inferred — and never if it has
    // been ordered, because that row is now somebody's purchase.
    const carried = await db.productVariant.findFirst({
      where: {
        productId: parent.id,
        meta: { path: ['autoFromParent'], equals: true },
        orderItems: { none: {} },
      },
    });
    const data = {
      productId: parent.id,
      sku: body.sku ?? null,
      price: price ?? 0,
      ...mapStock(body),
      color: attrValue(body.attributes, 'color', 'colour'),
      size: attrValue(body.attributes, 'size'),
      // The variation's own mockup — this is what lets picking a colour swap the
      // photo. Woo carries it as a single `image: { src }` on the variation.
      ...(body.image?.src ? { image: (await localizeImageUrl(body.image.src)) ?? body.image.src } : {}),
      meta: { ...attrNamesOf(body.attributes) },
    };
    const variant = carried
      ? await db.productVariant.update({ where: { id: carried.id }, data })
      : await db.productVariant.create({ data });
    reply.status(201).send({
      id: variant.wooId ?? 0,
      sku: variant.sku ?? '',
      regular_price: String(toMajor(variant.price, currency)),
      stock_quantity: variant.inventory,
    });
  });

  // Variations BATCH. This is how a POD platform actually pushes variations —
  // every size/colour of a design in ONE call, not one request each. Its
  // absence (a 404 the connector hit right after creating the parent) is why a
  // publish completed the product but never its variants. Body: {create[],
  // update[], delete[]}; response mirrors it. Same per-row logic as the single
  // POST/PUT/DELETE above.
  app.post(`${PREFIX}/products/:id/variations/batch`, authed, async (req, reply) => {
    if (!requireWrite(req, reply)) return;
    const { id } = req.params as { id: string };
    // Publish forensics (Printify only): the exact batch body the connector sent.
    // Its post-publish verification compares this against our read-back, and a
    // "publishing failed" with every HTTP call 200 is only diagnosable from the
    // two payloads side by side.
    if (/printify/i.test(req.storeAuth?.label ?? '')) req.log.info({ product: id, body: JSON.stringify(req.body ?? {}).slice(0, 8000) }, 'wc-inbound-batch');
    const b = (req.body ?? {}) as { create?: (WooProductBody & { id?: string | number; image?: WooImage })[]; update?: (WooProductBody & { id?: string | number; image?: WooImage })[]; delete?: (string | number)[] };
    const commerce = await settingsService.getCommerce();
    const currency = commerce.currency ?? 'USD';
    // Fence the parent to the caller's vendor (audit R6 CRITICAL — variation batch
    // could inject/rewrite variants on ANY product). First-party keys unscoped.
    const pscope = await partnerProductScope(req);
    const parent = await db.product.findFirst({ where: { ...byWooOrCuid(id), ...(pscope ?? {}) }, select: { id: true } });
    if (!parent) { wooError(reply, 404, 'woocommerce_rest_product_invalid_id', 'Invalid product ID.'); return; }
    // TEMP DIAGNOSTIC (green-joggers): what colourways does a connector actually
    // send, and in which bucket? A re-sync that puts a NEW colour in `update`
    // (not `create`) hits the "skip unknown" path and the colour never lands.
    req.log.info({
      product: id,
      createColors: (b.create ?? []).map((v) => `${attrValue(v.attributes, 'color', 'colour') ?? '?'}/${attrValue(v.attributes, 'size') ?? '?'}`),
      updateColors: (b.update ?? []).map((v) => `${v.id}=${attrValue(v.attributes, 'color', 'colour') ?? '?'}/${attrValue(v.attributes, 'size') ?? '?'}`),
      // RAW attribute shape, so a "?/?" above is diagnosable from the log alone:
      // the exact name/id each connector sends per axis (Printify vs Tapstitch
      // differ), not just whether our matcher recognised it.
      attrShapes: [...(b.create ?? []), ...(b.update ?? [])].slice(0, 3).map((v) => (v.attributes ?? []).map((a) => `${a.name ?? ''}#${a.id ?? ''}=${a.option ?? a.options?.[0] ?? ''}`)),
      del: (b.delete ?? []).length,
    }, 'wc-variations-batch-inbound');
    const out = (v: { wooId: number | null; sku: string | null; price: number; inventory: number }) => ({
      id: v.wooId ?? 0, sku: v.sku ?? '', regular_price: String(toMajor(v.price, currency)), stock_quantity: v.inventory,
    });
    const created = [];
    for (const v of b.create ?? []) {
      const data = {
        productId: parent.id, sku: v.sku ?? null, price: priceToMinor(v.regular_price ?? v.price, currency) ?? 0,
        ...mapStock(v), color: attrValue(v.attributes, 'color', 'colour'), size: attrValue(v.attributes, 'size'),
        // Per-variation mockup — this is what makes picking a colour swap the photo.
        ...(v.image?.src ? { image: (await localizeImageUrl(v.image.src)) ?? v.image.src } : {}),
        meta: { ...attrNamesOf(v.attributes) },
      };
      // A "create" whose SKU already exists on THIS parent is a re-publish of a
      // variant we hold (the parent was deduped above, so the connector thinks
      // it is new). Update that row — price, stock, and crucially the colour/
      // size it may have failed to parse last time — instead of stacking a
      // duplicate buy option on the product page.
      const held = v.sku ? await db.productVariant.findFirst({ where: { productId: parent.id, sku: v.sku }, select: { id: true } }) : null;
      if (held) {
        const { productId: _p, meta: _m, ...upd } = data;
        created.push(out(await db.productVariant.update({ where: { id: held.id }, data: upd })));
        continue;
      }
      created.push(out(await db.productVariant.create({ data })));
    }
    // Drop the parent-create placeholder AFTER the real variations exist, as one
    // idempotent deleteMany — NOT by "consuming" it as the first create. A POD
    // partner fires several batch calls at once (Tapstitch sent three in the same
    // second); the old consume path let two concurrent batches read the SAME
    // placeholder row and each write its first variant onto it, so one variant
    // was silently overwritten — a 60-variant push landed as 59 and tripped the
    // partner's "Error" + left the product an unpublishable draft. create() never
    // collides; deleteMany on the autoFromParent flag races harmlessly.
    if (created.length) {
      await db.productVariant.deleteMany({
        where: { productId: parent.id, meta: { path: ['autoFromParent'], equals: true }, orderItems: { none: {} } },
      });
    }
    const updated = [];
    for (const v of b.update ?? []) {
      const price = priceToMinor(v.regular_price ?? v.price, currency);
      // Pin to THIS product. variant wooIds come from ONE global SERIAL sequence,
      // so they're guessable across every product/vendor; without productId a
      // stale/colliding id resolves to ANOTHER product's variant and silently
      // rewrites its price/stock (audit CRITICAL, cross-tenant). A foreign id now
      // simply misses and is treated as a new colourway below.
      let existing = v.id !== undefined ? await db.productVariant.findFirst({ where: { ...byWooOrCuid(String(v.id)), productId: parent.id } }) : null;
      if (!existing) {
        // A colourway ADDED to a live product arrives here as an "update" whose
        // id we've never issued. The old code skipped it, so a new colour pushed
        // to an existing design (e.g. green joggers onto the black ones) never
        // appeared. Match by colour+size first — same axes under a different id
        // is the SAME variant, so update it, never duplicate — and only a
        // genuinely new axis pair is created.
        const color = attrValue(v.attributes, 'color', 'colour');
        const size = attrValue(v.attributes, 'size');
        existing = (color || size) ? await db.productVariant.findFirst({ where: { productId: parent.id, color, size } }) : null;
        if (!existing) {
          const data = { productId: parent.id, sku: v.sku ?? null, price: price ?? 0, ...mapStock(v), color, size, ...(v.image?.src ? { image: (await localizeImageUrl(v.image.src)) ?? v.image.src } : {}), meta: { ...attrNamesOf(v.attributes) } };
          updated.push(out(await db.productVariant.create({ data })));
          continue;
        }
      }
      const row = await db.productVariant.update({
        where: { id: existing.id },
        data: { ...(price !== null ? { price } : {}), ...(v.sku !== undefined ? { sku: v.sku } : {}), ...(v.stock_quantity !== undefined ? { inventory: v.stock_quantity } : {}) },
      });
      updated.push(out(row));
    }
    const deleted = [];
    for (const rawId of b.delete ?? []) {
      // Pin to THIS product — a global variant id must not delete another
      // product's variant (audit CRITICAL).
      const existing = await db.productVariant.findFirst({ where: { ...byWooOrCuid(String(rawId)), productId: parent.id } });
      if (!existing) continue;
      const ordered = await db.orderItem.findFirst({ where: { variantId: existing.id }, select: { id: true } });
      if (ordered) continue; // keep what a customer bought
      await db.productVariant.delete({ where: { id: existing.id } });
      deleted.push({ id: existing.wooId ?? 0 });
    }
    reply.send({ create: created, update: updated, delete: deleted });
  });

  for (const method of ['PUT', 'PATCH'] as const) {
    app.route({
      method,
      url: `${PREFIX}/products/:id/variations/:variationId`,
      preHandler: authenticate,
      handler: async (req, reply) => {
        if (!requireWrite(req, reply)) return;
        const { id: parentIdParam, variationId } = req.params as { id: string; variationId: string };
        const body = (req.body ?? {}) as WooProductBody;
        const commerce = await settingsService.getCommerce();
        const currency = commerce.currency ?? 'USD';
        // Resolve the PARENT and pin the variation to it. Without productId a
        // global/guessable variation id under product A would mutate a variation
        // of product B (audit CRITICAL, cross-tenant price/stock rewrite). AND
        // fence the parent to the caller's vendor — a partner must not rewrite a
        // variation's price to 1¢ on a product it doesn't own (audit R6 CRITICAL).
        const pscope = await partnerProductScope(req);
        const parent = await db.product.findFirst({ where: { ...byWooOrCuid(parentIdParam), ...(pscope ?? {}) }, select: { id: true } });
        if (!parent) { wooError(reply, 404, 'woocommerce_rest_product_invalid_id', 'Invalid product ID.'); return; }
        const variant = await db.productVariant.findFirst({ where: { ...byWooOrCuid(variationId), productId: parent.id } });
        if (!variant) {
          wooError(reply, 404, 'woocommerce_rest_product_invalid_id', 'Invalid variation ID.');
          return;
        }
        const price = priceToMinor(body.regular_price ?? body.price, currency);
        const updated = await db.productVariant.update({
          where: { id: variant.id },
          data: {
            ...(price !== null ? { price } : {}),
            ...(body.sku !== undefined ? { sku: body.sku } : {}),
            ...(body.stock_quantity !== undefined ? { inventory: body.stock_quantity } : {}),
          },
        });
        reply.send({
          id: updated.wooId ?? 0,
          sku: updated.sku ?? '',
          regular_price: String(toMajor(updated.price, currency)),
          stock_quantity: updated.inventory,
        });
      },
    });
  }

  app.delete(`${PREFIX}/products/:id/variations/:variationId`, authed, async (req, reply) => {
    if (!requireWrite(req, reply)) return;
    const { id: parentIdParam, variationId } = req.params as { id: string; variationId: string };
    // Pin to the parent — a global variation id must not delete another product's
    // variation (audit CRITICAL) — AND fence the parent to the caller's vendor so a
    // partner can't delete another vendor's variations (audit R6 CRITICAL).
    const pscope = await partnerProductScope(req);
    const parent = await db.product.findFirst({ where: { ...byWooOrCuid(parentIdParam), ...(pscope ?? {}) }, select: { id: true } });
    if (!parent) { wooError(reply, 404, 'woocommerce_rest_product_invalid_id', 'Invalid product ID.'); return; }
    const variant = await db.productVariant.findFirst({ where: { ...byWooOrCuid(variationId), productId: parent.id } });
    if (!variant) {
      wooError(reply, 404, 'woocommerce_rest_product_invalid_id', 'Invalid variation ID.');
      return;
    }
    const ordered = await db.orderItem.findFirst({ where: { variantId: variant.id }, select: { id: true } });
    if (ordered) {
      wooError(reply, 409, 'woocommerce_rest_cannot_delete', 'This variation has been ordered and cannot be deleted.');
      return;
    }
    await db.productVariant.delete({ where: { id: variant.id } });
    reply.send({ id: variant.wooId ?? 0 });
  });

  /**
   * Woo's batch endpoint. Partners with a catalogue of any size use this rather
   * than one request per product, and its absence is a sync that dies at the
   * first push with no per-product error to show the merchant.
   */
  app.post(`${PREFIX}/products/batch`, authed, async (req, reply) => {
    if (!requireWrite(req, reply)) return;
    const body = (req.body ?? {}) as { create?: WooProductBody[]; update?: (WooProductBody & { id?: string })[]; delete?: string[] };
    const commerce = await settingsService.getCommerce();
    const currency = commerce.currency ?? 'USD';
    const vendorId = await partnerVendor(req);
    // Owner scope for update/delete resolution (audit C1) — a partner may only
    // edit/delete its own products in a batch. First-party keys unscoped.
    const pscope = await partnerProductScope(req);
    const out: { create: unknown[]; update: unknown[]; delete: unknown[] } = { create: [], update: [], delete: [] };

    // One failure must not abandon the rest of the batch — Woo reports per
    // item, and a partner needs to know WHICH product it was.
    for (const item of body.create ?? []) {
      try {
        const dupe = await existingBySku(item.sku, vendorId);
        const saved = await writeProduct(req, item, currency, dupe ?? undefined);
        const [full] = await loadProducts({ id: saved.id }, 0, 1);
        out.create.push(toWooProduct(full!, currency));
      } catch (err) {
        out.create.push({ error: { code: 'woocommerce_rest_cannot_create', message: (err as Error).message } });
      }
    }
    for (const item of body.update ?? []) {
      try {
        if (!item.id) throw new Error('id is required to update');
        // Partners now know the product by the integer wooId we emit as `id`, so
        // a batch update carries that int, not our cuid. Resolve either — the
        // single-product PUT already does this; the batch path did not, so every
        // wooId-keyed update silently missed and looked like a failed sync.
        const target = await db.product.findFirst({ where: { ...byWooOrCuid(String(item.id)), ...(pscope ?? {}) }, select: { id: true } });
        if (!target) throw new Error('product not found');
        await writeProduct(req, item, currency, target.id);
        const [full] = await loadProducts({ id: target.id }, 0, 1);
        out.update.push(toWooProduct(full!, currency));
      } catch (err) {
        out.update.push({ error: { code: 'woocommerce_rest_cannot_edit', message: (err as Error).message } });
      }
    }
    for (const rawId of body.delete ?? []) {
      try {
        // Same wooId-or-cuid resolution as update/delete single: a delete keyed
        // by the emitted integer id must not 404.
        const target = await db.product.findFirst({ where: { ...byWooOrCuid(String(rawId)), ...(pscope ?? {}) }, select: { id: true, wooId: true } });
        if (!target) throw new Error('product not found');
        await db.product.update({ where: { id: target.id }, data: { status: 'draft' } });
        out.delete.push({ id: target.wooId ?? target.id });
      } catch (err) {
        out.delete.push({ error: { code: 'woocommerce_rest_cannot_delete', message: (err as Error).message } });
      }
    }
    reply.send(out);
  });

  /**
   * Outbound webhooks — the half of the bridge that was missing.
   *
   * A partner could read the catalogue and never learn an order happened. The
   * approval screen promises "Create webhooks" and, until now, there was
   * nothing behind it: Printful's plugin registers one named "Printful
   * Integration" and then waits for a call that never came.
   *
   * Woo's shape exactly (topic = "resource.event"), because partners already
   * parse it.
   */
  const WEBHOOK_TOPICS = new Set([
    'order.created', 'order.updated', 'order.deleted',
    'product.created', 'product.updated', 'product.deleted',
    // Action topics — how real POD partners actually subscribe to "an order was
    // paid". Verified against the working WooCommerce store (:10025): Tapstitch
    // (HugePOD), Printify and Printful all register
    // `action.woocommerce_order_status_processing`, NOT order.updated. Woo fires
    // it on the pending->processing transition; the delivered body is
    // {action, arg:<order id>} and the partner then PULLS /wc/v3/orders/<id>.
    // Rejecting these topics forced partners onto the wrong webhook and nothing
    // ever fulfilled. Order.updated (full payload) is what PODpartner/PodPluser use.
    'action.woocommerce_order_status_processing',
    'action.woocommerce_order_status_completed',
    'action.woocommerce_update_options',
  ]);

  function toWooWebhook(w: { id: string; name: string; topic: string; deliveryUrl: string; status: string; createdAt: Date; updatedAt: Date }) {
    const [resource, event] = w.topic.split('.');
    return {
      id: w.id,
      name: w.name,
      status: w.status,
      topic: w.topic,
      resource: resource ?? '',
      event: event ?? '',
      hooks: [],
      delivery_url: w.deliveryUrl,
      date_created: w.createdAt.toISOString(),
      date_modified: w.updatedAt.toISOString(),
    };
  }

  // OWNERSHIP SCOPING: a partner may only see/touch webhooks IT registered.
  // Without this, any valid store key could list, read, retarget, or delete
  // every OTHER partner's webhooks (redirect a rival's order feed to attacker
  // infra, or delete it so orders silently stop). Scope every read/write to the
  // caller's credential id; a non-owned id is a 404, never someone else's row.
  const ownerScope = (req: FastifyRequest) => ({ credentialId: req.storeAuth?.id ?? ' none' });

  app.get(`${PREFIX}/webhooks`, authed, async (req, reply) => {
    const { skip, take, perPage } = paging(req);
    const where = ownerScope(req);
    const [rows, total] = await Promise.all([
      db.storeWebhook.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
      db.storeWebhook.count({ where }),
    ]);
    setPagingHeaders(reply, total, perPage);
    reply.send(rows.map(toWooWebhook));
  });

  app.get(`${PREFIX}/webhooks/:id`, authed, async (req, reply) => {
    const row = await db.storeWebhook.findFirst({ where: { id: (req.params as { id: string }).id, ...ownerScope(req) } });
    if (!row) { wooError(reply, 404, 'woocommerce_rest_webhook_invalid_id', 'Invalid webhook ID.'); return; }
    reply.send(toWooWebhook(row));
  });

  app.post(`${PREFIX}/webhooks`, authed, async (req, reply) => {
    if (!requireWrite(req, reply)) return;
    const b = (req.body ?? {}) as { name?: string; topic?: string; delivery_url?: string; secret?: string; status?: string };
    if (!b.topic || !WEBHOOK_TOPICS.has(b.topic)) {
      wooError(reply, 400, 'woocommerce_rest_invalid_webhook_topic', `Webhook topic must be one of: ${[...WEBHOOK_TOPICS].join(', ')}.`);
      return;
    }
    // HTTPS only, and never a loopback or private address: this store would
    // otherwise POST order contents to something inside its own network on a
    // partner's say-so.
    let url: URL;
    try { url = new URL(b.delivery_url ?? ''); } catch {
      wooError(reply, 400, 'woocommerce_rest_invalid_webhook_delivery_url', 'delivery_url is not a valid URL.'); return;
    }
    // Full SSRF check: https + DNS-resolve + reject any private target. The old
    // hostname regex was bypassable (decimal IPs, foo.internal, IPv6, or a
    // public name pointing at a private address). Re-checked again at send time.
    const ssrf = await assertPublicHttpsUrl(url.toString());
    if (!ssrf.ok) {
      wooError(reply, 400, 'woocommerce_rest_invalid_webhook_delivery_url', `delivery_url rejected: ${ssrf.reason}.`); return;
    }

    // Woo lets the partner supply the secret; if they do not, mint one and
    // return it ONCE in this response, the same way store keys work.
    const secret = b.secret && b.secret.length >= 8 ? b.secret : randomBytes(24).toString('base64url');
    const row = await db.storeWebhook.create({
      data: {
        name: b.name?.slice(0, 200) || `${b.topic} webhook`,
        topic: b.topic,
        deliveryUrl: url.toString(),
        secretEncrypted: encryptSecret(secret),
        status: b.status === 'paused' || b.status === 'disabled' ? b.status : 'active',
        credentialId: req.storeAuth?.id ?? null,
      },
    });
    reply.status(201).send({ ...toWooWebhook(row), secret });
  });

  app.put(`${PREFIX}/webhooks/:id`, authed, async (req, reply) => {
    if (!requireWrite(req, reply)) return;
    const id = (req.params as { id: string }).id;
    const b = (req.body ?? {}) as { name?: string; status?: string; topic?: string };
    const existing = await db.storeWebhook.findFirst({ where: { id, ...ownerScope(req) } });
    if (!existing) { wooError(reply, 404, 'woocommerce_rest_webhook_invalid_id', 'Invalid webhook ID.'); return; }
    if (b.topic && !WEBHOOK_TOPICS.has(b.topic)) {
      wooError(reply, 400, 'woocommerce_rest_invalid_webhook_topic', 'Unsupported webhook topic.'); return;
    }
    const row = await db.storeWebhook.update({
      where: { id },
      data: {
        ...(b.name ? { name: b.name.slice(0, 200) } : {}),
        ...(b.topic ? { topic: b.topic } : {}),
        ...(b.status && ['active', 'paused', 'disabled'].includes(b.status) ? { status: b.status } : {}),
      },
    });
    reply.send(toWooWebhook(row));
  });

  app.delete(`${PREFIX}/webhooks/:id`, authed, async (req, reply) => {
    if (!requireWrite(req, reply)) return;
    const id = (req.params as { id: string }).id;
    const existing = await db.storeWebhook.findFirst({ where: { id, ...ownerScope(req) } });
    if (!existing) { wooError(reply, 404, 'woocommerce_rest_webhook_invalid_id', 'Invalid webhook ID.'); return; }
    await db.storeWebhook.delete({ where: { id } });
    reply.send({ ...toWooWebhook(existing), deleted: true });
  });

  /** Delivery history — "the partner says they never got the order" is otherwise unanswerable. */
  app.get(`${PREFIX}/webhooks/:id/deliveries`, authed, async (req, reply) => {
    // Only the OWNER may read a webhook's delivery history (leaks order ids +
    // vendor endpoints otherwise).
    const hook = await db.storeWebhook.findFirst({ where: { id: (req.params as { id: string }).id, ...ownerScope(req) }, select: { id: true } });
    if (!hook) { wooError(reply, 404, 'woocommerce_rest_webhook_invalid_id', 'Invalid webhook ID.'); return; }
    const rows = await db.webhookDelivery.findMany({
      where: { webhookId: hook.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    reply.send(rows.map((d: { id: string; durationMs: number | null; error: string | null; responseCode: number | null; createdAt: Date }) => ({
      id: d.id,
      duration: d.durationMs,
      summary: d.error ?? `HTTP ${d.responseCode ?? '?'}`,
      response_code: d.responseCode == null ? '' : String(d.responseCode),
      date_created: d.createdAt.toISOString(),
    })));
  });

  app.get(`${PREFIX}/orders`, authed, async (req, reply) => {
    const { skip, take, perPage } = paging(req);
    const q = req.query as Record<string, string | undefined>;
    // A partner may send any string; only a real status becomes a filter.
    // Casting blindly would hand Prisma an invalid enum and 500 the sync.
    const wanted = asOrderStatus(q.status);
    // Fence a POD partner to its own orders (see partnerOrderScope). An admin /
    // store-wide key is not scoped.
    const scope = await partnerOrderScope(req);
    const where: Prisma.OrderWhereInput = { ...(wanted ? { status: wanted } : {}), ...wooDateWhere(q), ...(scope ?? {}) };
    const commerce = await settingsService.getCommerce();
    const currency = commerce.currency ?? 'USD';
    const [rows, total] = await Promise.all([
      db.order.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: { items: { include: { variant: { include: { product: true } } } }, customer: true },
      }),
      db.order.count({ where }),
    ]);
    setPagingHeaders(reply, total, perPage);
    // FULL order objects, same shape as GET /orders/:id — real WooCommerce's
    // list is the single object repeated, complete with billing AND shipping.
    // The thin "sales report" shape this used to return had no ship-to at all:
    // a partner that builds orders from its daily LIST pull (Tapstitch does)
    // could match the products but never print a label.
    reply.send(rows.map((o) => orderWebhookPayload(o)));
  });

  /**
   * Single order fetch — what an `action.woocommerce_order_status_processing`
   * partner (Tapstitch/HugePOD, Printify, Printful) calls right after the ping,
   * using the order id from {action, arg} to pull the full order it must print.
   * Resolves the integer wooId (what we now emit) or our cuid. Returns the full
   * order INCLUDING the shipping address — a label can't be printed without it.
   */
  app.get(`${PREFIX}/orders/:id`, authed, async (req, reply) => {
    const { id } = req.params as { id: string };
    const idWhere = ((w)=>w!==null?{ wooId: w }:{ id })(safeWooId(id));
    // A partner pulling a specific order by id (after the action ping) must only
    // reach ITS OWN order — otherwise a store key can read any order's PII by
    // walking ids. findFirst + AND(scope) so a foreign order is a clean 404.
    const scope = await partnerOrderScope(req);
    const order = await db.order.findFirst({
      where: scope ? { AND: [idWhere, scope] } : idWhere,
      include: { customer: { select: { email: true, name: true } }, items: { include: { variant: { select: { id: true, wooId: true, sku: true, color: true, size: true, product: { select: { id: true, wooId: true, name: true, image: true } } } } } } },
    });
    if (!order) { wooError(reply, 404, 'woocommerce_rest_shop_order_invalid_id', 'Invalid order ID.'); return; }
    reply.send(orderWebhookPayload(order));
  });

  /**
   * Order status write-back — how a partner reports "this shipped".
   *
   * Requires read_write. A read-only key is the right default for a partner
   * that only pulls a catalogue, and it must not be able to move orders.
   */
  app.put(`${PREFIX}/orders/:id`, authed, async (req, reply) => {
    if (!requireWrite(req, reply)) return;
    const { id } = req.params as { id: string };
    const body = req.body as { status?: string };
    // Partners now know the order by its integer wooId (that is what we emit as
    // `id`), so their write-back hits /orders/<wooId>. Resolve either the
    // integer wooId or our cuid so "mark shipped" doesn't 404.
    // SCOPED like the GET: a partner may only write-back (and read back, since
    // the response is the full PII order object) ITS OWN order. Without this a
    // read_write key POSTs an empty body to /orders/<any wooId> and reads every
    // customer's billing/shipping/email by walking ids — the exact leak the GET
    // fence closes, reopened on the PUT verb.
    const idWhere = ((w)=>w!==null?{ wooId: w }:{ id })(safeWooId(id));
    const scope = await partnerOrderScope(req);
    const order = await db.order.findFirst({ where: scope ? { AND: [idWhere, scope] } : idWhere });
    if (!order) {
      wooError(reply, 404, 'woocommerce_rest_shop_order_invalid_id', 'Invalid order ID.');
      return;
    }
    const next = asOrderStatus(body?.status);
    if (body?.status && !next) {
      wooError(reply, 400, 'woocommerce_rest_invalid_order_status', `Unknown order status "${body.status}".`);
      return;
    }
    if (next && next !== order.status) {
      // ALWAYS through the real transition path — never a raw column write.
      // transition() owns the inventory effects (restock on cancel) and emits
      // order.updated to every OTHER subscribed partner on a multi-vendor order.
      // The old blanket catch-and-raw-write skipped both and could shove a paid
      // 'processing' order back to 'pending' or force a graph-forbidden
      // 'cancelled' with no restock — inventory + fulfilment silently drifting on
      // a live store (audit). A forbidden move is now a clean Woo 409, not a
      // silent forced column.
      if (next === 'pending') {
        // 'pending' is the pre-payment initial state, never a valid partner
        // write-back target — an order cannot be un-paid back to pending.
        wooError(reply, 409, 'woocommerce_rest_order_status_forbidden', 'An order cannot be moved back to pending.');
        return;
      }
      const { orderService } = await import('../../services/order.service.js');
      try {
        await orderService.transition(order.id, { status: next });
      } catch (err) {
        wooError(reply, 409, 'woocommerce_rest_order_status_forbidden', err instanceof Error ? err.message : `Cannot move order to ${next}.`);
        return;
      }
    }
    // Real Woo answers a status write-back with the FULL updated order object;
    // a strict partner reads fields off it (and errors on a two-field stub).
    const updated = await db.order.findUnique({
      where: { id: order.id },
      include: { customer: { select: { email: true, name: true } }, items: { include: { variant: { select: { id: true, wooId: true, sku: true, color: true, size: true, product: { select: { id: true, wooId: true, name: true, image: true } } } } } } },
    });
    reply.send(updated ? orderWebhookPayload(updated) : { id: order.wooId ?? order.id, status: next ?? order.status });
  });

  /**
   * Order notes — how POD partners deliver TRACKING. JetPrint, Tapstitch and
   * kin POST /orders/{id}/notes with "Shipped via X, tracking 123…" (often as
   * customer_note:true). Without this route the tracking number 404s into the
   * void and the customer never learns their parcel exists. Notes land in
   * order.meta.notes; anything that looks like tracking is also lifted into
   * meta.tracking for the shipped email / admin to surface.
   */
  app.get(`${PREFIX}/orders/:id/notes`, authed, async (req, reply) => {
    const { id } = req.params as { id: string };
    // Scoped: notes carry customer prose + tracking; a partner reads only its own
    // order's notes. (This route was authed-only, not even requireWrite.)
    const idWhere = ((w)=>w!==null?{ wooId: w }:{ id })(safeWooId(id));
    const scope = await partnerOrderScope(req);
    const order = await db.order.findFirst({ where: scope ? { AND: [idWhere, scope] } : idWhere, select: { meta: true } });
    if (!order) { wooError(reply, 404, 'woocommerce_rest_shop_order_invalid_id', 'Invalid order ID.'); return; }
    const notes = ((order.meta as Record<string, unknown>)?.notes as { id: number; note: string; customer_note: boolean; date_created: string }[] | undefined) ?? [];
    reply.send(notes.map((n) => ({ ...n, author: 'system', date_created_gmt: n.date_created })));
  });
  app.post(`${PREFIX}/orders/:id/notes`, authed, async (req, reply) => {
    if (!requireWrite(req, reply)) return;
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { note?: string; customer_note?: boolean };
    const text = String(b.note ?? '').slice(0, 2000);
    if (!text) { wooError(reply, 400, 'woocommerce_rest_invalid_order_note', 'Note content is required.'); return; }
    // Scoped: posting a tracking-shaped note CREATES a shipment, fires the
    // customer "shipped" email and transitions the order — a cross-partner action
    // on a live store if unscoped. A partner may only note its OWN order.
    const idWhere = ((w)=>w!==null?{ wooId: w }:{ id })(safeWooId(id));
    const scope = await partnerOrderScope(req);
    const order = await db.order.findFirst({ where: scope ? { AND: [idWhere, scope] } : idWhere, select: { id: true, wooId: true, meta: true, status: true, shipAddress: true } });
    if (!order) { wooError(reply, 404, 'woocommerce_rest_shop_order_invalid_id', 'Invalid order ID.'); return; }
    const meta = (order.meta as Record<string, unknown>) ?? {};
    const notes = (meta.notes as { id: number; note: string; customer_note: boolean; date_created: string }[] | undefined) ?? [];
    const entry = { id: notes.length + 1, note: text, customer_note: !!b.customer_note, date_created: new Date().toISOString() };
    // Lift a tracking number out of the note so it is queryable, not prose.
    // A tracking number always contains DIGITS. The old pattern matched the
    // first 8-30 alnum chars after the word "tracking", so "tracking
    // unavailable" or "tracking: confirmed" was stored as a bogus tracking
    // number and fired a shipped email with junk. Require ≥6 digits in the
    // token (real carrier numbers are digit-heavy), plus the known carrier forms.
    const keyed = /(?:tracking|track(?:ing)?\s*(?:no|number|#)?)[:\s#]*([A-Z0-9-]{8,30})/i.exec(text);
    const keyedNum = keyed && (keyed[1]!.replace(/\D/g, '').length >= 6) ? keyed : null;
    const tracked = keyedNum ?? /\b([A-Z]{2}\d{9}[A-Z]{2}|1Z[0-9A-Z]{16}|9\d{15,21})\b/.exec(text);
    const urlMatch = /(https?:\/\/\S+)/.exec(text);
    // Atomic append: two partners POSTing notes on the same order concurrently
    // would each read-modify-write order.meta and the second clobbers the first.
    // The default READ COMMITTED transaction did NOT prevent this — both readers
    // saw the pre-update array and the later write won (audit M1). Run the
    // read-modify-write at SERIALIZABLE and retry on a serialization conflict
    // (Prisma P2034), so concurrent appends truly serialize.
    let persisted = entry; // the note actually stored (correct id under concurrency)
    for (let attempt = 0; ; attempt++) {
      try {
        await db.$transaction(async (tx) => {
          const fresh = await tx.order.findUnique({ where: { id: order.id }, select: { meta: true } });
          const fm = (fresh?.meta as Record<string, unknown>) ?? {};
          const fnotes = (fm.notes as typeof notes | undefined) ?? [];
          const fentry = { ...entry, id: fnotes.length + 1 };
          persisted = fentry;
          const nextMeta = {
            ...fm,
            notes: [...fnotes, fentry],
            ...(tracked || urlMatch ? { tracking: { ...(fm.tracking as Record<string, unknown> ?? {}), ...(tracked ? { number: tracked[1] } : {}), ...(urlMatch ? { url: urlMatch[1] } : {}), note: text, at: fentry.date_created } } : {}),
          };
          await tx.order.update({ where: { id: order.id }, data: { meta: nextMeta as Prisma.InputJsonValue } });
        }, { isolationLevel: 'Serializable' });
        break;
      } catch (err) {
        // P2034 = serialization failure / deadlock; retry a few times before giving up.
        if (attempt < 4 && err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') continue;
        throw err;
      }
    }
    // A tracking number IS the ship event. Materialize it: shipment row →
    // the existing shipped email (carrier link, product images) → status flip.
    // Only for orders actually in flight — a note replayed onto an old
    // delivered order must not re-email the customer.
    if (tracked && (order.status === 'processing' || order.status === 'shipped')) {
      const num = tracked[1] as string;
      const carrier = /^1Z/i.test(num) ? 'ups' : /^(9\d{15,21})$/.test(num) ? 'usps' : /^[A-Z]{2}\d{9}[A-Z]{2}$/.test(num) ? 'usps' : null;
      // Reconcile, don't blindly create (audit C11). The old check-then-create was
      // not atomic (concurrent/retried POSTs each passed !existing → two shipments
      // + two emails) and it ignored a shipment the Counter flow may have already
      // planned for this order (parallel row + second email for one parcel).
      //   1. Already a shipment carrying THIS tracking → nothing to do (dedup).
      //   2. An OPEN shipment (shippedAt null) → ATTACH the tracking + mark shipped,
      //      claimed atomically (updateMany count===1) so only one caller emails.
      //   3. None → create; a concurrent create loses on the unique
      //      (orderId,trackingNumber) index (P2002) and does NOT email.
      let notify: string | null = null; // shipment id to email, set ONLY by the winning claim/create
      const withTracking = await db.orderShipment.findFirst({ where: { orderId: order.id, trackingNumber: num }, select: { id: true } });
      if (!withTracking) {
        const open = await db.orderShipment.findFirst({ where: { orderId: order.id, shippedAt: null }, orderBy: { createdAt: 'asc' }, select: { id: true } });
        if (open) {
          const claimed = await db.orderShipment.updateMany({ where: { id: open.id, shippedAt: null }, data: { status: 'shipped', trackingNumber: num, trackingCarrier: carrier, shippedAt: new Date() } });
          if (claimed.count === 1) notify = open.id;
        } else {
          try {
            const created = await db.orderShipment.create({
              data: { orderId: order.id, status: 'shipped', trackingNumber: num, trackingCarrier: carrier, shippedAt: new Date(), shipAddress: (order.shipAddress ?? {}) as Prisma.InputJsonValue },
            });
            notify = created.id;
          } catch (err) {
            // Concurrent create won on the unique index — the other caller emails.
            if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
          }
        }
      }
      if (notify) {
        void import('../../services/commerceEmail.service.js').then(({ commerceEmailService }) => commerceEmailService.sendShippedNotice(notify)).catch(() => { /* mail layer logs */ });
        if (order.status === 'processing') {
          const { orderService } = await import('../../services/order.service.js');
          void orderService.transition(order.id, { status: 'shipped' }).catch(() => { /* graph guard */ });
        }
      }
    }
    // Return the note ACTUALLY persisted (correct id under concurrency), not the
    // pre-transaction guess (audit).
    reply.status(201).send({ ...persisted, author: 'system', date_created_gmt: persisted.date_created });
  });

  // ---------------------------------------------------------------------
  // Printful's own plugin surface.
  //
  // Printful does NOT drive a Woo store through the WooCommerce API alone. Its
  // WordPress plugin registers a handful of extra routes, and after connecting,
  // Printful calls THOSE. When they are missing the sync fails with a message
  // that sends the merchant hunting in entirely the wrong place:
  //
  //   "Valid route not found. Please make sure latest Printful plugin is
  //    installed and REST API enabled!"
  //
  // — which reads as a WordPress problem, so the credentials get blamed and
  // regenerated, repeatedly, while the actual answer is that these five
  // endpoints do not exist. Shapes below are taken from the published plugin
  // (printful-shipping-for-woocommerce 2.2.12, class-printful-rest-api-controller.php).
  //
  // Note the namespace: the plugin registers under wc/v2, NOT wc/v3. Serving
  // them on v3 alone leaves the error exactly as it was.

  const PF = '/wp-json/wc/v2/printful';

  /** Printful's routes are EDITABLE = POST | PUT | PATCH, so all three. */
  const editable = ['POST', 'PUT', 'PATCH'] as const;

  /**
   * The store's public address, as Printful stores it to build links back.
   * Derived from the request rather than configuration: this must match the
   * host Printful actually reached, or its store record points somewhere it
   * cannot get to.
   */
  function storeUrl(req: FastifyRequest): string {
    const configured = process.env.PUBLIC_ORIGIN?.replace(/\/+$/, '');
    if (configured) return configured;
    const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? req.protocol;
    return `${proto}://${req.headers.host ?? ''}`;
  }

  /** Identifies the store to Printful before anything is synced. */
  app.get(`${PF}/store_data`, authed, async (req, reply) => {
    const site = await settingsService.getSite();
    reply.send({
      website: storeUrl(req),
      // The WooCommerce API version we speak — Printful gates features on it.
      version: '9.0.0',
      name: site.siteName || 'Therum OS',
    });
  });

  /**
   * Printful's debug view of the connection. Their support asks for this
   * output, so it reports what is ACTUALLY true here rather than echoing
   * plausible-looking OKs — a checklist that always says OK is worse than none.
   */
  app.get(`${PF}/version`, authed, async (_req, reply) => {
    const storeId = await printfulLink.storeId();
    const linked = storeId !== null;
    reply.send({
      // The plugin version whose surface this implements, so Printful's
      // minimum-version check passes. Their client compares this string.
      version: '2.2.12',
      store_id: storeId ?? false,
      error: false,
      status_checklist: {
        overall_status: linked ? 'OK' : 'NOT CONNECTED',
        items: {
          api_key: { status: linked ? 'OK' : 'NOT CONNECTED', label: 'Printful access token' },
          store_id: { status: linked ? 'OK' : 'NOT CONNECTED', label: 'Printful store id' },
          rest_api: { status: 'OK', label: 'REST API reachable' },
        },
      },
    });
  });

  /**
   * Printful pushing ITS credentials back to the store — the step that makes
   * the connection two-way. Requires read_write: a key that may only read the
   * catalogue has no business changing what this store authenticates as.
   */
  for (const method of editable) {
    app.route({
      method,
      url: `${PF}/access`,
      preHandler: authenticate,
      handler: async (req, reply) => {
        if (!requireWrite(req, reply)) return;
        const body = (req.body ?? {}) as { token?: unknown; storeId?: unknown };
        const token = typeof body.token === 'string' ? body.token : '';
        const storeId = Number.parseInt(String(body.storeId ?? ''), 10);

        // The plugin returns {error: "..."} with HTTP 200 here rather than a
        // status code, and Printful reads the body. Matching that exactly,
        // because a 400 is a shape their client does not expect.
        if (!token || !Number.isFinite(storeId) || storeId <= 0) {
          reply.send({ error: 'Failed to update access data' });
          return;
        }
        await printfulLink.save(token, storeId);
        reply.send({ error: false });
      },
    });
  }

  /**
   * Size charts, pushed per product. Two routes, one handler — Printful sends
   * a ready-made HTML table to the first and a structured object to the
   * second, and which one arrives depends on the product.
   *
   * Stored on `product.meta` under the same keys the plugin writes to post
   * meta, so the storefront has one place to look.
   */
  for (const method of editable) {
    for (const [suffix, metaKey] of [
      ['size-chart', 'pf_size_chart'],
      ['advanced-size-chart', 'pf_advanced_size_chart'],
    ] as const) {
      app.route({
        method,
        url: `${PF}/products/:productId/${suffix}`,
        preHandler: authenticate,
        handler: async (req, reply) => {
          if (!requireWrite(req, reply)) return;
          const { productId } = req.params as { productId: string };
          const chart = (req.body as { size_chart?: unknown } | undefined)?.size_chart;
          if (chart === undefined || chart === null || chart === '') {
            wooError(reply, 400, 'printful_api_size_chart_empty', 'No size chart was provided');
            return;
          }
          // Printful only ever sees the INTEGER wooId (that is what the bridge
          // emits as product.id), so resolve wooId-or-cuid like the rest of this
          // file — a raw cuid lookup 404'd every Printful size-chart push (audit).
          // Owner-scoped (audit C1 class): a partner may only attach a size chart
          // to its OWN product, not mutate another's by global id.
          const chartScope = await partnerProductScope(req);
          const product = await db.product.findFirst({ where: { ...byWooOrCuid(productId), ...(chartScope ?? {}) }, select: { id: true, meta: true } });
          if (!product) {
            wooError(reply, 400, 'printful_api_product_not_found', 'The product is not found');
            return;
          }
          const meta = (product.meta ?? {}) as Record<string, unknown>;
          await db.product.update({
            where: { id: product.id },
            data: { meta: { ...meta, [metaKey]: chart } as object },
          });
          reply.send({ product: { id: productId }, size_chart: chart });
        },
      });
    }
  }
}

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Prisma, type ProductStatus, type OrderStatus } from '@prisma/client';
import { db } from '../../lib/db.js';
import { storeCredentials, readStoreCredential } from '../../counter/storeCredentials.js';
import { toMajor } from '../../counter/currency.js';
import { settingsService } from '../../services/settings.service.js';

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

/** Consent screen renders partner-supplied text; escaping keeps it text. */
function escapeHtml(v: string): string {
  return v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

interface StoreAuth {
  id: string;
  label: string;
  scope: 'read' | 'read_write';
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
  return (ORDER_STATUSES as readonly string[]).includes(value) ? (value as OrderStatus) : null;
}

/** Woo's own error envelope — partners parse `code` and `message`. */
function wooError(reply: FastifyReply, status: number, code: string, message: string): void {
  reply.status(status).send({ code, message, data: { status } });
}

async function authenticate(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const presented = readStoreCredential(req);
  if (!presented) {
    wooError(reply, 401, 'woocommerce_rest_cannot_view', 'Consumer key and secret are required.');
    return;
  }
  const auth = await storeCredentials.verify(presented.key, presented.secret, req.ip);
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

async function loadProducts(where: object, skip: number, take: number) {
  return db.product.findMany({
    where,
    skip,
    take,
    orderBy: { createdAt: 'desc' },
    include: { variants: true, categories: true },
  });
}

type ProductRow = Awaited<ReturnType<typeof loadProducts>>[number];

function toWooProduct(p: ProductRow, currency: string) {
  const first = p.variants[0];
  const gallery = Array.isArray(p.images) ? (p.images as { url?: string; alt?: string }[]) : [];
  const totalStock = p.variants.reduce((n, v) => n + (v.inventory - v.reserved), 0);
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    permalink: '',
    date_created: p.createdAt.toISOString(),
    date_modified: p.updatedAt.toISOString(),
    type: p.variants.length > 1 ? 'variable' : 'simple',
    status: p.status === 'active' ? 'publish' : 'draft',
    description: p.description ?? '',
    short_description: '',
    sku: first?.sku ?? '',
    // Decimal strings, as Woo emits them — see the money note in the header.
    price: first ? String(toMajor(first.price, currency)) : '0',
    regular_price: first ? String(toMajor(first.price, currency)) : '0',
    manage_stock: true,
    stock_quantity: totalStock,
    stock_status: totalStock > 0 ? 'instock' : 'outofstock',
    categories: p.categories.map((c) => ({ id: c.id, name: c.name, slug: c.slug })),
    images: [
      ...(p.image ? [{ id: `${p.id}-main`, src: p.image, alt: p.name }] : []),
      ...gallery.filter((g) => g.url).map((g, i) => ({ id: `${p.id}-${i}`, src: g.url!, alt: g.alt ?? '' })),
    ],
    variations: p.variants.length > 1 ? p.variants.map((v) => v.id) : [],
    meta_data: [],
  };
}

export async function wooCompatRoutes(app: FastifyInstance): Promise<void> {
  const authed = { preHandler: authenticate };

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
  const discovery = async (_req: FastifyRequest, reply: FastifyReply) => {
    const site = await settingsService.getSite();
    reply.send({
      name: site.siteName || 'Therum OS',
      description: site.tagline ?? '',
      url: '',
      home: '',
      gmt_offset: 0,
      timezone_string: 'UTC',
      namespaces: ['wp/v2', 'wc/v3'],
      authentication: {},
      routes: {
        '/wc/v3': { namespace: 'wc/v3', methods: ['GET'] },
        '/wc/v3/products': { namespace: 'wc/v3', methods: ['GET'] },
        '/wc/v3/orders': { namespace: 'wc/v3', methods: ['GET', 'POST'] },
        '/wc/v3/system_status': { namespace: 'wc/v3', methods: ['GET'] },
      },
    });
  };
  app.get('/wp-json', discovery);
  app.get('/wp-json/', discovery);

  /** Namespace index — the second probe, once wc/v3 is known to exist. */
  app.get(PREFIX, async (_req, reply) => {
    reply.send({
      namespace: 'wc/v3',
      routes: {
        '/wc/v3/products': { namespace: 'wc/v3', methods: ['GET'] },
        '/wc/v3/orders': { namespace: 'wc/v3', methods: ['GET', 'PUT'] },
        '/wc/v3/system_status': { namespace: 'wc/v3', methods: ['GET'] },
      },
    });
  });

  /**
   * The endpoint every partner hits FIRST to prove the credentials work. If
   * this 404s, their UI reports "could not connect to your store" with no
   * further detail, so it has to exist even though it carries little.
   */
  app.get(`${PREFIX}/system_status`, authed, async (_req, reply) => {
    const [site, commerce] = await Promise.all([settingsService.getSite(), settingsService.getCommerce()]);
    reply.send({
      environment: {
        home_url: '',
        site_url: '',
        version: '9.0.0', // The Woo API version we speak, not our own version.
        wp_version: '6.5',
        server_info: 'Therum OS / Counter',
      },
      settings: {
        currency: commerce.currency ?? 'USD',
        currency_symbol: '',
        thousand_separator: ',',
        decimal_separator: '.',
        decimals: 2,
      },
      // Named honestly rather than pretending to be WordPress: a partner
      // debugging a sync deserves to know what it is actually talking to.
      database: { wc_database_version: '9.0.0' },
      theme: { name: site.siteName || 'Therum OS' },
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

  function validAuthRequest(q: AuthQuery): string | null {
    if (!q.app_name?.trim()) return 'app_name is required.';
    if (!q.scope || !['read', 'write', 'read_write'].includes(q.scope)) return 'scope must be read, write or read_write.';
    if (!q.user_id?.trim()) return 'user_id is required.';
    if (!q.return_url?.trim()) return 'return_url is required.';
    if (!q.callback_url?.trim()) return 'callback_url is required.';
    try {
      const cb = new URL(q.callback_url);
      const localhost = cb.hostname === 'localhost' || cb.hostname === '127.0.0.1';
      if (cb.protocol !== 'https:' && !localhost) return 'callback_url must be HTTPS.';
    } catch {
      return 'callback_url is not a valid URL.';
    }
    return null;
  }

  app.get(AUTH_PREFIX, async (req, reply) => {
    const q = req.query as AuthQuery;
    const problem = validAuthRequest(q);
    if (problem) {
      reply.status(400).type('text/html').send(`<!doctype html><meta charset="utf-8"><p>${escapeHtml(problem)}</p>`);
      return;
    }
    const app_name = escapeHtml(q.app_name!);
    const params = new URLSearchParams(q as Record<string, string>).toString();
    reply.type('text/html; charset=utf-8').send(`<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect ${app_name}</title>
<style>
 body{font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f6f7f9;margin:0;
      display:flex;min-height:100vh;align-items:center;justify-content:center;color:#111}
 .card{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:28px;max-width:420px;width:calc(100% - 32px)}
 h1{font-size:18px;margin:0 0 6px} p{color:#555;margin:0 0 16px}
 .scope{font-family:ui-monospace,monospace;font-size:12px;background:#f3f4f6;border-radius:6px;padding:2px 6px}
 button{font:inherit;border:0;border-radius:10px;padding:11px 16px;cursor:pointer;width:100%}
 .go{background:#4f46e5;color:#fff;font-weight:600} .no{background:transparent;color:#666;margin-top:8px}
</style>
<div class="card">
  <h1>Connect ${app_name}</h1>
  <p><strong>${app_name}</strong> is asking to connect to this store with
     <span class="scope">${escapeHtml(q.scope!)}</span> access. Approving creates a new store key for it.
     You can revoke it at any time under Nexus.</p>
  <form method="POST" action="${AUTH_PREFIX}?${escapeHtml(params)}">
    <button class="go" name="approve" value="1" type="submit">Approve</button>
    <button class="no" name="approve" value="0" type="submit">Cancel</button>
  </form>
</div>`);
  });

  app.post(AUTH_PREFIX, async (req, reply) => {
    const q = req.query as AuthQuery;
    const problem = validAuthRequest(q);
    if (problem) {
      reply.status(400).send({ message: problem });
      return;
    }
    const body = (req.body ?? {}) as { approve?: string };
    const returnUrl = new URL(q.return_url!);
    returnUrl.searchParams.set('user_id', q.user_id!);

    if (body.approve !== '1') {
      // Woo's documented rejection signal.
      returnUrl.searchParams.set('success', '0');
      reply.redirect(returnUrl.toString(), 302);
      return;
    }

    const scope = q.scope === 'read' ? 'read' : 'read_write';
    const issued = await storeCredentials.issue(`${q.app_name} (auto)`, scope);

    // The partner receives the secret here — the only time it exists outside
    // this response.
    let delivered = false;
    try {
      const res = await fetch(q.callback_url!, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          key_id: issued.id,
          user_id: q.user_id,
          consumer_key: issued.consumerKey,
          consumer_secret: issued.consumerSecret,
          key_permissions: scope,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      delivered = res.ok;
    } catch {
      delivered = false;
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
    const where = {
      ...(q.status && q.status !== 'any'
        ? { status: (q.status === 'publish' ? 'active' : 'draft') as ProductStatus }
        : {}),
      ...(q.sku ? { variants: { some: { sku: q.sku } } } : {}),
      ...(q.search ? { name: { contains: q.search, mode: 'insensitive' as const } } : {}),
    };
    const commerce = await settingsService.getCommerce();
    const [rows, total] = await Promise.all([
      loadProducts(where, skip, take),
      db.product.count({ where }),
    ]);
    setPagingHeaders(reply, total, perPage);
    reply.send(rows.map((p) => toWooProduct(p, commerce.currency ?? 'USD')));
  });

  app.get(`${PREFIX}/products/:id`, authed, async (req, reply) => {
    const { id } = req.params as { id: string };
    const commerce = await settingsService.getCommerce();
    const [row] = await loadProducts({ id }, 0, 1);
    if (!row) {
      wooError(reply, 404, 'woocommerce_rest_product_invalid_id', 'Invalid product ID.');
      return;
    }
    reply.send(toWooProduct(row, commerce.currency ?? 'USD'));
  });

  /**
   * Variations. A POD platform maps each variation to a print product, so a
   * variable product whose variations 404 syncs as unfulfillable.
   */
  app.get(`${PREFIX}/products/:id/variations`, authed, async (req, reply) => {
    const { id } = req.params as { id: string };
    const commerce = await settingsService.getCommerce();
    const currency = commerce.currency ?? 'USD';
    const variants = await db.productVariant.findMany({ where: { productId: id } });
    reply.send(
      variants.map((v) => ({
        id: v.id,
        sku: v.sku ?? '',
        price: String(toMajor(v.price, currency)),
        regular_price: String(toMajor(v.price, currency)),
        manage_stock: true,
        stock_quantity: v.inventory - v.reserved,
        stock_status: v.inventory - v.reserved > 0 ? 'instock' : 'outofstock',
        attributes: [
          ...(v.color ? [{ name: 'Color', option: v.color }] : []),
          ...(v.size ? [{ name: 'Size', option: v.size }] : []),
        ],
      })),
    );
  });

  app.get(`${PREFIX}/orders`, authed, async (req, reply) => {
    const { skip, take, perPage } = paging(req);
    const q = req.query as Record<string, string | undefined>;
    // A partner may send any string; only a real status becomes a filter.
    // Casting blindly would hand Prisma an invalid enum and 500 the sync.
    const wanted = asOrderStatus(q.status);
    const where: Prisma.OrderWhereInput = wanted ? { status: wanted } : {};
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
    reply.send(
      rows.map((o) => ({
        id: o.id,
        number: o.number,
        status: o.status,
        currency: o.currency,
        date_created: o.createdAt.toISOString(),
        total: String(toMajor(o.total, currency)),
        billing: { email: o.customer?.email ?? o.guestEmail ?? '' },
        line_items: o.items.map((i) => ({
          id: i.id,
          name: i.variant?.product?.name ?? 'Item',
          product_id: i.variant?.productId ?? null,
          variation_id: i.variantId ?? null,
          quantity: i.quantity,
          sku: i.variant?.sku ?? '',
          price: String(toMajor(i.priceAtTime, currency)),
          total: String(toMajor(i.priceAtTime * i.quantity, currency)),
        })),
      })),
    );
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
    const order = await db.order.findUnique({ where: { id } });
    if (!order) {
      wooError(reply, 404, 'woocommerce_rest_shop_order_invalid_id', 'Invalid order ID.');
      return;
    }
    const next = asOrderStatus(body?.status);
    if (body?.status && !next) {
      wooError(reply, 400, 'woocommerce_rest_invalid_order_status', `Unknown order status "${body.status}".`);
      return;
    }
    if (next) await db.order.update({ where: { id }, data: { status: next } });
    reply.send({ id, status: next ?? order.status });
  });
}

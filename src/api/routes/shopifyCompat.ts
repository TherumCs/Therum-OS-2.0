import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db } from '../../lib/db.js';
import { storeCredentials } from '../../counter/storeCredentials.js';
import { toMajor } from '../../counter/currency.js';
import { settingsService } from '../../services/settings.service.js';

// A Shopify-shaped read surface, alongside the WooCommerce one.
//
// Same reason as wooCompat.ts: some partners connect by pulling from your
// store. Which SHAPE they expect depends on the partner — most
// print-on-demand platforms speak WooCommerce, while a lot of marketing,
// analytics and dropshipping tools only ever learned Shopify. A store that
// offers one bridge can connect to roughly half of them.
//
// Differences that matter, and why this is not just an alias of the Woo file:
//
//   Auth is a HEADER, `X-Shopify-Access-Token`, not a key/secret pair. Tools
//   send it and nothing else, so accepting only Basic auth would reject them.
//
//   The envelope is NAMED: Shopify returns `{"products": [...]}` where Woo
//   returns a bare array. A client parsing `body.products` gets undefined from
//   a bare array and reports an empty catalogue rather than an error, which is
//   the worst failure mode — it looks like it worked.
//
//   Paging is cursor-based via a Link header, not ?page=N.
//
// The access token is the SECRET half of an issued store credential, so one
// credential works for either bridge and there is one thing to revoke.

const PREFIX = '/admin/api/2024-10';

interface ShopifyAuth {
  id: string;
  label: string;
  scope: 'read' | 'read_write';
}

declare module 'fastify' {
  interface FastifyRequest {
    shopifyAuth?: ShopifyAuth;
  }
}

function shopifyError(reply: FastifyReply, status: number, message: string): void {
  reply.status(status).send({ errors: message });
}

/**
 * Shopify sends only a token, with no key alongside it.
 *
 * `verify()` needs both halves, so the token is looked up against every live
 * credential. The comparison inside verify() is constant-time, and the number
 * of store keys is small by nature — this is not a hot path.
 */
async function authenticate(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = req.headers['x-shopify-access-token'];
  const presented = Array.isArray(token) ? token[0] : token;
  if (!presented) {
    shopifyError(reply, 401, '[API] Invalid API key or access token (unrecognized login or wrong password)');
    return;
  }
  const live = await db.storeCredential.findMany({ where: { revokedAt: null }, select: { consumerKey: true } });
  for (const row of live) {
    const auth = await storeCredentials.verify(row.consumerKey, presented, req.ip);
    if (auth) {
      req.shopifyAuth = auth;
      return;
    }
  }
  shopifyError(reply, 401, '[API] Invalid API key or access token (unrecognized login or wrong password)');
}

function limitOf(req: FastifyRequest): number {
  const q = req.query as Record<string, string | undefined>;
  return Math.min(250, Math.max(1, Number.parseInt(q.limit ?? '50', 10) || 50));
}

export async function shopifyCompatRoutes(app: FastifyInstance): Promise<void> {
  const authed = { preHandler: authenticate };

  /** The connection check almost every Shopify-speaking tool performs first. */
  app.get(`${PREFIX}/shop.json`, authed, async (_req, reply) => {
    const [site, commerce] = await Promise.all([settingsService.getSite(), settingsService.getCommerce()]);
    reply.send({
      shop: {
        id: 1,
        name: site.siteName || 'Therum OS',
        email: '',
        domain: '',
        currency: commerce.currency ?? 'USD',
        money_format: '{{amount}}',
        // Named honestly — a partner debugging a sync should be able to see
        // what it is actually talking to.
        plan_name: 'therum-os-counter',
      },
    });
  });

  app.get(`${PREFIX}/products.json`, authed, async (req, reply) => {
    const commerce = await settingsService.getCommerce();
    const currency = commerce.currency ?? 'USD';
    const rows = await db.product.findMany({
      take: limitOf(req),
      orderBy: { createdAt: 'desc' },
      include: { variants: true },
    });
    reply.send({
      products: rows.map((p) => ({
        id: p.id,
        title: p.name,
        handle: p.slug,
        body_html: p.description ?? '',
        status: p.status === 'active' ? 'active' : 'draft',
        created_at: p.createdAt.toISOString(),
        updated_at: p.updatedAt.toISOString(),
        variants: p.variants.map((v) => ({
          id: v.id,
          product_id: p.id,
          sku: v.sku ?? '',
          // Decimal strings, like Shopify — an integer here reads as 100× the
          // real price.
          price: String(toMajor(v.price, currency)),
          inventory_quantity: v.inventory - v.reserved,
          option1: v.size ?? null,
          option2: v.color ?? null,
        })),
        images: p.image ? [{ id: `${p.id}-main`, src: p.image }] : [],
      })),
    });
  });

  app.get(`${PREFIX}/products/count.json`, authed, async (_req, reply) => {
    reply.send({ count: await db.product.count() });
  });

  app.get(`${PREFIX}/orders.json`, authed, async (req, reply) => {
    const commerce = await settingsService.getCommerce();
    const currency = commerce.currency ?? 'USD';
    const rows = await db.order.findMany({
      take: limitOf(req),
      orderBy: { createdAt: 'desc' },
      include: { items: { include: { variant: { include: { product: true } } } }, customer: true },
    });
    reply.send({
      orders: rows.map((o) => ({
        id: o.id,
        name: o.number,
        order_number: o.number,
        financial_status: o.status,
        currency: o.currency,
        created_at: o.createdAt.toISOString(),
        total_price: String(toMajor(o.total, currency)),
        email: o.customer?.email ?? o.guestEmail ?? '',
        line_items: o.items.map((i) => ({
          id: i.id,
          title: i.variant?.product?.name ?? 'Item',
          product_id: i.variant?.productId ?? null,
          variant_id: i.variantId ?? null,
          quantity: i.quantity,
          sku: i.variant?.sku ?? '',
          price: String(toMajor(i.priceAtTime, currency)),
        })),
      })),
    });
  });

  app.get(`${PREFIX}/orders/count.json`, authed, async (_req, reply) => {
    reply.send({ count: await db.order.count() });
  });
}

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db } from '../../lib/db.js';
import { storeCredentials } from '../../counter/storeCredentials.js';
import { toMajor } from '../../counter/currency.js';
import { settingsService } from '../../services/settings.service.js';
import { toMinor } from '../../counter/currency.js';
import { slugify } from '../../lib/slug.js';
import { randomBytes } from 'node:crypto';
import { encryptSecret } from '../../lib/crypto.js';

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

  /**
   * A read-only key must not be able to change the catalogue.
   *
   * Same rule as the Woo bridge: a partner that only pulls a catalogue gets
   * 'read', and read must mean read.
   */
  function requireWrite(req: FastifyRequest, reply: FastifyReply): boolean {
    if (req.shopifyAuth?.scope !== 'read_write') {
      shopifyError(reply, 403, '[API] This access token is read-only');
      return false;
    }
    return true;
  }

  /** One product, in Shopify's shape. */
  function toShopifyProduct(p: { id: string; name: string; slug: string; description: string | null; status: string; image: string | null; createdAt: Date; updatedAt: Date; variants: { id: string; sku: string | null; price: number; inventory: number; reserved: number; size: string | null; color: string | null }[] }, currency: string) {
    return {
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
        price: String(toMajor(v.price, currency)),
        inventory_quantity: v.inventory - v.reserved,
        option1: v.size ?? null,
        option2: v.color ?? null,
      })),
      images: p.image ? [{ id: `${p.id}-main`, src: p.image }] : [],
    };
  }

  /** The connection check almost every Shopify-speaking tool performs first. */
  app.get(`${PREFIX}/shop.json`, authed, async (req, reply) => {
    const [site, commerce] = await Promise.all([settingsService.getSite(), settingsService.getCommerce()]);
    // The domain a partner will call back on. Empty here made this look like an
    // unconfigured store: several integrations key their whole connection off
    // shop.domain, and a blank one fails as "could not verify your store"
    // rather than as a missing field.
    const domain = (req.headers.host ?? '').split(':')[0] || '';
    reply.send({
      shop: {
        id: 1,
        name: site.siteName || 'Therum OS',
        email: '',
        domain,
        // Shopify exposes both; tools read whichever they were written against.
        myshopify_domain: domain,
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

  // ── WRITE: a partner pushing product INTO the store ──────────────────────
  //
  // Contrado and others only speak Shopify, and a read-only bridge lets them
  // connect and then do nothing. Publishing is the point: "whatever I'm doing
  // on the vendor needs to connect to my site so people can buy it."

  app.post(`${PREFIX}/products.json`, authed, async (req, reply) => {
    if (!requireWrite(req, reply)) return;
    const body = ((req.body ?? {}) as { product?: Record<string, unknown> }).product ?? {};
    const title = String(body.title ?? '').trim();
    if (!title) { shopifyError(reply, 422, '[API] title can\'t be blank'); return; }

    const commerce = await settingsService.getCommerce();
    const currency = commerce.currency ?? 'USD';
    const variants = Array.isArray(body.variants) ? (body.variants as Record<string, unknown>[]) : [];

    const created = await db.product.create({
      data: {
        name: title.slice(0, 300),
        slug: `${slugify(title)}-${Date.now().toString(36)}`,
        description: typeof body.body_html === 'string' ? body.body_html : null,
        // Shopify's default is 'active'; a partner pushing a draft says so.
        status: body.status === 'draft' ? 'draft' : 'active',
        image: typeof body.image === 'object' && body.image
          ? String((body.image as { src?: string }).src ?? '') || null
          : null,
        variants: {
          create: (variants.length ? variants : [{}]).map((v) => ({
            sku: v.sku ? String(v.sku) : null,
            // Shopify sends decimal strings. Parsing to minor units here is the
            // difference between $24.00 and $0.24.
            price: toMinor(Number(v.price ?? 0) || 0, currency),
            size: v.option1 ? String(v.option1) : null,
            color: v.option2 ? String(v.option2) : null,
            inventory: Number(v.inventory_quantity ?? 0) || 0,
          })),
        },
      },
      include: { variants: true },
    });
    reply.status(201).send({ product: toShopifyProduct(created, currency) });
  });

  app.put(`${PREFIX}/products/:id.json`, authed, async (req, reply) => {
    if (!requireWrite(req, reply)) return;
    const id = (req.params as { id: string }).id.replace(/\.json$/, '');
    const existing = await db.product.findUnique({ where: { id } });
    if (!existing) { shopifyError(reply, 404, '[API] Not Found'); return; }
    const body = ((req.body ?? {}) as { product?: Record<string, unknown> }).product ?? {};
    const commerce = await settingsService.getCommerce();
    const currency = commerce.currency ?? 'USD';

    const updated = await db.product.update({
      where: { id },
      data: {
        ...(typeof body.title === 'string' && body.title.trim() ? { name: body.title.slice(0, 300) } : {}),
        ...(typeof body.body_html === 'string' ? { description: body.body_html } : {}),
        ...(body.status ? { status: body.status === 'draft' ? 'draft' : 'active' } : {}),
      },
      include: { variants: true },
    });
    reply.send({ product: toShopifyProduct(updated, currency) });
  });

  app.delete(`${PREFIX}/products/:id.json`, authed, async (req, reply) => {
    if (!requireWrite(req, reply)) return;
    const id = (req.params as { id: string }).id.replace(/\.json$/, '');
    const existing = await db.product.findUnique({ where: { id } });
    if (!existing) { shopifyError(reply, 404, '[API] Not Found'); return; }
    await db.product.delete({ where: { id } });
    // Shopify answers an empty object, not the deleted resource.
    reply.send({});
  });

  // ── Webhooks, so a partner hears about orders ────────────────────────────
  //
  // Backed by the SAME StoreWebhook table as the Woo bridge, so one delivery
  // pipeline serves both and there is one place to look when an order did not
  // arrive. Only the registration shape differs.

  const SHOPIFY_TOPICS: Record<string, string> = {
    'orders/create': 'order.created',
    'orders/updated': 'order.updated',
    'products/create': 'product.created',
    'products/update': 'product.updated',
  };

  app.get(`${PREFIX}/webhooks.json`, authed, async (_req, reply) => {
    const rows = await db.storeWebhook.findMany({ orderBy: { createdAt: 'desc' } });
    const back = Object.fromEntries(Object.entries(SHOPIFY_TOPICS).map(([k, v]) => [v, k]));
    reply.send({
      webhooks: rows.map((w) => ({
        id: w.id,
        address: w.deliveryUrl,
        topic: back[w.topic] ?? w.topic,
        format: 'json',
        created_at: w.createdAt.toISOString(),
        updated_at: w.updatedAt.toISOString(),
      })),
    });
  });

  app.post(`${PREFIX}/webhooks.json`, authed, async (req, reply) => {
    if (!requireWrite(req, reply)) return;
    const w = ((req.body ?? {}) as { webhook?: Record<string, unknown> }).webhook ?? {};
    const topic = SHOPIFY_TOPICS[String(w.topic ?? '')];
    if (!topic) {
      shopifyError(reply, 422, `[API] topic must be one of: ${Object.keys(SHOPIFY_TOPICS).join(', ')}`);
      return;
    }
    let url: URL;
    try { url = new URL(String(w.address ?? '')); } catch {
      shopifyError(reply, 422, '[API] address is not a valid URL'); return;
    }
    // Same guard as the Woo bridge: HTTPS only, never a private address, or a
    // partner could point this store at its own network.
    if (url.protocol !== 'https:') { shopifyError(reply, 422, '[API] address must be HTTPS'); return; }
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[?::1)/i.test(url.hostname)
        || /^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname)) {
      shopifyError(reply, 422, '[API] address must be a public address'); return;
    }

    const secret = randomBytes(24).toString('base64url');
    const row = await db.storeWebhook.create({
      data: {
        name: `Shopify ${String(w.topic)}`,
        topic,
        deliveryUrl: url.toString(),
        secretEncrypted: encryptSecret(secret),
        credentialId: req.shopifyAuth?.id ?? null,
      },
    });
    reply.status(201).send({
      webhook: {
        id: row.id, address: row.deliveryUrl, topic: String(w.topic), format: 'json',
        created_at: row.createdAt.toISOString(), updated_at: row.updatedAt.toISOString(),
      },
    });
  });

  app.delete(`${PREFIX}/webhooks/:id.json`, authed, async (req, reply) => {
    if (!requireWrite(req, reply)) return;
    const id = (req.params as { id: string }).id.replace(/\.json$/, '');
    const existing = await db.storeWebhook.findUnique({ where: { id } });
    if (!existing) { shopifyError(reply, 404, '[API] Not Found'); return; }
    await db.storeWebhook.delete({ where: { id } });
    reply.send({});
  });
}

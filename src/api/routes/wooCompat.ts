import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Prisma, type ProductStatus, type OrderStatus } from '@prisma/client';
import { db } from '../../lib/db.js';
import { storeCredentials, readStoreCredential } from '../../counter/storeCredentials.js';
import { toMajor, toMinor } from '../../counter/currency.js';
import { slugify } from '../../lib/slug.js';
import { settingsService } from '../../services/settings.service.js';
import { printfulLink } from '../../services/printfulLink.service.js';
import { authService } from '../../services/auth.service.js';
import { randomBytes } from 'node:crypto';
import { googleApp, authorizeUrl, signState, readState, exchangeCode, adminForGoogle } from '../../counter/adminGoogleSignIn.js';
import { mintSessionToken, SESSION_TTL_SECONDS } from '../../services/auth.service.js';
import { encryptSecret } from '../../lib/crypto.js';
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
      // wc/v2 is not legacy support — it is where Printful's plugin registers
      // its own routes, and their client checks this list before calling them.
      namespaces: ['wp/v2', 'wc/v2', 'wc/v3'],
      authentication: {},
      routes: {
        '/wc/v3': { namespace: 'wc/v3', methods: ['GET'] },
        '/wc/v3/products': { namespace: 'wc/v3', methods: ['GET'] },
        '/wc/v3/orders': { namespace: 'wc/v3', methods: ['GET', 'POST'] },
        '/wc/v3/webhooks': { namespace: 'wc/v3', methods: ['GET', 'POST'] },
        '/wc/v3/webhooks/(?P<id>[\\w-]+)': { namespace: 'wc/v3', methods: ['GET', 'PUT', 'DELETE'] },
        '/wc/v3/system_status': { namespace: 'wc/v3', methods: ['GET'] },
        '/wc/v2': { namespace: 'wc/v2', methods: ['GET'] },
        '/wc/v2/printful/store_data': { namespace: 'wc/v2', methods: ['GET'] },
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
      const res = await fetch(q.callback_url!, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          // The NUMERIC id, not the cuid. WooCommerce's key_id is a database
          // integer and partners parse it as one — a string fails that parse
          // and the connection is rejected AFTER the keys were accepted, which
          // shows up as "connection failed" with nothing wrong in either log.
          key_id: issued.keyId,
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

  interface WooImage { src?: string; alt?: string; name?: string }
  interface WooAttr { name?: string; option?: string; options?: string[] }

  /** Woo publishes with status "publish"; anything else is not on sale yet. */
  const asStatus = (s: unknown): ProductStatus => (s === 'publish' || s === undefined ? 'active' : 'draft');

  /** Colour and size live in Woo's attribute list, not in named fields. */
  function attrValue(attrs: WooAttr[] | undefined, ...names: string[]): string | null {
    for (const a of attrs ?? []) {
      const n = (a.name ?? '').toLowerCase();
      if (names.some((want) => n === want)) return a.option ?? a.options?.[0] ?? null;
    }
    return null;
  }

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
  async function partnerVendor(req: FastifyRequest): Promise<string> {
    const name = req.storeAuth?.label ?? 'Connected partner';
    const existing = await db.vendor.findFirst({ where: { name } });
    if (existing) return existing.id;
    return (await db.vendor.create({ data: { name } })).id;
  }

  /** Woo sends categories as [{id|name|slug}]; unknown ones are created. */
  async function categoryIds(list: { id?: string; name?: string; slug?: string }[] | undefined): Promise<string[]> {
    const ids: string[] = [];
    for (const c of list ?? []) {
      if (c.id) {
        const byId = await db.productCategory.findUnique({ where: { id: c.id }, select: { id: true } });
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
    const gallery = (body.images ?? []).filter((i) => i.src);
    const price = priceToMinor(body.regular_price ?? body.price, currency);

    const data = {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.status !== undefined ? { status: asStatus(body.status) } : {}),
      ...(gallery.length
        ? {
            image: gallery[0]!.src!,
            images: gallery.slice(1).map((g) => ({ url: g.src!, alt: g.alt ?? g.name ?? '' })),
          }
        : {}),
    };

    if (id) {
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
        status: asStatus(body.status),
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
            inventory: body.stock_quantity ?? 0,
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

    const dupe = await existingBySku(body.sku, await partnerVendor(req));
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
        const commerce = await settingsService.getCommerce();
        const currency = commerce.currency ?? 'USD';
        if (!(await db.product.findUnique({ where: { id }, select: { id: true } }))) {
          wooError(reply, 404, 'woocommerce_rest_product_invalid_id', 'Invalid product ID.');
          return;
        }
        await writeProduct(req, (req.body ?? {}) as WooProductBody, currency, id);
        const [full] = await loadProducts({ id }, 0, 1);
        reply.send(toWooProduct(full!, currency));
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
    const [full] = await loadProducts({ id }, 0, 1);
    if (!full) {
      wooError(reply, 404, 'woocommerce_rest_product_invalid_id', 'Invalid product ID.');
      return;
    }
    if (force === 'true') {
      const ordered = await db.orderItem.findFirst({ where: { variant: { productId: id } }, select: { id: true } });
      if (ordered) {
        // Refusing is the honest answer: deleting would either orphan the order
        // line or silently rewrite what a customer actually bought.
        wooError(reply, 409, 'woocommerce_rest_cannot_delete', 'This product has been ordered; it can be unpublished but not deleted.');
        return;
      }
      await db.product.delete({ where: { id } });
    } else {
      await db.product.update({ where: { id }, data: { status: 'draft' } });
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
    if (!(await db.product.findUnique({ where: { id }, select: { id: true } }))) {
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
        productId: id,
        meta: { path: ['autoFromParent'], equals: true },
        orderItems: { none: {} },
      },
    });
    const data = {
      productId: id,
      sku: body.sku ?? null,
      price: price ?? 0,
      inventory: body.stock_quantity ?? 0,
      color: attrValue(body.attributes, 'color', 'colour'),
      size: attrValue(body.attributes, 'size'),
      meta: {},
    };
    const variant = carried
      ? await db.productVariant.update({ where: { id: carried.id }, data })
      : await db.productVariant.create({ data });
    reply.status(201).send({
      id: variant.id,
      sku: variant.sku ?? '',
      regular_price: String(toMajor(variant.price, currency)),
      stock_quantity: variant.inventory,
    });
  });

  for (const method of ['PUT', 'PATCH'] as const) {
    app.route({
      method,
      url: `${PREFIX}/products/:id/variations/:variationId`,
      preHandler: authenticate,
      handler: async (req, reply) => {
        if (!requireWrite(req, reply)) return;
        const { id, variationId } = req.params as { id: string; variationId: string };
        const body = (req.body ?? {}) as WooProductBody;
        const commerce = await settingsService.getCommerce();
        const currency = commerce.currency ?? 'USD';
        const variant = await db.productVariant.findFirst({ where: { id: variationId, productId: id } });
        if (!variant) {
          wooError(reply, 404, 'woocommerce_rest_product_invalid_id', 'Invalid variation ID.');
          return;
        }
        const price = priceToMinor(body.regular_price ?? body.price, currency);
        const updated = await db.productVariant.update({
          where: { id: variationId },
          data: {
            ...(price !== null ? { price } : {}),
            ...(body.sku !== undefined ? { sku: body.sku } : {}),
            ...(body.stock_quantity !== undefined ? { inventory: body.stock_quantity } : {}),
          },
        });
        reply.send({
          id: updated.id,
          sku: updated.sku ?? '',
          regular_price: String(toMajor(updated.price, currency)),
          stock_quantity: updated.inventory,
        });
      },
    });
  }

  app.delete(`${PREFIX}/products/:id/variations/:variationId`, authed, async (req, reply) => {
    if (!requireWrite(req, reply)) return;
    const { id, variationId } = req.params as { id: string; variationId: string };
    const variant = await db.productVariant.findFirst({ where: { id: variationId, productId: id } });
    if (!variant) {
      wooError(reply, 404, 'woocommerce_rest_product_invalid_id', 'Invalid variation ID.');
      return;
    }
    const ordered = await db.orderItem.findFirst({ where: { variantId: variationId }, select: { id: true } });
    if (ordered) {
      wooError(reply, 409, 'woocommerce_rest_cannot_delete', 'This variation has been ordered and cannot be deleted.');
      return;
    }
    await db.productVariant.delete({ where: { id: variationId } });
    reply.send({ id: variationId });
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
        await writeProduct(req, item, currency, item.id);
        const [full] = await loadProducts({ id: item.id }, 0, 1);
        out.update.push(toWooProduct(full!, currency));
      } catch (err) {
        out.update.push({ error: { code: 'woocommerce_rest_cannot_edit', message: (err as Error).message } });
      }
    }
    for (const id of body.delete ?? []) {
      try {
        await db.product.update({ where: { id }, data: { status: 'draft' } });
        out.delete.push({ id });
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

  app.get(`${PREFIX}/webhooks`, authed, async (req, reply) => {
    const { skip, take, perPage } = paging(req);
    const [rows, total] = await Promise.all([
      db.storeWebhook.findMany({ skip, take, orderBy: { createdAt: 'desc' } }),
      db.storeWebhook.count(),
    ]);
    setPagingHeaders(reply, total, perPage);
    reply.send(rows.map(toWooWebhook));
  });

  app.get(`${PREFIX}/webhooks/:id`, authed, async (req, reply) => {
    const row = await db.storeWebhook.findUnique({ where: { id: (req.params as { id: string }).id } });
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
    if (url.protocol !== 'https:') {
      wooError(reply, 400, 'woocommerce_rest_invalid_webhook_delivery_url', 'delivery_url must be HTTPS.'); return;
    }
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[?::1)/i.test(url.hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname)) {
      wooError(reply, 400, 'woocommerce_rest_invalid_webhook_delivery_url', 'delivery_url must be a public address.'); return;
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
    const existing = await db.storeWebhook.findUnique({ where: { id } });
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
    const existing = await db.storeWebhook.findUnique({ where: { id } });
    if (!existing) { wooError(reply, 404, 'woocommerce_rest_webhook_invalid_id', 'Invalid webhook ID.'); return; }
    await db.storeWebhook.delete({ where: { id } });
    reply.send({ ...toWooWebhook(existing), deleted: true });
  });

  /** Delivery history — "the partner says they never got the order" is otherwise unanswerable. */
  app.get(`${PREFIX}/webhooks/:id/deliveries`, authed, async (req, reply) => {
    const rows = await db.webhookDelivery.findMany({
      where: { webhookId: (req.params as { id: string }).id },
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
          const product = await db.product.findUnique({ where: { id: productId } });
          if (!product) {
            wooError(reply, 400, 'printful_api_product_not_found', 'The product is not found');
            return;
          }
          const meta = (product.meta ?? {}) as Record<string, unknown>;
          await db.product.update({
            where: { id: productId },
            data: { meta: { ...meta, [metaKey]: chart } as object },
          });
          reply.send({ product: { id: productId }, size_chart: chart });
        },
      });
    }
  }
}

import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import { env } from './lib/env.js';
import { hostActionService } from './services/hostAction.service.js';
import { UPLOADS_DIR } from './lib/uploads.js';
import { adminProxy } from './api/adminProxy.js';
import { db, disconnectDb } from './lib/db.js';
import { disconnectRedis } from './lib/redis.js';
import { registerErrorHandler } from './middleware/errorHandler.js';
import { registerAuth } from './middleware/auth.js';
import { productRoutes } from './api/routes/products.js';
import { orderRoutes } from './api/routes/orders.js';
import { customerRoutes } from './api/routes/customers.js';
import { webhookRoutes } from './api/routes/webhooks.js';
import { extensionRoutes } from './api/routes/extensions.js';
import { importRoutes } from './api/routes/import.js';
import { contentRoutes } from './api/routes/content.js';
import { mediaRoutes } from './api/routes/media.js';
import { adminGoogleAuthRoutes } from './api/routes/adminGoogleAuth.js';
import { gmailAuthRoutes } from './api/routes/gmailAuth.js';
import { shopifyOAuthRoutes } from './api/routes/shopifyOAuth.js';
import { authRoutes } from './api/routes/auth.js';
import { foundationRoutes } from './api/routes/foundations.js';
import { capabilityRoutes } from './api/routes/capabilities.js';
import { editionRoutes } from './api/routes/edition.js';
import { settingsRoutes } from './api/routes/settings.js';
import { systemRoutes } from './api/routes/system.js';
import { hostRoutes } from './api/routes/host.js';
import { agentRoutes } from './api/routes/agent.js';
import { meRoutes } from './api/routes/me.js';
import { wooCompatRoutes } from './api/routes/wooCompat.js';
import { shopifyCompatRoutes } from './api/routes/shopifyCompat.js';
import { redirectsRoutes } from './api/routes/redirects.js';
import { toolsRoutes } from './api/routes/tools.js';
import { twoFactorRoutes } from './api/routes/twoFactor.js';
import { apiTokenRoutes } from './api/routes/apiTokens.js';
import { userRoutes } from './api/routes/users.js';
import { roleRoutes } from './api/routes/roles.js';
import { mcpRoutes } from './api/routes/mcp.js';
import { studioAppRoutes } from './api/routes/studioApps.js';
import { milieuRoutes, publicMilieuRoutes } from './api/routes/milieus.js';
import { clusterRoutes } from './api/routes/clusters.js';
import { checkoutRoutes } from './api/routes/checkout.js';
import { cartRoutes } from './api/routes/cart.js';
import { contactRoutes } from './api/routes/contact.js';
import { orderTrackingRoutes } from './api/routes/orderTracking.js';
import { couponRoutes } from './api/routes/coupons.js';
import { storefrontRoutes } from './api/routes/storefront.js';
import { siteRoutes } from './api/routes/site.js';
import { maintenancePage } from './site/maintenanceHtml.js';
import { PAGE_CSP } from './site/pageCsp.js';
import { settingsService } from './services/settings.service.js';
import { hasAdminSession } from './lib/adminSession.js';
import { taxonomyRoutes } from './api/routes/taxonomy.js';
import { bricksRoutes } from './api/routes/bricks.js';
import { counterAdminRoutes, counterPublicRoutes, storeKeyRoutes } from './api/routes/counter.js';
import { reportRoutes } from './api/routes/reports.js';
import { connectionRoutes } from './api/routes/connections.js';
import { oauthRoutes } from './api/routes/oauth.js';
import { extensionService } from './services/extension.service.js';
import { redirectsService } from './services/redirects.service.js';
import { notFoundMonitorService } from './services/notFoundMonitor.service.js';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
  }
}

export async function buildServer() {
  const app = Fastify({
    // Trust X-Forwarded-For ONLY from loopback — the local nginx that fronts
    // /api (conf/nginx/site.conf.hbs). Without this, req.ip is 127.0.0.1 for
    // every proxied request and the public-signup rate limiter becomes one
    // shared site-wide bucket; with a blanket `true`, a direct hit to :4100
    // could spoof the header instead. Loopback-only gives per-client IPs via
    // the proxy while keeping direct connections unspoofable.
    trustProxy: ['127.0.0.1', '::1'],
    /**
     * `/?rest_route=/wc/v3/…` -> `/wp-json/wc/v3/…`.
     *
     * WordPress accepts this query-string form when pretty permalinks are off,
     * and a number of integration connectors use it exclusively. It has to
     * happen HERE rather than in an onRequest hook: by the time hooks run the
     * route is already matched, so rewriting req.raw.url then just leaves the
     * request on the site root — which answers 200 and makes the partner think
     * it found a store with no products.
     */
    rewriteUrl(req) {
      let raw = req.url ?? '/';

      if (raw.includes('rest_route=')) {
        const url = new URL(raw, 'http://x');
        const route = url.searchParams.get('rest_route');
        if (route?.startsWith('/')) {
          url.searchParams.delete('rest_route');
          const qs = url.searchParams.toString();
          raw = `/wp-json${route}${qs ? `?${qs}` : ''}`;
        }
      }

      /**
       * `wc/v2/<anything>` -> `wc/v3/<anything>`.
       *
       * WooCommerce's v2 and v3 namespaces are the same API; a store serving
       * only v3 is a store a v2 client cannot use at all. Printful's client
       * (`Printful WooCommerce Integration/3.1.0`) asks for
       * `wc/v2/system_status` and nothing else it does matters if that 404s —
       * it reports the empty body back to the merchant as `Error: []`, which
       * names neither the route nor the version and sends everyone to look at
       * the credentials instead.
       *
       * Printful's OWN plugin routes live at `wc/v2/printful/*` and are
       * genuinely v2-only, so those are left alone — rewriting them to v3
       * would 404 the very endpoints that were just added.
       */
      if (raw.startsWith('/wp-json/wc/v2/') && !raw.startsWith('/wp-json/wc/v2/printful')) {
        raw = raw.replace('/wp-json/wc/v2/', '/wp-json/wc/v3/');
      }

      return raw;
    },
    logger: {
      level: env.LOG_LEVEL,
      ...(env.NODE_ENV === 'development'
        ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' } } }
        : {}),
    },
  });

  // Helmet's default CSP is img-src 'self' data:, which blocks any product
  // image hosted anywhere else — and a merchant's catalogue images legitimately
  // live on a CDN or a supplier's domain. The product editor previews those, so
  // with the default every thumbnail in it rendered as a broken image.
  //
  // Only img-src is widened, and only to https (never http, never a wildcard
  // for scripts): an image cannot execute, so this costs nothing that matters,
  // while script-src stays 'self'.
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'img-src': ["'self'", 'data:', 'blob:', 'https:'],
      },
    },
    // ONE LAYER OWNS THESE, AND IT IS NGINX.
    //
    // Both were setting them, so every response carried X-Frame-Options,
    // X-Content-Type-Options and Referrer-Policy twice. Harmless while the
    // two agree — and they did not: nginx says Referrer-Policy: no-referrer,
    // helmet says no-referrer... but nginx's own backup config says
    // strict-origin-when-cross-origin, so the next edit could easily have
    // left the browser picking between two different policies.
    //
    // nginx wins because it is the only layer that covers EVERY response:
    // /api/uploads and /builder are served by nginx and fastify-static
    // without touching a route, so headers set only in Node would miss them.
    frameguard: false,
    noSniff: false,
    referrerPolicy: false,
  });
  // Hard ceiling only — the REAL limit is Settings > Uploads > maxUploadMb,
  // enforced in lib/uploadPolicy.ts. This has to sit at or above the schema's
  // own maximum (2048 MB), otherwise multipart rejects a file with a generic
  // error before the configured limit is ever consulted, and raising the
  // setting above 50 MB would silently do nothing.
  await app.register(multipart, { limits: { fileSize: 2048 * 1024 * 1024 } });
  await app.register(fastifyStatic, { root: UPLOADS_DIR, prefix: '/api/uploads/', decorateReply: false });
  // The visual builder (builder/, a Vite SPA whose base is '/builder/') is
  // served from THIS origin rather than its own dev port. NEXT_PUBLIC_BUILDER_URL
  // pointed at :10004 — a port nothing listens on since the API moved to
  // :10009 — so every "Edit" hand-off landed on a dead host. One origin is
  // also the rule for the admin (see api/adminProxy.ts); the builder is no
  // different.
  await app.register(fastifyStatic, {
    root: join(process.cwd(), 'builder', 'dist'),
    prefix: '/builder/',
    decorateReply: false,
  });
  // SPA fallback: deep links like /builder/?content=… must serve index.html.
  app.get('/builder', async (_req, reply) => reply.redirect('/builder/'));
  // Explicit allowlist (CORS_ORIGINS) rather than reflecting any origin —
  // the previous `origin: true` accepted requests from anywhere.
  const allowedOrigins = env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
  await app.register(cors, { origin: allowedOrigins });
  await registerAuth(app);
  registerErrorHandler(app);

  // Capture the raw JSON body so the webhook route can HMAC-verify it.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    const raw = typeof body === 'string' ? body : body.toString('utf8');
    req.rawBody = raw;
    if (raw.length === 0) {
      done(null, undefined);
      return;
    }
    try {
      done(null, JSON.parse(raw));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  // Real redirect application (was CRUD-only before — see redirects.service.ts's
  // own comment: `RedirectRule.hits` existed on the schema but nothing ever
  // incremented it because nothing ever checked a rule against a real
  // request). A saved-but-unmatched path is the actual 404 monitor signal —
  // only genuinely unhandled paths get recorded, not every 404 in general
  // (an API typo like a bad content id 404s through normal route logic, not
  // this handler, which only fires when no route pattern matches at all).
  app.setNotFoundHandler(async (req, reply) => {
    const match = await redirectsService.findMatch(req.url).catch(() => null);
    if (match) {
      reply.redirect(match.to, match.code);
      return;
    }
    // Trailing-slash canonicalisation. The ported chrome was authored against
    // WordPress, whose pretty permalinks end in a slash, so EVERY link in the
    // header and footer (/shop/, /cart/, /contact/) arrived here as a 404
    // against routes registered without one. Redirecting from the not-found
    // handler rather than rewriting up front means live routes are untouched,
    // saved redirect rules above still win, and each URL keeps exactly one
    // canonical form instead of answering 200 at two addresses.
    if (req.method === 'GET' || req.method === 'HEAD') {
      const [path = '', query] = req.url.split('?');
      if (path.length > 1 && path.endsWith('/')) {
        reply.redirect(`${path.replace(/\/+$/, '')}${query ? `?${query}` : ''}`, 301);
        return;
      }
    }
    const referer = req.headers.referer;
    void notFoundMonitorService.record(req.url, req.method, typeof referer === 'string' ? referer : null);
    reply.status(404).send({ error: { code: 'not_found', message: `Route ${req.method}:${req.url} not found` } });
  });

  app.get('/health', async () => {
    let dbOk = true;
    try {
      await db.$queryRaw`SELECT 1`;
    } catch {
      dbOk = false;
    }
    return { status: dbOk ? 'ok' : 'degraded', db: dbOk, ts: new Date().toISOString() };
  });

  await app.register(productRoutes, { prefix: '/api' });
  await app.register(orderRoutes, { prefix: '/api' });
  await app.register(customerRoutes, { prefix: '/api' });
  await app.register(webhookRoutes, { prefix: '/api' });
  await app.register(extensionRoutes, { prefix: '/api' });
  await app.register(importRoutes, { prefix: '/api' });
  await app.register(contentRoutes, { prefix: '/api' });
  await app.register(mediaRoutes, { prefix: '/api' });
  await app.register(authRoutes, { prefix: '/api' });
// NO /api prefix: these are browser redirect endpoints the operator and Google
// both navigate to directly, and the redirect_uri registered with Google is a
// fixed public path.
await app.register(adminGoogleAuthRoutes);
// Gmail send authorisation — unprefixed, because the redirect_uri registered
// with Google is an absolute path on this origin.
await app.register(gmailAuthRoutes);
// Shopify's OAuth install flow, served by this store — every URL in that dance
// lives on the SHOP's domain, so a partner that asks for a store URL can run it
// here. No prefix: the paths are fixed by Shopify's own convention.
await app.register(shopifyOAuthRoutes);
  await app.register(foundationRoutes, { prefix: '/api' });
  await app.register(capabilityRoutes, { prefix: '/api' });
  await app.register(editionRoutes, { prefix: '/api' });
  await app.register(settingsRoutes, { prefix: '/api' });
  await app.register(systemRoutes, { prefix: '/api' });
  await app.register(hostRoutes, { prefix: '/api' });
  await app.register(agentRoutes, { prefix: '/api' });
  await app.register(meRoutes, { prefix: '/api' });
  // Inbound store bridges — partners call these paths verbatim, so they are
  // registered at the root rather than under /api.
  // ── Presenting as a WordPress/WooCommerce store ──────────────────────────
  //
  // There is no WordPress here and never will be. These two hooks exist
  // because integration partners do not ask politely whether a store speaks
  // WooCommerce — they SNIFF for it, in the two ways every WordPress site
  // happens to answer:
  //
  //   1. A `Link: <…/wp-json/>; rel="https://api.w.org/"` header on the site
  //      root. Connectors fetch the store URL and read this header to find the
  //      REST base. No header, and the WooCommerce option fails before any
  //      credential is entered, reporting an invalid store URL.
  //
  //   2. `/?rest_route=/wc/v3/…`, the query-string form used when pretty
  //      permalinks are off — handled by `rewriteUrl` in the factory above.
  //
  // Both are cheap and neither exposes anything: the Link header points at an
  // endpoint that already answers publicly, and the rewrite just reaches the
  // same routes by another spelling.
  //
  // TAKES AND RETURNS THE PAYLOAD. An onSend hook declared as (req, reply)
  // resolves to undefined, and Fastify treats that as the new body — which
  // discarded the compressed stream the moment @fastify/compress was added and
  // served every HTML page as 0 bytes with "stream closed prematurely". It only
  // looked harmless before because there was no upstream hook producing a
  // stream to lose.
  app.addHook('onSend', async (req, reply, payload) => {
    // Only on document responses — a Link header on every JSON reply is noise.
    const type = String(reply.getHeader('content-type') ?? '');
    if (req.method === 'GET' && type.includes('text/html')) {
      const proto = (req.headers['x-forwarded-proto'] as string) ?? 'http';
      const host = req.headers['x-forwarded-host'] ?? req.headers.host;
      if (host) reply.header('Link', `<${proto}://${host}/wp-json/>; rel="https://api.w.org/"`);
    }
    return payload;
  });

  await app.register(wooCompatRoutes);
  await app.register(shopifyCompatRoutes);
  await app.register(redirectsRoutes, { prefix: '/api' });
  await app.register(toolsRoutes, { prefix: '/api' });
  await app.register(twoFactorRoutes, { prefix: '/api' });
  await app.register(apiTokenRoutes, { prefix: '/api' });
  await app.register(userRoutes, { prefix: '/api' });
  await app.register(roleRoutes, { prefix: '/api' });
  await app.register(mcpRoutes, { prefix: '/api' });
  await app.register(studioAppRoutes, { prefix: '/api' });
  await app.register(milieuRoutes, { prefix: '/api' });
  await app.register(publicMilieuRoutes, { prefix: '/api' });
  await app.register(clusterRoutes, { prefix: '/api' });
  await app.register(checkoutRoutes, { prefix: '/api' });
  await app.register(cartRoutes, { prefix: '/api' });
  await app.register(contactRoutes, { prefix: '/api' });
  await app.register(orderTrackingRoutes, { prefix: '/api' });
  await app.register(couponRoutes, { prefix: '/api' });
  await app.register(taxonomyRoutes, { prefix: '/api' });
  await app.register(counterAdminRoutes, { prefix: '/api' });
  await app.register(counterPublicRoutes, { prefix: '/api' });
  await app.register(storeKeyRoutes, { prefix: '/api' });
  await app.register(reportRoutes, { prefix: '/api' });
  await app.register(bricksRoutes, { prefix: '/api' });
  // Counter C4 — public storefront pages, served un-prefixed from this same
  // process so the client runtime's same-origin /api fetches just work.
  await app.register(storefrontRoutes);
  // Admin app — proxied so the whole product lives on one origin.
  await app.register(adminProxy);

  // Base Theme — the default public site frontend (/, /:slug, /blog, /work).
  // ── Maintenance / Coming soon gate ───────────────────────────────────────
  //
  // Runs before the public site, and ONLY the public site: the admin, the API,
  // uploads and the inbound store bridges stay reachable so you can turn it
  // back off, and so a partner sync is not silently broken by a marketing
  // decision.
  //
  // Signed-in admins always see the real site — a maintenance mode you cannot
  // look behind is one you cannot verify the fix through.
  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0] ?? '/';
    // '/auth' is here for the same reason '/wc-auth' is: it is a SIGN-IN
    // surface, and a sign-in you cannot reach during coming-soon is a store
    // you cannot get into to turn coming-soon off. Google's redirect lands on
    // /auth/google/callback, so without this the whole flow ends on the
    // marketing page with a 200 and no explanation.
    // '/admin' (not '/admin/api') covers the whole Shopify surface: the API
    // AND '/admin/oauth', its install flow. This list has now silently eaten
    // two integrations — '/auth' for Google sign-in, then '/admin/oauth' — and
    // both times the symptom was a 200 with the marketing page, which looks
    // like the partner is broken rather than like this gate. Prefix a FAMILY
    // here, not one endpoint.
    const EXEMPT = ['/tos-admin', '/api', '/auth', '/builder', '/wp-json', '/wc-auth', '/admin', '/uploads', '/favicon'];
    if (EXEMPT.some((prefix) => path.startsWith(prefix))) return;

    const maintenance = await settingsService.getMaintenanceCached();
    if (maintenance.mode === 'off') return;

    // A VERIFIED admin session, not merely a cookie by that name. This is only
    // a visibility gate — the real admin auth still runs on /tos-admin — but
    // the site is pre-launch, so this page is the one thing holding an
    // unfinished store back from anyone who guesses the cookie name.
    if (hasAdminSession(req)) return;

    const site = await settingsService.getSite();
    const body = maintenancePage(maintenance, site.siteName || 'Therum OS');
    // 503 for maintenance so crawlers keep the real pages and return; 200 for
    // coming-soon because that page IS the site right now.
    if (maintenance.mode === 'maintenance') {
      reply.status(503);
      if (maintenance.retryAfterMinutes > 0) {
        reply.header('Retry-After', String(maintenance.retryAfterMinutes * 60));
      }
    }
    // The SAME CSP every other public page sets. Without it this response gets
    // helmet's global default of `script-src 'self'`, which blocks the inline
    // countdown and the email form — the page renders perfectly and does
    // nothing, which is the worst way for it to fail.
    reply.header('content-security-policy', PAGE_CSP).type('text/html; charset=utf-8').send(body);
  });

  await app.register(siteRoutes);
  await app.register(connectionRoutes, { prefix: '/api' });
  await app.register(oauthRoutes, { prefix: '/api' });

  // Wire enabled extensions into the hook bus (best-effort; DB may be down).
  try {
    await extensionService.bootWire();
  } catch (err) {
    app.log.warn({ err }, 'extension bootWire skipped (db unavailable?)');
  }

  return app;
}

export async function main(): Promise<void> {
  const app = await buildServer();

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await disconnectRedis();
    await disconnectDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // Any host action still marked 'running' belongs to a process that no longer
  // exists — several of them restart THIS server on purpose, and a reboot ends
  // the rest. Closing them at boot is what makes the log survivable: after a
  // restart you can see that something was started and never observed to
  // finish, instead of a row frozen mid-flight forever.
  const interrupted = await hostActionService.closeInterrupted();
  if (interrupted > 0) app.log.warn({ interrupted }, 'host actions were interrupted by a restart');

  try {
    await app.listen({ port: env.PORT, host: env.HOST });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// Boot when run directly — `node dist/server.js` during development.
//
// This check is NOT sufficient under a process supervisor: PM2 spawns the app
// through its own wrapper, so argv[1] is PM2's ProcessContainer and this is
// false. The server then never listened, never logged, and stayed "online" in
// `pm2 list` because the module-level Redis and Prisma connections hold the
// event loop open. A server that never starts is indistinguishable from a
// healthy one at a glance, which is what made it take a while to find.
//
// Supervisors use dist/main.js instead, which has no condition to get wrong.
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  void main();
}

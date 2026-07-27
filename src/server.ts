import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { env } from './lib/env.js';
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
import { authRoutes } from './api/routes/auth.js';
import { foundationRoutes } from './api/routes/foundations.js';
import { capabilityRoutes } from './api/routes/capabilities.js';
import { editionRoutes } from './api/routes/edition.js';
import { settingsRoutes } from './api/routes/settings.js';
import { systemRoutes } from './api/routes/system.js';
import { meRoutes } from './api/routes/me.js';
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
import { couponRoutes } from './api/routes/coupons.js';
import { storefrontRoutes } from './api/routes/storefront.js';
import { siteRoutes } from './api/routes/site.js';
import { taxonomyRoutes } from './api/routes/taxonomy.js';
import { bricksRoutes } from './api/routes/bricks.js';
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
    logger: {
      level: env.LOG_LEVEL,
      ...(env.NODE_ENV === 'development'
        ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' } } }
        : {}),
    },
  });

  await app.register(helmet);
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });
  await app.register(fastifyStatic, { root: UPLOADS_DIR, prefix: '/api/uploads/', decorateReply: false });
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
  await app.register(foundationRoutes, { prefix: '/api' });
  await app.register(capabilityRoutes, { prefix: '/api' });
  await app.register(editionRoutes, { prefix: '/api' });
  await app.register(settingsRoutes, { prefix: '/api' });
  await app.register(systemRoutes, { prefix: '/api' });
  await app.register(meRoutes, { prefix: '/api' });
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
  await app.register(couponRoutes, { prefix: '/api' });
  await app.register(taxonomyRoutes, { prefix: '/api' });
  await app.register(reportRoutes, { prefix: '/api' });
  await app.register(bricksRoutes, { prefix: '/api' });
  // Counter C4 — public storefront pages, served un-prefixed from this same
  // process so the client runtime's same-origin /api fetches just work.
  await app.register(storefrontRoutes);
  // Admin app — proxied so the whole product lives on one origin.
  await app.register(adminProxy);

  // Base Theme — the default public site frontend (/, /:slug, /blog, /work).
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

async function main(): Promise<void> {
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

  try {
    await app.listen({ port: env.PORT, host: env.HOST });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// Only boot a real listener when run directly — not when imported by tests.
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  void main();
}

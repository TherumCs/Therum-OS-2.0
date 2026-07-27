import type { FastifyInstance } from 'fastify';
import { CreateContentInput, UpdateContentInput, ListContentQuery } from '../../schemas/content.schema.js';
import { contentService } from '../../services/content.service.js';
import { requireCapability } from '../../middleware/capability.js';
import { requireBundle } from '../../middleware/bundle.js';

const idParam = (req: { params: unknown }): string => (req.params as { id: string }).id;

type OriginReq = { protocol: string; host: string; headers: Record<string, string | string[] | undefined> };

// Real request origin, not a hardcoded env var — works regardless of which
// host/port the request actually arrived on, matching how 1.9.44's
// home_url() dynamically resolves. Two cases:
//  1. A direct hit (nginx -> this backend, e.g. the public slug route, or a
//     raw dev curl) — `req.host` (NOT `req.hostname`: Fastify's `hostname`
//     getter deliberately strips the port, `this.host.split(':', 1)[0]`, so
//     building an origin from it silently drops ":10004", the exact class of
//     bug the nginx config's own comments already flagged for $host vs
//     $http_host) already carries the real Host header, port intact.
//  2. A relayed hit (browser -> nginx -> Next.js admin -> this backend, e.g.
//     /preview/[id]'s own server-side fetch) — that last hop is a hardcoded
//     `fetch('http://localhost:4100/...')`, so `req.host` on THIS request is
//     always the backend's own :4100, never the real public host the browser
//     is actually on. The admin app forwards what it saw via the standard
//     X-Forwarded-Host/-Proto headers (see admin/lib/api.ts's
//     forwardedOriginHeaders()) — prefer those when present.
const originOf = (req: OriginReq): string => {
  const fwdHost = req.headers['x-forwarded-host'];
  const fwdProto = req.headers['x-forwarded-proto'];
  const host = (typeof fwdHost === 'string' && fwdHost) || req.host;
  const protocol = (typeof fwdProto === 'string' && fwdProto) || req.protocol;
  return `${protocol}://${host}`;
};

export async function contentRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireCapability('content'));

  // Public render lookup — only published content.
  app.get('/content/slug/:slug', async (req, reply) => {
    const slug = (req.params as { slug: string }).slug;
    reply.send(await contentService.getBySlug(slug));
  });

  // Public rendered HTML — canvas body serialized to markup (the publish output).
  app.get('/content/slug/:slug/render', async (req, reply) => {
    const slug = (req.params as { slug: string }).slug;
    reply.send(await contentService.renderBySlug(slug, originOf(req)));
  });

  // Admin management (auth).
  app.get('/content', { preHandler: app.authenticate }, async (req, reply) => {
    reply.send(await contentService.list(ListContentQuery.parse(req.query)));
  });

  app.get('/content/:id', { preHandler: app.authenticate }, async (req, reply) => {
    reply.send(await contentService.get(idParam(req)));
  });

  app.post('/content', { preHandler: [app.authenticate, requireBundle('write')] }, async (req, reply) => {
    reply.status(201).send(await contentService.create(CreateContentInput.parse(req.body)));
  });

  app.patch('/content/:id', { preHandler: [app.authenticate, requireBundle('write')] }, async (req, reply) => {
    reply.send(await contentService.update(idParam(req), UpdateContentInput.parse(req.body)));
  });

  app.post('/content/:id/publish', { preHandler: [app.authenticate, requireBundle('publish')] }, async (req, reply) => {
    reply.send(await contentService.setStatus(idParam(req), 'published'));
  });

  app.post('/content/:id/unpublish', { preHandler: [app.authenticate, requireBundle('publish')] }, async (req, reply) => {
    reply.send(await contentService.setStatus(idParam(req), 'draft'));
  });

  app.post('/content/:id/duplicate', { preHandler: [app.authenticate, requireBundle('write')] }, async (req, reply) => {
    reply.status(201).send(await contentService.duplicate(idParam(req)));
  });

  // Admin preview — renders a draft (or any status) the same way the public
  // slug route renders published content, so an editor can see it before
  // publishing.
  app.get('/content/:id/render', { preHandler: app.authenticate }, async (req, reply) => {
    reply.send(await contentService.renderById(idParam(req), originOf(req)));
  });

  app.delete('/content/:id', { preHandler: [app.authenticate, requireBundle('write')] }, async (req, reply) => {
    reply.send(await contentService.remove(idParam(req)));
  });
}

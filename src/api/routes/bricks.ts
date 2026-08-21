import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseBricksPayload, fromBricks, toBricks, type CanvasNode } from '../../lib/bricksAdapter.js';
import { contentService } from '../../services/content.service.js';
import { studioAppService } from '../../services/studioApp.service.js';
import { bricksMediaService } from '../../services/bricksMedia.service.js';
import { settingsService } from '../../services/settings.service.js';
import { bricksAddonService } from '../../services/bricksAddon.service.js';
import { isCanvasNode } from '../../lib/render.js';
import { ConflictError } from '../../lib/errors.js';

const ImportInput = z.object({
  title: z.string().min(1).max(240),
  type: z.enum(['page', 'post', 'case_study']).default('page'),
  // The raw Bricks payload — flat element array, template export JSON, or
  // builder clipboard data. Validated structurally by parseBricksPayload.
  payload: z.unknown(),
  // Where the layout's image URLs live (the source site's origin). When set,
  // every image is downloaded into OUR media library and the canvas srcs are
  // rewritten before the draft is saved — no dangling /wp-content/ links.
  mediaBaseUrl: z.string().url().optional(),
});

const LocalizeInput = z.object({
  baseUrl: z.string().url(),
});

// Bricks Bridge — import a Bricks design as a NATIVE canvas draft (editable
// in the Therum Builder, rendered by the existing server renderer), and
// export any canvas content back out as Bricks template JSON. No WordPress
// anywhere in the path.
export async function bricksRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', async (_req, reply) => {
    if (!(await studioAppService.isEnabled('bricks-bridge'))) {
      reply.status(409).send({ error: { code: 'app_disabled', message: 'Enable Bricks Bridge in From the Studio first.' } });
    }
  });

  app.post('/bricks/import', async (req, reply) => {
    const input = ImportInput.parse(req.body);
    let elements;
    try {
      elements = parseBricksPayload(input.payload);
    } catch (e) {
      throw new ConflictError(e instanceof Error ? e.message : 'Invalid Bricks payload', 'payload');
    }
    const canvas = fromBricks(elements);
    const media = input.mediaBaseUrl ? await bricksMediaService.deepLocalize(canvas, input.mediaBaseUrl) : null;
    const item = await contentService.create({
      type: input.type,
      title: input.title,
      body: canvas,
      bodyFormat: 'canvas',
      status: 'draft',
    } as never);
    reply.status(201).send({
      id: item.id,
      slug: item.slug,
      status: item.status,
      elementCount: elements.length,
      ...(media ? { media: { localized: media.localized.length, skipped: media.skipped } } : {}),
    });
  });

  // The media step for content imported BEFORE a mediaBaseUrl was known (or
  // when the source site only came online later): download every external
  // image in the canvas into the media library and rewrite the srcs in place.
  app.post('/bricks/localize-media/:contentId', async (req, reply) => {
    const { contentId } = req.params as { contentId: string };
    const input = LocalizeInput.parse(req.body);
    const item = await contentService.get(contentId);
    if (item.bodyFormat !== 'canvas' || !isCanvasNode(item.body)) {
      throw new ConflictError('Only canvas content can localize media.', 'contentId');
    }
    const canvas = item.body;
    const report = await bricksMediaService.deepLocalize(canvas, input.baseUrl);
    if (report.localized.length > 0) {
      await contentService.update(contentId, { body: canvas } as never);
    }
    reply.send({ id: contentId, localized: report.localized, skipped: report.skipped });
  });

  // ── Installed components (Bricks core + addons) ────────────────────────
  // Powers the Bricks Bridge admin page: what's installed, install a zip,
  // toggle, remove. Zips are unpacked and registered — never executed.
  app.get('/bricks/status', async (_req, reply) => {
    reply.send(await bricksAddonService.status());
  });

  app.post('/bricks/addons', async (req, reply) => {
    const file = await (req as unknown as { file: () => Promise<{ filename: string; toBuffer: () => Promise<Buffer> } | undefined> }).file();
    if (!file) throw new ConflictError('Attach a .zip file to install.', 'file');
    if (!/\.zip$/i.test(file.filename)) {
      throw new ConflictError('Only .zip archives can be installed.', 'file');
    }
    const buffer = await file.toBuffer();
    // The multipart ceiling is deliberately set above the largest value
    // Settings > Uploads allows (see server.ts), so the per-route bound has to
    // be explicit — otherwise a plugin ZIP could be buffered at the 2 GB
    // transport ceiling. Plugin installs are not media, but the site's own
    // declared upload limit is the right yardstick for "too big to accept".
    const { maxUploadMb } = await settingsService.getUploads();
    if (buffer.length > maxUploadMb * 1024 * 1024) {
      throw new ConflictError(
        `That archive is ${(buffer.length / 1024 / 1024).toFixed(1)} MB — this site accepts up to ${maxUploadMb} MB (Settings → Uploads).`,
        'file',
      );
    }
    reply.send(await bricksAddonService.install(file.filename, buffer));
  });

  app.patch('/bricks/addons/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    reply.send(await bricksAddonService.setEnabled(slug, enabled));
  });

  app.delete('/bricks/addons/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    reply.send(await bricksAddonService.remove(slug));
  });

  app.get('/bricks/export/:contentId', async (req, reply) => {
    const { contentId } = req.params as { contentId: string };
    const item = await contentService.get(contentId);
    if (item.bodyFormat !== 'canvas') {
      throw new ConflictError('Only canvas content exports to Bricks format.', 'contentId');
    }
    const elements = toBricks(item.body as unknown as CanvasNode);
    // The exact shape Bricks' own template importer accepts.
    reply.send({ content: elements, templateType: 'content', source: 'therum-bricks-bridge' });
  });
}

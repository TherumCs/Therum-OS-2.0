import type { FastifyInstance } from 'fastify';
import { CreateMediaInput, ListMediaQuery, UpdateMediaInput, RenameMediaInput, BulkRenameInput } from '../../schemas/media.schema.js';
import { mediaService } from '../../services/media.service.js';
import { requireCapability } from '../../middleware/capability.js';
import { ValidationError } from '../../lib/errors.js';

const idParam = (req: { params: unknown }): string => (req.params as { id: string }).id;

// Media belongs to the Content capability (Folio's own description: "Pages,
// blog, case studies, SEO, media") — same gate as content.ts.
export async function mediaRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireCapability('content'));

  app.get('/media', async (req, reply) => {
    reply.send(await mediaService.list(ListMediaQuery.parse(req.query)));
  });

  app.get('/media/:id', async (req, reply) => {
    reply.send(await mediaService.get(idParam(req)));
  });

  app.post('/media', { preHandler: app.authenticate }, async (req, reply) => {
    reply.status(201).send(await mediaService.create(CreateMediaInput.parse(req.body)));
  });

  app.post('/media/upload', { preHandler: app.authenticate }, async (req, reply) => {
    const file = await req.file();
    if (!file) throw new ValidationError('No file in upload.', 'file');
    const buffer = await file.toBuffer();
    const alt = typeof file.fields.alt === 'object' && 'value' in file.fields.alt ? String(file.fields.alt.value) : undefined;
    reply.status(201).send(await mediaService.upload({ filename: file.filename, mimetype: file.mimetype, buffer }, alt));
  });

  app.patch('/media/:id', { preHandler: app.authenticate }, async (req, reply) => {
    const input = UpdateMediaInput.parse(req.body);
    reply.send(await mediaService.updateAlt(idParam(req), input.alt));
  });

  app.post('/media/:id/rename', { preHandler: app.authenticate }, async (req, reply) => {
    const input = RenameMediaInput.parse(req.body);
    reply.send(await mediaService.rename(idParam(req), input.basename));
  });

  app.post('/media/:id/regenerate-thumbnail', { preHandler: app.authenticate }, async (req, reply) => {
    reply.send(await mediaService.regenerateThumbnail(idParam(req)));
  });

  app.post('/media/bulk-rename', { preHandler: app.authenticate }, async (req, reply) => {
    const input = BulkRenameInput.parse(req.body);
    reply.send(await mediaService.bulkRename(input.items));
  });

  app.delete('/media/:id', { preHandler: app.authenticate }, async (req, reply) => {
    reply.send(await mediaService.remove(idParam(req)));
  });
}

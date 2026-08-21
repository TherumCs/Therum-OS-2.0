import type { FastifyInstance } from 'fastify';
import { IssueApiTokenInput } from '../../schemas/auth.schema.js';
import { apiTokenService } from '../../services/apiToken.service.js';

const idParam = (req: { params: unknown }): string => (req.params as { id: string }).id;

export async function apiTokenRoutes(app: FastifyInstance): Promise<void> {
  app.get('/auth/tokens', { preHandler: app.authenticate }, async (req, reply) => {
    reply.send(await apiTokenService.list(req.user.sub));
  });

  app.post('/auth/tokens', { preHandler: app.authenticate }, async (req, reply) => {
    const input = IssueApiTokenInput.parse(req.body);
    reply.status(201).send(await apiTokenService.issue(req.user.sub, input.name, input.scope, input.expiresInDays));
  });

  app.delete('/auth/tokens/:id', { preHandler: app.authenticate }, async (req, reply) => {
    await apiTokenService.revoke(req.user.sub, idParam(req));
    reply.send({ ok: true });
  });
}

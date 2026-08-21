import type { FastifyInstance } from 'fastify';
import { TwoFactorConfirmInput } from '../../schemas/auth.schema.js';
import { twoFactorService } from '../../services/twoFactor.service.js';
import { authEventService } from '../../services/authEvent.service.js';
import { db } from '../../lib/db.js';

// All authenticated — 2FA enrollment is something you do to your OWN
// already-logged-in account, not part of the public login surface.
export async function twoFactorRoutes(app: FastifyInstance): Promise<void> {
  app.get('/auth/2fa', { preHandler: app.authenticate }, async (req, reply) => {
    reply.send(await twoFactorService.status(req.user.sub));
  });

  app.post('/auth/2fa/enroll', { preHandler: app.authenticate }, async (req, reply) => {
    reply.send(await twoFactorService.enroll(req.user.sub));
  });

  app.post('/auth/2fa/confirm', { preHandler: app.authenticate }, async (req, reply) => {
    const input = TwoFactorConfirmInput.parse(req.body);
    const result = await twoFactorService.confirm(req.user.sub, input.code);
    const user = await db.adminUser.findUnique({ where: { id: req.user.sub }, select: { username: true } });
    await authEventService.log('2fa_enabled', user?.username ?? req.user.sub, req.ip);
    reply.send(result);
  });

  app.post('/auth/2fa/disable', { preHandler: app.authenticate }, async (req, reply) => {
    await twoFactorService.disable(req.user.sub);
    const user = await db.adminUser.findUnique({ where: { id: req.user.sub }, select: { username: true } });
    await authEventService.log('2fa_disabled', user?.username ?? req.user.sub, req.ip);
    reply.send({ ok: true });
  });
}

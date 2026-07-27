import type { FastifyInstance } from 'fastify';
import { SetupInput, LoginInput, VerifyTwoFactorInput, ChangePasswordInput } from '../../schemas/auth.schema.js';
import { authService } from '../../services/auth.service.js';

// All public — by definition there's no session before setup/login exist yet.
// setup() is safe to leave unauthenticated because it internally refuses once
// any account already exists (see auth.service.ts). verify-2fa is public too:
// its own challengeToken (role 'pending2fa', 5-minute expiry) is the actual
// credential — that's the whole point of the two-step flow.
export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get('/auth/status', async (_req, reply) => {
    reply.send({ needsSetup: await authService.needsSetup() });
  });

  app.post('/auth/setup', async (req, reply) => {
    reply.status(201).send(await authService.setup(SetupInput.parse(req.body)));
  });

  app.post('/auth/login', async (req, reply) => {
    reply.send(await authService.login(LoginInput.parse(req.body), req.ip));
  });

  app.post('/auth/verify-2fa', async (req, reply) => {
    const input = VerifyTwoFactorInput.parse(req.body);
    reply.send(await authService.verifyTwoFactor(input.challengeToken, input.code, req.ip));
  });

  app.post('/auth/change-password', { preHandler: app.authenticate }, async (req, reply) => {
    await authService.changePassword(req.user.sub, ChangePasswordInput.parse(req.body), req.ip);
    reply.send({ ok: true });
  });
}

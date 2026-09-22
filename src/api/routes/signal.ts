import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireBundle } from '../../middleware/bundle.js';
import { signalService } from '../../services/signal.service.js';

// Signal (Meta Pixel + Conversions API). The storefront asks for the pixel ID;
// the admin reads status, saves settings, and fires a test event.

const SettingsInput = z.object({
  enabled: z.boolean().optional(),
  pixelId: z.string().max(40).optional(),
  testEventCode: z.string().max(40).optional(),
});

export async function signalPublicRoutes(app: FastifyInstance): Promise<void> {
  app.get('/shop/signal', async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=60').send(await signalService.publicConfig());
  });
}

export async function signalRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);

  app.get('/signal', async (_req, reply) => reply.send(await signalService.status()));

  app.put('/signal', { preHandler: requireBundle('storefront-manager') }, async (req, reply) => {
    await signalService.setSettings(SettingsInput.parse(req.body));
    reply.send(await signalService.status());
  });

  // One server event, so the merchant can watch it arrive in Events Manager ›
  // Test Events. Uses the saved test code when there is one.
  app.post('/signal/test', { preHandler: requireBundle('storefront-manager') }, async (req, reply) => {
    const ok = await signalService.send(
      'PageView',
      signalService.eventId('test'),
      { client_ip_address: req.ip, client_user_agent: String(req.headers['user-agent'] ?? '').slice(0, 400) },
      {},
      `${(process.env.PUBLIC_ORIGIN ?? '').replace(/\/+$/, '')}/`,
    );
    reply.send({ ok, status: await signalService.status() });
  });
}

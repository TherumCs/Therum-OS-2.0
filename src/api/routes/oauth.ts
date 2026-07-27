import type { FastifyInstance } from 'fastify';
import { oauthService } from '../../services/oauth.service.js';
import { OAuthAppInput, OAuthCallbackInput } from '../../schemas/oauth.schema.js';
import { requireBundle } from '../../middleware/bundle.js';

const requireConnectionsWrite = requireBundle('manage-settings');

// The browser is redirected here directly by the OAuth provider, so it
// can't carry a bearer token — cookie-auth only exists on the admin app's
// own origin. All of these routes are called server-side, from the admin
// app's Route Handlers (which DO have the real session cookie), never
// directly by the browser. See admin/app/api/connections/[provider]/oauth/.
export async function oauthRoutes(app: FastifyInstance): Promise<void> {
  // One call instead of 3 — which of the OAuth-typed providers already
  // have an app configured, so the UI can offer "Connect with X" instead
  // of a config form.
  app.get('/connections/oauth/apps', { preHandler: app.authenticate }, async (_req, reply) => {
    const entries = await Promise.all(oauthService.providers().map(async (p) => [p, await oauthService.hasApp(p)] as const));
    reply.send(Object.fromEntries(entries));
  });

  app.put('/connections/:provider/oauth/app', { preHandler: [app.authenticate, requireConnectionsWrite] }, async (req, reply) => {
    const { provider } = req.params as { provider: string };
    const { clientId, clientSecret } = OAuthAppInput.parse(req.body);
    await oauthService.setApp(provider, clientId, clientSecret);
    reply.send({ ok: true });
  });

  app.get('/connections/:provider/oauth/app', { preHandler: app.authenticate }, async (req, reply) => {
    const { provider } = req.params as { provider: string };
    reply.send({ configured: await oauthService.hasApp(provider) });
  });

  app.get('/connections/:provider/oauth/start-url', { preHandler: [app.authenticate, requireConnectionsWrite] }, async (req, reply) => {
    const { provider } = req.params as { provider: string };
    const { redirectUri } = req.query as { redirectUri?: string };
    if (!redirectUri) {
      reply.status(400).send({ error: { code: 'bad_request', message: 'redirectUri is required.' } });
      return;
    }
    reply.send({ url: await oauthService.startUrl(provider, redirectUri) });
  });

  app.post('/connections/:provider/oauth/callback', { preHandler: [app.authenticate, requireConnectionsWrite] }, async (req, reply) => {
    const { provider } = req.params as { provider: string };
    const { code, state, redirectUri } = OAuthCallbackInput.parse(req.body);
    await oauthService.handleCallback(provider, code, state, redirectUri, req.user.sub);
    reply.send({ ok: true });
  });
}

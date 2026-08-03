import type { FastifyInstance, FastifyRequest } from 'fastify';
import { connectionService } from '../../services/connection.service.js';
import { adminSessionFrom } from '../../lib/adminSession.js';
import { GMAIL_SEND_SCOPE, GMAIL_STATE_PREFIX } from '../../services/gmailSend.js';
import { googleApp, signState, readState } from '../../counter/adminGoogleSignIn.js';

// Authorising the store to send mail as the owner's Google account.
//
// Admin-only, and deliberately a separate grant from Google sign-in: sign-in
// holds openid/email/profile, and Google will not let a token minted for those
// scopes near Gmail. This asks for `gmail.send` and nothing else — permission
// to send, not to read a mailbox.
//
// The refresh token is the whole point of access_type=offline: without it the
// grant dies in an hour and the contact form quietly stops delivering. prompt
// =consent is required too, because Google returns a refresh token only on the
// FIRST authorisation unless it is explicitly asked to re-consent — reconnect
// after a revoke would otherwise appear to succeed and store nothing.

function originOf(req: FastifyRequest): string {
  const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? req.protocol;
  return `${proto}://${req.headers.host ?? 'localhost'}`;
}

export async function gmailAuthRoutes(app: FastifyInstance): Promise<void> {
  // The URI registered against the Google client — see GMAIL_STATE_PREFIX.
  const SIGNIN_CALLBACK = '/auth/google/callback';

  app.get('/auth/google/gmail/start', async (req, reply) => {
    if (!adminSessionFrom(req)) return reply.code(401).send({ error: 'Sign in first.' });
    const creds = await googleApp();
    if (!creds) {
      return reply.code(400).send({ error: 'Connect Google sign-in first — its client is what this reuses.' });
    }
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', creds.clientId);
    url.searchParams.set('redirect_uri', originOf(req) + SIGNIN_CALLBACK);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', GMAIL_SEND_SCOPE);
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent select_account');
    // Google SKIPS the account chooser when the browser has exactly one signed
    // in Google session, so `select_account` alone lands you on whichever
    // account that happens to be with no way to change it. `?as=<address>`
    // names the mailbox to authorise and Google honours it over the active
    // session; the value is passed through as a hint only, so a wrong address
    // still lands on a chooser rather than failing.
    const wanted = (req.query as { as?: string }).as;
    if (typeof wanted === 'string' && wanted.includes('@')) {
      // No CR/LF into a URL parameter, and nothing long enough to be a payload.
      url.searchParams.set('login_hint', wanted.replace(/[\r\n]/g, '').slice(0, 320));
    }
    url.searchParams.set('state', signState(GMAIL_STATE_PREFIX + '/tos-admin/settings/connections'));
    reply.redirect(url.toString());
  });

}

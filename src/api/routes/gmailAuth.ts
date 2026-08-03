import type { FastifyInstance, FastifyRequest } from 'fastify';
import { connectionService } from '../../services/connection.service.js';
import { adminSessionFrom } from '../../lib/adminSession.js';
import { GMAIL_SEND_SCOPE, GMAIL_PROVIDER } from '../../services/gmailSend.js';
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
  const redirectPath = '/auth/google/gmail/callback';

  app.get('/auth/google/gmail/start', async (req, reply) => {
    if (!adminSessionFrom(req)) return reply.code(401).send({ error: 'Sign in first.' });
    const creds = await googleApp();
    if (!creds) {
      return reply.code(400).send({ error: 'Connect Google sign-in first — its client is what this reuses.' });
    }
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', creds.clientId);
    url.searchParams.set('redirect_uri', originOf(req) + redirectPath);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', GMAIL_SEND_SCOPE);
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent select_account');
    url.searchParams.set('state', signState('/tos-admin/settings/connections'));
    reply.redirect(url.toString());
  });

  app.get('/auth/google/gmail/callback', async (req, reply) => {
    if (!adminSessionFrom(req)) return reply.code(401).send({ error: 'Sign in first.' });
    const q = req.query as { code?: string; state?: string; error?: string };
    if (q.error || !q.code) return reply.redirect('/tos-admin/settings/connections?gmail=denied');
    // The signed state is the CSRF check: without it any page could walk an
    // admin's browser through this callback with an attacker's code.
    if (!readState(q.state ?? '')) return reply.redirect('/tos-admin/settings/connections?gmail=badstate');

    const creds = await googleApp();
    if (!creds) return reply.redirect('/tos-admin/settings/connections?gmail=noclient');

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: q.code,
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        redirect_uri: originOf(req) + redirectPath,
        grant_type: 'authorization_code',
      }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    const token = (await tokenRes?.json().catch(() => null)) as
      { refresh_token?: string; access_token?: string } | null;
    if (!token?.refresh_token) {
      // No refresh token means a re-consent that Google treated as already
      // granted. Storing the access token instead would work for an hour and
      // then fail silently, which is worse than refusing here.
      return reply.redirect('/tos-admin/settings/connections?gmail=norefresh');
    }

    // Which mailbox this actually sends as — Gmail rewrites From to the
    // authorised account, so recording it keeps the settings screen honest.
    let email = '';
    if (token.access_token) {
      const who = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { authorization: `Bearer ${token.access_token}` },
        signal: AbortSignal.timeout(10_000),
      }).catch(() => null);
      const info = (await who?.json().catch(() => null)) as { email?: string } | null;
      email = info?.email ?? '';
    }

    // method 'oauth' skips the fields validator, which is written for typed
    // credentials and would reject this JSON blob.
    await connectionService.connect(
      GMAIL_PROVIDER,
      JSON.stringify({
        refreshToken: token.refresh_token,
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
        email,
      }),
      adminSessionFrom(req)?.sub ?? 'system',
      'oauth',
    );

    reply.redirect('/tos-admin/settings/connections?gmail=connected');
  });
}

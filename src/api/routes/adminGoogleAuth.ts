import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  googleApp, authorizeUrl, signState, readState, exchangeCode, adminForGoogle,
} from '../../counter/adminGoogleSignIn.js';
import { mintSessionToken, SESSION_TTL_SECONDS } from '../../services/auth.service.js';
import { authEventService } from '../../services/authEvent.service.js';
import { storeGmailGrant, GMAIL_STATE_PREFIX } from '../../services/gmailSend.js';

// "Sign in with Google" for the admin, anywhere — not just the partner
// approval screen it was first built for.
//
// Same module underneath (counter/adminGoogleSignIn.ts): same signed state,
// same linked-account rule, same refusal of unverified emails. Only the
// destination differs, so there is one place to get the security wrong rather
// than two.

const START = '/auth/google/start';
const CALLBACK = '/auth/google/callback';

function publicOrigin(req: FastifyRequest): string {
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim() || 'https';
  // See wooCompat.ts — never fall back to a specific tenant's domain.
  return `${proto}://${req.headers.host ?? 'localhost'}`;
}

function cookieDomain(host: string | undefined): string | undefined {
  if (!host) return undefined;
  const name = host.split(':')[0]!.toLowerCase();
  if (name === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(name) || !name.includes('.')) return undefined;
  return name.replace(/^www\./, '');
}

/**
 * Where the user may be sent afterwards.
 *
 * A same-origin PATH only. Accepting an absolute URL here would make this an
 * open redirect that also hands the visitor a fresh admin session on the way
 * out — a phishing primitive, not a convenience. The signed state stops
 * tampering after this point; this is the check before it is signed.
 */
function safeNext(raw: unknown): string {
  const s = typeof raw === 'string' ? raw : '';
  // Must start with a single slash: "//evil.com" is protocol-relative and
  // absolute to a browser, which is exactly the case that looks safe.
  if (!s.startsWith('/') || s.startsWith('//')) return '/tos-admin';
  return s;
}

function setSessionCookie(reply: FastifyReply, req: FastifyRequest, token: string): void {
  const domain = cookieDomain(req.headers.host);
  reply.header('set-cookie', [
    `th_session=${token}`,
    'Path=/',
    `Max-Age=${SESSION_TTL_SECONDS}`,
    ...(domain ? [`Domain=${domain}`] : []),
    'HttpOnly', 'Secure', 'SameSite=Lax',
  ].join('; '));
}

function fail(reply: FastifyReply, next: string, reason: string): void {
  // The destination decides how to show it; the admin login reads ?error=.
  const u = new URL(next, 'https://placeholder.invalid');
  u.searchParams.set('error', reason);
  reply.redirect(`${u.pathname}${u.search}`, 302);
}

export async function adminGoogleAuthRoutes(app: FastifyInstance): Promise<void> {
  app.get(START, async (req, reply) => {
    const next = safeNext((req.query as { next?: string }).next);
    const configured = await googleApp();
    if (!configured) { fail(reply, next, 'google_not_configured'); return; }
    reply.redirect(
      authorizeUrl(configured, `${publicOrigin(req)}${CALLBACK}`, signState(next)),
      302,
    );
  });

  app.get(CALLBACK, async (req, reply) => {
    const q = req.query as { code?: string; state?: string; error?: string };
    const state = q.state ? readState(q.state) : null;

    // Gmail-send consent comes back HERE rather than to its own path. Google
    // rejects any redirect_uri that is not registered against the client, and
    // this one already is because sign-in uses it — adding a second path would
    // mean editing the Google console before mail could work at all. The
    // signed state carries the marker, so the two flows cannot be confused and
    // the marker cannot be forged.
    if (state?.returnTo.startsWith(GMAIL_STATE_PREFIX)) {
      const back = safeNext(state.returnTo.slice(GMAIL_STATE_PREFIX.length));
      if (q.error || !q.code) { fail(reply, back, 'gmail_cancelled'); return; }
      const app2 = await googleApp();
      if (!app2) { fail(reply, back, 'google_not_configured'); return; }
      const outcome = await storeGmailGrant(app2, q.code, `${publicOrigin(req)}${CALLBACK}`);
      if (!outcome.ok) { fail(reply, back, outcome.reason); return; }
      reply.redirect(`${back}${back.includes('?') ? '&' : '?'}gmail=connected`, 302);
      return;
    }
    // No usable state means no trustworthy destination — refuse rather than
    // guess, since guessing is how an open redirect gets built by accident.
    if (!state) { fail(reply, '/tos-admin/login', 'google_state_expired'); return; }
    const next = safeNext(state.returnTo);

    if (q.error || !q.code) { fail(reply, next, 'google_cancelled'); return; }

    const configured = await googleApp();
    if (!configured) { fail(reply, next, 'google_not_configured'); return; }

    const identity = await exchangeCode(configured, q.code, `${publicOrigin(req)}${CALLBACK}`);
    if (!identity) { fail(reply, next, 'google_failed'); return; }

    const admin = await adminForGoogle(identity);
    if (!admin) {
      // Logged like any other rejected sign-in: this is an authentication
      // attempt against the store, and it belongs in the same audit trail.
      await authEventService.log('login_failure', identity.email, req.ip);
      fail(reply, next, 'google_not_linked');
      return;
    }

    await authEventService.log('login_success', admin.username, req.ip);
    setSessionCookie(reply, req, mintSessionToken(admin.id, admin.roleId ? 'custom' : 'admin'));
    reply.redirect(next, 302);
  });
}

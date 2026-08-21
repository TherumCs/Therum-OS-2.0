import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { db } from '../../lib/db.js';
import { env } from '../../lib/env.js';
import { storeCredentials } from '../../counter/storeCredentials.js';
import { adminSessionFrom } from '../../lib/adminSession.js';

// Shopify's OAuth install flow, served by this store.
//
// WHY THIS CAN WORK AT ALL: every URL in Shopify's OAuth dance lives on the
// SHOP's own domain — `/admin/oauth/authorize`, `/admin/oauth/access_token`,
// then `/admin/api/...`. Nothing in the sequence is hosted by Shopify itself.
// So a partner that lets a merchant type their own store domain will run the
// whole flow against this store, exactly as Tapstitch and PODpartner do on the
// WooCommerce side.
//
// WHAT THIS CANNOT DO, stated plainly: an app installed FROM the Shopify App
// Store never asks for a domain — it starts inside a real Shopify admin, and
// no bridge reaches that. This only helps when the partner's own dashboard
// asks "what is your store URL?".
//
// THE HMAC GAP, which is the honest weak point. Real Shopify signs the
// authorize callback with the app's client_secret, which Shopify knows because
// the app is registered with it. This store does not learn Contrado's secret
// until the token exchange, one step LATER, so the callback cannot carry a
// verifiable hmac. A partner that checks it will refuse. There is no way
// around that short of the partner telling us the secret first, and it is the
// single most likely reason this fails.

const AUTHORIZE = '/admin/oauth/authorize';
const TOKEN = '/admin/oauth/access_token';

interface AuthorizeQuery {
  client_id?: string;
  scope?: string;
  redirect_uri?: string;
  state?: string;
}

const escapeHtml = (v: string): string =>
  v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/**
 * The authorization code.
 *
 * Signed and short-lived rather than stored: it must survive only the seconds
 * between the merchant approving and the partner exchanging it, and a signed
 * value cannot be forged into one for a different app. Single use is enforced
 * by the exchange marking it spent.
 */
function signCode(clientId: string, scope: 'read' | 'read_write'): string {
  const body = Buffer.from(JSON.stringify({ c: clientId, s: scope, t: Date.now(), n: randomBytes(6).toString('hex') })).toString('base64url');
  const sig = createHmac('sha256', env.JWT_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function readCode(code: string): { clientId: string; scope: 'read' | 'read_write' } | null {
  const [body, sig] = code.split('.');
  if (!body || !sig) return null;
  const expect = createHmac('sha256', env.JWT_SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { c, s: sc, t } = JSON.parse(Buffer.from(body, 'base64url').toString()) as { c: string; s: 'read' | 'read_write'; t: number };
    // Ten minutes: long enough for a redirect and an exchange, short enough
    // that a leaked URL is not a standing grant.
    if (Date.now() - t > 10 * 60 * 1000) return null;
    return { clientId: c, scope: sc === 'read_write' ? 'read_write' : 'read' };
  } catch {
    return null;
  }
}

const spent = new Set<string>();

export async function shopifyOAuthRoutes(app: FastifyInstance): Promise<void> {
  // The install screen is an HTML FORM, so its POST arrives as
  // application/x-www-form-urlencoded — a content type Fastify does not parse
  // out of the box and answers 415 for. Without this the Install button fails
  // with an error the merchant cannot act on. Scoped to this plugin, so the
  // rest of the API keeps rejecting form posts.
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_req, body, done) => {
      try {
        done(null, Object.fromEntries(new URLSearchParams(body as string)));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  app.get(AUTHORIZE, async (req, reply) => {
    const q = req.query as AuthorizeQuery;
    if (!q.client_id || !q.redirect_uri) {
      reply.status(400).type('text/html').send('<!doctype html><meta charset="utf-8"><p>Missing client_id or redirect_uri.</p>');
      return;
    }
    let back: URL;
    try { back = new URL(q.redirect_uri); } catch {
      reply.status(400).type('text/html').send('<!doctype html><meta charset="utf-8"><p>redirect_uri is not a valid URL.</p>');
      return;
    }
    if (back.protocol !== 'https:') {
      reply.status(400).type('text/html').send('<!doctype html><meta charset="utf-8"><p>redirect_uri must be HTTPS.</p>');
      return;
    }

    const session = adminSessionFrom(req);
    const account = session
      ? await db.adminUser.findUnique({ where: { id: session.sub }, select: { username: true } })
      : null;

    // Same policy reasoning as the Woo approval screen: helmet's default
    // form-action would silently swallow the redirect this ends in, and a page
    // whose content depends on a cookie must never be cached as public.
    reply.header(
      'content-security-policy',
      "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'none'; " +
      `base-uri 'self'; frame-ancestors 'none'; form-action 'self' ${back.origin}`,
    );
    reply.header('cache-control', 'private, no-store, max-age=0, must-revalidate');
    reply.header('vary', 'Cookie');

    const scopes = (q.scope ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    const params = new URLSearchParams(q as Record<string, string>).toString();

    reply.type('text/html; charset=utf-8').send(`<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Install app</title>
<style>
 body{font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f6f7f9;margin:0;
      display:flex;min-height:100vh;align-items:center;justify-content:center;color:#111}
 .card{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:28px;max-width:460px;width:calc(100% - 32px)}
 h1{font-size:19px;margin:0 0 10px} p{color:#555;margin:0 0 14px}
 ul{color:#555;margin:0 0 18px;padding-left:20px} li{margin:3px 0;font-family:ui-monospace,monospace;font-size:12px}
 .who{background:#f3f4f6;border-radius:10px;padding:10px 12px;margin:0 0 18px;font-size:14px}
 .row{display:flex;gap:10px}
 button{font:inherit;border:0;border-radius:10px;padding:12px 16px;cursor:pointer;flex:1}
 .go{background:#070707;color:#fff;font-weight:600;border-radius:0;text-transform:uppercase;letter-spacing:.06em;font-size:12px;padding:15px 16px}
 .no{background:#fff;border:1px solid #d8dade;color:#444}
 .fl{display:block;text-align:left;font-size:12px;font-weight:600;color:#555;margin-bottom:10px}
 .fl input{width:100%;margin-top:5px;padding:10px 12px;border:1px solid #d8dade;border-radius:8px;font:inherit;box-sizing:border-box}
</style>
<div class="card">
  <h1>An app would like to access your store</h1>
  <p>Client <strong>${escapeHtml(q.client_id.slice(0, 24))}</strong> is requesting:</p>
  <ul>${scopes.length ? scopes.map((x) => `<li>${escapeHtml(x)}</li>`).join('') : '<li>(no scopes named)</li>'}</ul>
  ${account
    ? `<div class="who">Signed in as <strong>${escapeHtml(account.username)}</strong></div>`
    : ''}
  <form method="POST" action="${AUTHORIZE}?${escapeHtml(params)}">
    ${account ? '' : `
    <label class="fl">Email or username
      <input name="username" type="text" autocomplete="username" required autofocus>
    </label>
    <label class="fl">Password
      <input name="password" type="password" autocomplete="current-password" required>
    </label>`}
    <div class="row">
      <button class="no" name="approve" value="0" type="submit">Cancel</button>
      <button class="go" name="approve" value="1" type="submit">${account ? 'Install' : 'Sign in &amp; install'}</button>
    </div>
  </form>
</div>`);
  });

  app.post(AUTHORIZE, async (req, reply) => {
    const q = req.query as AuthorizeQuery;
    const body = (req.body ?? {}) as { approve?: string; username?: string; password?: string };
    if (!q.client_id || !q.redirect_uri) { reply.status(400).send({ error: 'invalid_request' }); return; }

    let back: URL;
    try { back = new URL(q.redirect_uri); } catch { reply.status(400).send({ error: 'invalid_request' }); return; }

    if (body.approve !== '1') {
      back.searchParams.set('error', 'access_denied');
      if (q.state) back.searchParams.set('state', q.state);
      reply.redirect(back.toString(), 302);
      return;
    }

    // Same rule as the Woo approval: THIS is the request that grants access, so
    // this is the one that must be authenticated.
    if (!adminSessionFrom(req)) {
      if (!body.username || !body.password) { reply.status(401).send({ error: 'access_denied' }); return; }
      try {
        const { authService } = await import('../../services/auth.service.js');
        const result = await authService.login({ username: body.username, password: body.password }, req.ip);
        if ('needsTwoFactor' in result && result.needsTwoFactor) { reply.status(401).send({ error: 'access_denied' }); return; }
      } catch {
        reply.status(401).send({ error: 'access_denied' });
        return;
      }
    }

    // NOT issued here. The secret is stored hashed and can never be read back,
    // so a credential minted now could not be handed over at the exchange. The
    // code carries the approved scope; the exchange mints and returns the
    // secret exactly once, which is also the only moment it exists in the clear.
    const scope: 'read' | 'read_write' = (q.scope ?? '').includes('write') ? 'read_write' : 'read';

    back.searchParams.set('code', signCode(q.client_id, scope));
    back.searchParams.set('shop', req.headers.host ?? '');
    if (q.state) back.searchParams.set('state', q.state);
    reply.redirect(back.toString(), 302);
  });

  /**
   * Exchange the code for the access token.
   *
   * The token IS the secret half of the store credential issued above, so the
   * Shopify bridge (`shopifyCompat.ts`) authenticates it with no extra
   * machinery and there is exactly one thing to revoke.
   */
  app.post(TOKEN, async (req, reply) => {
    const b = (req.body ?? {}) as { client_id?: string; client_secret?: string; code?: string };
    if (!b.code || !b.client_id) { reply.status(400).send({ error: 'invalid_request' }); return; }

    const parsed = readCode(b.code);
    if (!parsed) { reply.status(400).send({ error: 'invalid_grant' }); return; }
    // The code was minted for a specific app; another cannot redeem it.
    if (parsed.clientId !== b.client_id) { reply.status(400).send({ error: 'invalid_grant' }); return; }
    // Single use. A replayed code must not mint a second live token.
    if (spent.has(b.code)) { reply.status(400).send({ error: 'invalid_grant' }); return; }
    spent.add(b.code);

    const issued = await storeCredentials.issue(`Shopify app ${b.client_id.slice(0, 16)}`, parsed.scope);

    // The ONLY time this secret exists outside the hash.
    reply.send({
      access_token: issued.consumerSecret,
      scope: parsed.scope === 'read_write' ? 'write_products,write_orders' : 'read_products,read_orders',
    });
  });
}

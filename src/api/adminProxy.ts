import { connect } from 'node:net';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../lib/env.js';

// Admin reverse proxy — the whole product answers on ONE origin.
//
// The admin is a Next.js app (server components + server actions), so it must
// run as its own process; it listens on 127.0.0.1:ADMIN_UPSTREAM_PORT purely
// as an internal upstream. Everything under /tos-admin (the admin's Next
// `basePath`, which is why its assets and server-action posts all share this
// prefix) is forwarded here, so the only address anyone ever uses is this
// server's own origin.
//
// Bodies are streamed rather than buffered so a large plugin ZIP upload goes
// straight through. Redirects are passed back verbatim — following them here
// would rewrite the browser's URL to the upstream's.
//
// The Next dev HMR websocket (/tos-admin/_next/webpack-hmr) is tunnelled too.
// That is not a hot-reload nicety: the dev client blocks on that socket, so
// while the upgrade 404'd the runtime never finished and React never hydrated
// — the admin rendered correctly and every control on it was inert.

const PREFIX = '/tos-admin';

// Hop-by-hop headers must not be forwarded (RFC 9110 §7.6.1).
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length',
]);

// Helmet is registered on the root instance and writes through Express-style
// `res.setHeader`, so its headers land on admin responses too. Its default
// `script-src 'self'` blocks the inline `self.__next_f.push(...)` tags Next
// ships the RSC flight payload in, so React hydrates with nothing: the markup
// renders, and every control on every screen is dead HTML — including the
// login form, whose onSubmit never fires (symptom: you cannot sign in and the
// server records no failed attempt, because no request is ever made).
//
// The admin is a first-party Next app on its own prefix; it does not need
// helmet's page-level protections layered on top of Next's own. The public
// site and /api keep helmet's strict defaults — this hook is encapsulated to
// this plugin.
// Opting out is done through helmet's own per-route config, NOT by deleting
// its headers in an onSend hook: helmet writes through `reply.raw.setHeader`,
// and reaching into `reply.raw` from onSend makes Fastify believe the headers
// were already flushed — the next response then throws ERR_HTTP_HEADERS_SENT
// and takes the whole process down with it.
// `helmet: false` is @fastify/helmet's own per-route escape hatch, read by its
// onRoute hook (which rewrites it to config.helmet = { skipRoute: true }). It
// belongs at the TOP level of the route options — passing `config: { helmet:
// false }` directly does nothing, because the plugin never looks there. Not
// part of Fastify's base route-options type, hence the cast.
const NO_HELMET = { helmet: false } as unknown as { config: Record<string, unknown> };

export async function adminProxy(app: FastifyInstance): Promise<void> {
  const target = `http://127.0.0.1:${env.ADMIN_UPSTREAM_PORT}`;

  // Every request body must reach the admin as the exact bytes the browser
  // sent. Two things break otherwise, and both did:
  //   - the JSON parser consumed the stream, so login POSTed an empty body;
  //   - the multipart parser claimed Server Action posts, corrupting them
  //     ("Invalid Server Actions request" → white screen).
  // Dropping the inherited parsers first is what makes the catch-all actually
  // catch everything: a more specific parser (application/json,
  // multipart/form-data) otherwise still wins over '*'. Both calls are
  // encapsulated to this plugin, so the API's own parsing is untouched.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body);
  });

  const handler = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const url = target + req.url;

    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (HOP_BY_HOP.has(k.toLowerCase()) || v === undefined) continue;
      headers[k] = Array.isArray(v) ? v.join(', ') : String(v);
    }
    // Preserve the public host the browser actually used. Sending it as the
    // real Host (rather than only as X-Forwarded-Host) matters: Next compares
    // a Server Action's Origin against the forwarded host and rejects any
    // mismatch — including the case where a request carries no Origin at all,
    // which is what produced "Invalid Server Actions request" / white screen.
    // Keeping Host truthful means the common case simply agrees; next.config's
    // serverActions.allowedOrigins covers the rest.
    const publicHost = String(req.headers.host ?? '');
    if (publicHost) {
      headers['host'] = publicHost;
      headers['x-forwarded-host'] = publicHost;
    }
    headers['x-forwarded-proto'] = req.protocol;

    // Body shape depends on which parser claimed it: the catch-all below
    // yields a Buffer, but a more specific parser registered on the ROOT
    // instance (application/json) still wins and yields a parsed object —
    // which is why this has to handle both. Forwarding only the Buffer case
    // silently sent empty POSTs (login failed with "could not reach server").
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    let body: Buffer | string | undefined;
    if (hasBody && req.body !== undefined && req.body !== null) {
      if (Buffer.isBuffer(req.body)) body = req.body;
      else if (typeof req.body === 'string') body = req.body;
      else body = JSON.stringify(req.body);
    }
    let res: Response;
    try {
      res = await fetch(url, {
        method: req.method,
        headers,
        body,
        redirect: 'manual',
      } as RequestInit);
    } catch (e) {
      reply
        .status(502)
        .type('text/plain')
        .send(
          `Admin app is not reachable on ${target}.\n\n` +
            `Start it with:  npm --prefix admin run dev\n\n` +
            `(${e instanceof Error ? e.message : String(e)})`,
        );
      return;
    }

    reply.status(res.status);
    res.headers.forEach((value, key) => {
      const k = key.toLowerCase();
      if (HOP_BY_HOP.has(k) || k === 'content-encoding') return;
      // set-cookie can repeat; undici exposes them via getSetCookie().
      if (k === 'set-cookie') return;
      reply.header(key, value);
    });
    const cookies = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    if (cookies.length) reply.header('set-cookie', cookies);

    const buf = Buffer.from(await res.arrayBuffer());
    reply.send(buf);
  };

  // Bare /tos-admin plus everything beneath it.
  app.all(PREFIX, NO_HELMET, handler);
  app.all(`${PREFIX}/*`, NO_HELMET, handler);

  // WebSocket upgrades can't go through a route handler — they leave the HTTP
  // request/response model entirely — so they're bridged at the raw server as
  // two piped sockets. Only /tos-admin upgrades are claimed; anything else is
  // left alone for other listeners (or Node's default, which closes it).
  app.addHook('onReady', async () => {
    app.server.on('upgrade', (req, socket, head) => {
      const url = req.url ?? '';
      if (url !== PREFIX && !url.startsWith(`${PREFIX}/`)) return;

      const upstream = connect(env.ADMIN_UPSTREAM_PORT, '127.0.0.1', () => {
        // Replay the upgrade request verbatim from rawHeaders, which keeps the
        // original order and casing — Sec-WebSocket-Key et al must survive
        // untouched for the handshake to be accepted.
        const lines = [`${req.method} ${url} HTTP/1.1`];
        for (let i = 0; i < req.rawHeaders.length; i += 2) {
          lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
        }
        upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
        if (head?.length) upstream.write(head);
        upstream.pipe(socket);
        socket.pipe(upstream);
      });

      upstream.on('error', () => socket.destroy());
      socket.on('error', () => upstream.destroy());
    });
  });
}

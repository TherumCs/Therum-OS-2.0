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
// Not proxied: the Next dev HMR websocket (/tos-admin/_next/webpack-hmr).
// Hot-reload therefore doesn't tunnel through this origin in dev; the admin
// itself works fine, it just won't live-reload unless opened directly.

const PREFIX = '/tos-admin';

// Hop-by-hop headers must not be forwarded (RFC 9110 §7.6.1).
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length',
]);

export async function adminProxy(app: FastifyInstance): Promise<void> {
  const target = `http://127.0.0.1:${env.ADMIN_UPSTREAM_PORT}`;

  // Take every request body as an untouched Buffer. Without this the server's
  // JSON parser consumes the stream first and the proxy forwards an empty
  // body (login POSTs 502'd). Encapsulated to this plugin, so the API's own
  // parsers are unaffected. Buffering (not streaming) is fine here: the
  // largest thing that comes through is a plugin ZIP, already capped by the
  // multipart limit.
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
    // Let the admin build correct absolute URLs for redirects/actions.
    headers['x-forwarded-host'] = String(req.headers.host ?? '');
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
  app.all(PREFIX, handler);
  app.all(`${PREFIX}/*`, handler);
}

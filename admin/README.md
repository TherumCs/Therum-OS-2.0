# Admin console (`therum-cms-admin`)

The operator console for Therum CMS 2.0 — products, orders, payments, content,
settings. Next.js 16 (App Router) + React 19. Served at `/tos-admin` behind
login. Part of the [Therum CMS 2.0](../README.md) product; not a standalone app.

## How it fits

- **Auth gate:** `proxy.ts` (Next's middleware) redirects every route to
  `/login` without a valid session cookie. `/login` and `/api/auth/*` are the
  only public paths.
- **Talks to the backend over HTTP, never imports it.** Server components and
  route handlers call the Fastify API through one chokepoint, `lib/api.ts`,
  which attaches the logged-in operator's own session token as a Bearer. The
  browser never holds a backend token.
- **`JWT_SECRET` must equal the backend's** (see `ecosystem.config.cjs`, which
  makes the admin inherit the API's env) — a mismatch fails every login at
  signature verification.

## Develop

```bash
npm install
npm run dev     # http://localhost:3100  (expects the backend on :4100)
```

`.env` here inherits the backend's and may override. In production the admin
binds `127.0.0.1:3100` and nginx is the only thing that reaches it.

## Deploy note

Build **before** reloading the process — `pm2 reload` on a half-built `.next`
serves a "no production build" error. See [../DEPLOY.md](../DEPLOY.md).

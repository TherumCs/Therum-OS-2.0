import path from 'node:path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // admin/'s own globals.css reaches up to ../../shared/therum-tokens.css
  // (the token file shared with builder/), so root can't be admin/ itself —
  // therum-cms-2/ is the real common root. Set explicitly (matches what
  // Turbopack already inferred) only to silence its "detected multiple
  // lockfiles, guessing" warning — same behavior either way.
  turbopack: {
    root: path.join(import.meta.dirname, '..'),
  },
  // Not WordPress — the admin lives at its own path instead of bare "/" so it
  // never inherits wp-admin-shaped assumptions from tooling built around this
  // site's old WordPress install (Local by Flywheel, browser history, etc).
  // Keep in sync with admin/lib/session.ts's BASE_PATH and the nginx location
  // block that proxies this prefix through to this app (conf/nginx/site.conf.hbs).
  basePath: '/tos-admin',
  // The admin is always reached through the API server's origin (localhost:10009),
  // never on its own :3100 — so from `next dev`'s point of view every request for
  // a dev resource is cross-origin, and it blocks them by default. That block is
  // silent in the browser: the page still server-renders and looks correct, but
  // the dev runtime never finishes, React never hydrates, and every control in
  // the admin is dead HTML — pills, sort, search, kebabs, toggles, uploads.
  // Listing the hosts we are actually served on is Next's supported fix.
  allowedDevOrigins: ['localhost', '127.0.0.1', 'localhost:10009', '127.0.0.1:10009'],
  // test/http-auth-e2e.test.mjs spawns a real `next dev` to exercise the
  // basePath+matcher interaction end to end. It sets this so that server
  // lands in its own directory instead of clobbering `.next` out from under
  // a `next start`/`next dev` you might already have running there. Unset
  // otherwise.
  ...(process.env.NEXT_E2E_DIST_DIR ? { distDir: process.env.NEXT_E2E_DIST_DIR } : {}),
  experimental: {
    // This app is reached through the API server's reverse proxy (see
    // src/api/adminProxy.ts), so a Server Action's request arrives with a
    // Host of the internal upstream while its Origin is the public one.
    // Next rejects that mismatch as CSRF ("Invalid Server Actions request",
    // which rendered as a white screen). Naming the real public origin here
    // is Next's supported way to describe exactly this topology.
    serverActions: {
      allowedOrigins: [
        'localhost:10009',
        '127.0.0.1:10009',
        ...(process.env.ADMIN_ALLOWED_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean) ?? []),
      ],
    },
  },
};

export default nextConfig;

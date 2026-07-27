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
  // test/http-auth-e2e.test.mjs spawns a real `next dev` to exercise the
  // basePath+matcher interaction end to end. It sets this so that server
  // lands in its own directory instead of clobbering `.next` out from under
  // a `next start`/`next dev` you might already have running there. Unset
  // otherwise.
  ...(process.env.NEXT_E2E_DIST_DIR ? { distDir: process.env.NEXT_E2E_DIST_DIR } : {}),
};

export default nextConfig;

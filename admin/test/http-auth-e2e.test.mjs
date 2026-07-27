// HTTP-level regression test built around a real auth bug found (and fixed)
// live: middleware.ts's `config.matcher` didn't cover the bare basePath root.
// Next.js prepends `basePath` to matcher patterns *inside its own request
// router*, before middleware.ts's exported function is ever invoked — that
// resolution isn't reachable by importing and calling the function directly,
// only by a real server handling a real request. So this spins up the REAL
// backend (a real TCP listener, not app.inject()) and a REAL Next.js server
// (`next dev`, on an isolated port + distDir — see next.config.mjs's
// NEXT_E2E_DIST_DIR) as a subprocess, then hits both with real fetch() calls.
// `next dev` rather than `next build && next start`: the matcher/basePath
// resolution being tested is shared routing logic, not a prod-only code
// path, and a cold `next build` currently fails on unrelated static-export
// errors on /import and /settings (a pre-existing bug — see the follow-up
// task, not this one). Slower than a unit test either way, but it's the
// only thing that would have actually caught this.
//
// The 3rd test below also covers the full login -> dashboard -> logout ->
// dashboard cycle end to end, since a related bug was fixed alongside the
// matcher (logout's cookie-clearing call was missing `path: '/'`). Verified
// empirically during this test's own development, though: in the installed
// Next 14.2.35, ResponseCookies normalizes a missing `path` to '/'
// unconditionally (see next/dist/compiled/@edge-runtime/cookies — delete()
// -> set() -> normalizeCookie()), so `.delete(COOKIE_NAME)` and
// `.delete({name, path:'/'})` emit byte-identical Set-Cookie output here —
// reverting that one line does NOT turn this test red. The cycle test still
// covers the real end-to-end flow (wrong cookie name, backend auth breaking,
// wrong status codes, etc.) and is worth keeping, but it does not by itself
// prove the originally-diagnosed path-mismatch mechanism — see the CookieJar
// comment below and the summary this was flagged with.
//
// Requires: docker compose up -d (postgres :5433, redis :6380 — see
// ../../docker-compose.yml) and a fresh `npm run build` in the backend
// (../../dist) — same prerequisites as ../../test/auth.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(ADMIN_ROOT, '..');

const BASE_PATH = '/tos-admin';
const BACKEND_PORT = 4199;
const ADMIN_PORT = 3199;
const BACKEND_ORIGIN = `http://127.0.0.1:${BACKEND_PORT}`;
const ADMIN_ORIGIN = `http://127.0.0.1:${ADMIN_PORT}`;

// admin's own test script only loads admin/.env.local (JWT_SECRET, API_URL).
// The backend module imported below also needs DATABASE_URL/REDIS_URL from
// the backend's own ../../.env — load those in without clobbering anything
// admin's env already set (e.g. JWT_SECRET must stay the one both share).
function loadEnvFile(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const [, key, rawVal] = m;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawVal.replace(/^['"]|['"]$/g, '');
  }
}
loadEnvFile(path.join(REPO_ROOT, '.env'));

// Static `import` is hoisted above the loadEnvFile() call above, but
// dist/lib/env.js validates process.env as soon as it's imported — so these
// have to be dynamic imports, run after the env is actually in place.
const { buildServer } = await import('../../dist/server.js');
const { importQueue } = await import('../../dist/lib/queue.js');
const { db, disconnectDb } = await import('../../dist/lib/db.js');
const { disconnectRedis } = await import('../../dist/lib/redis.js');
const { hashPassword } = await import('../../dist/lib/password.js');

// Minimal RFC 6265 path-scoped cookie jar — Node's fetch() has no cookie jar
// of its own, and a real browser scopes cookies by path across requests, so
// a jar that ignored paths wouldn't faithfully simulate the login/logout
// cycle below.
class CookieJar {
  #store = new Map(); // `${name}\0${cookiePath}` -> value

  apply(setCookieHeaders, requestPath) {
    for (const raw of setCookieHeaders ?? []) {
      const [pair, ...attrs] = raw.split(';').map((s) => s.trim());
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      let cookiePath;
      let expired = value === '';
      for (const attr of attrs) {
        const sep = attr.indexOf('=');
        const ak = (sep === -1 ? attr : attr.slice(0, sep)).toLowerCase();
        const av = sep === -1 ? '' : attr.slice(sep + 1);
        if (ak === 'path') cookiePath = av;
        else if (ak === 'max-age' && Number(av) <= 0) expired = true;
        else if (ak === 'expires' && new Date(av).getTime() <= Date.now()) expired = true;
      }
      // RFC 6265 §5.1.4 default-path (request's own "directory", not '/'),
      // for completeness — in practice Next's ResponseCookies always writes
      // an explicit Path itself (see the file header), so this branch isn't
      // expected to trigger against this app, but a jar that got it wrong
      // wouldn't be trustworthy for anything else either.
      if (cookiePath === undefined) {
        const idx = requestPath.lastIndexOf('/');
        cookiePath = idx <= 0 ? '/' : requestPath.slice(0, idx);
      }
      const key = `${name}\0${cookiePath}`;
      if (expired) this.#store.delete(key);
      else this.#store.set(key, value);
    }
  }

  header(requestPath) {
    const pairs = [];
    for (const [key, value] of this.#store) {
      const sep = key.indexOf('\0');
      const cookiePath = key.slice(sep + 1);
      const matches =
        requestPath === cookiePath ||
        (requestPath.startsWith(cookiePath) && (cookiePath.endsWith('/') || requestPath[cookiePath.length] === '/'));
      if (matches) pairs.push(`${key.slice(0, sep)}=${value}`);
    }
    return pairs.join('; ');
  }
}

function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return (async function poll() {
    for (;;) {
      try {
        await fetch(url, { redirect: 'manual' });
        return;
      } catch (err) {
        if (Date.now() > deadline) throw new Error(`Timed out waiting for ${url}: ${err.message}`);
        await new Promise((r) => setTimeout(r, 300));
      }
    }
  })();
}

let backend;
let nextProc;
const testUsername = 'it-http-' + Math.random().toString(36).slice(2, 8);
const testPassword = 'correct-horse-battery-staple';

before(
  async () => {
    backend = await buildServer();
    await backend.listen({ port: BACKEND_PORT, host: '127.0.0.1' });
    await db.adminUser.create({ data: { username: testUsername, passwordHash: await hashPassword(testPassword) } });

    const nextBin = path.join(ADMIN_ROOT, 'node_modules', '.bin', 'next');
    const childEnv = {
      ...process.env,
      API_URL: BACKEND_ORIGIN,
      // Isolates this dev server's build output from .next so it doesn't
      // clobber whatever's currently running against the default directory
      // (a `next start`/`next dev` sharing that dir mid-flight can crash —
      // confirmed the hard way) — see next.config.mjs.
      NEXT_E2E_DIST_DIR: '.next-test',
      NEXT_TELEMETRY_DISABLED: '1',
    };

    let nextOutput = '';
    nextProc = spawn(nextBin, ['dev', '-p', String(ADMIN_PORT)], { cwd: ADMIN_ROOT, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    nextProc.stdout.on('data', (d) => (nextOutput += d));
    nextProc.stderr.on('data', (d) => (nextOutput += d));

    try {
      // First request pays next dev's on-demand compile cost for that route.
      await waitForServer(`${ADMIN_ORIGIN}${BASE_PATH}/login`, 60_000);
    } catch (err) {
      throw new Error(`${err.message}\n--- next dev output ---\n${nextOutput}`);
    }
  },
  { timeout: 120_000 },
);

after(
  async () => {
    if (nextProc) {
      nextProc.kill('SIGTERM');
      await Promise.race([new Promise((r) => nextProc.once('exit', r)), new Promise((r) => setTimeout(r, 5000)).then(() => nextProc.kill('SIGKILL'))]);
    }
    await db.adminUser.deleteMany({ where: { username: testUsername } });
    if (backend) await backend.close();
    await importQueue.close();
    // Matches src/server.ts's own shutdown order — without this, the lazy,
    // persistent ioredis connection (see dist/lib/redis.js) stays open and
    // the process never exits on its own.
    await disconnectRedis();
    await disconnectDb();
  },
  { timeout: 30_000 },
);

test('unauthenticated bare basePath root redirects to login, not 200 (the actual bug)', async () => {
  const res = await fetch(`${ADMIN_ORIGIN}${BASE_PATH}`, { redirect: 'manual' });
  assert.equal(res.status, 307, `expected a redirect — got ${res.status}. If this is 200, the whole dashboard is unauthenticated.`);
  const location = new URL(res.headers.get('location'), ADMIN_ORIGIN);
  assert.equal(location.pathname, `${BASE_PATH}/login`);
});

test('unauthenticated nested path also redirects to login (this one always worked — lock it in)', async () => {
  const res = await fetch(`${ADMIN_ORIGIN}${BASE_PATH}/products`, { redirect: 'manual' });
  assert.equal(res.status, 307);
  const location = new URL(res.headers.get('location'), ADMIN_ORIGIN);
  assert.equal(location.pathname, `${BASE_PATH}/login`);
});

test('login -> dashboard (200) -> logout -> dashboard (redirect again, not 200)', async () => {
  const jar = new CookieJar();

  const loginPath = `${BASE_PATH}/api/auth/login`;
  const loginRes = await fetch(`${ADMIN_ORIGIN}${loginPath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: testUsername, password: testPassword }),
    redirect: 'manual',
  });
  assert.equal(loginRes.status, 200, await loginRes.text());
  jar.apply(loginRes.headers.getSetCookie(), loginPath);

  const dash1 = await fetch(`${ADMIN_ORIGIN}${BASE_PATH}`, { headers: { cookie: jar.header(BASE_PATH) }, redirect: 'manual' });
  assert.equal(dash1.status, 200, 'a valid session cookie should reach the dashboard');

  const logoutPath = `${BASE_PATH}/api/auth/logout`;
  const logoutRes = await fetch(`${ADMIN_ORIGIN}${logoutPath}`, { method: 'POST', headers: { cookie: jar.header(logoutPath) }, redirect: 'manual' });
  assert.equal(logoutRes.status, 200);
  jar.apply(logoutRes.headers.getSetCookie(), logoutPath);

  const dash2 = await fetch(`${ADMIN_ORIGIN}${BASE_PATH}`, { headers: { cookie: jar.header(BASE_PATH) }, redirect: 'manual' });
  assert.equal(dash2.status, 307, "logout must actually clear the session — a still-valid cookie means logout silently no-op'd");
});

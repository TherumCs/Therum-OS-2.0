// PM2 process config for the Therum CMS 2.0 backend (Ubuntu 24 VPS).
// Deploy: npm ci && npm run build && pm2 start ecosystem.config.cjs
//
// The env is read HERE rather than passed as `node_args: '--env-file=.env'`.
// PM2's cluster bootstrap replaces the interpreter arguments it spawns workers
// with, so that flag never reached Node: the API came up "online" with zero
// restarts, zero log output, and nothing listening on its port — which looks
// like a healthy process right up until you curl it. Reading the file here and
// handing PM2 a plain env object works in fork and cluster mode alike.
//
// The .env files stay mode 600 and stay out of git; this only reads them at
// start time, on the box, as the user that already owns them.
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

/** Parse KEY=VALUE lines. Quotes stripped, `#` comments and blanks skipped. */
function envFile(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    // Missing is not fatal: `pm2 start` on a half-provisioned box should fail
    // with the app's own "DATABASE_URL is required" rather than a stack trace
    // from this config.
    return {};
  }
  const out = {};
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let value = t.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const root = __dirname;
const apiEnv = { NODE_ENV: 'production', ...envFile(join(root, '.env')) };
// The admin needs JWT_SECRET to match the API's exactly or every login fails
// signature verification. Its own file wins, so a deliberate override still
// works, but it inherits rather than silently diverging.
const adminEnv = { NODE_ENV: 'production', ...apiEnv, ...envFile(join(root, 'admin/.env')) };

module.exports = {
  apps: [
    {
      name: 'therum-cms-api',
      script: 'dist/main.js',
      instances: 'max',
      exec_mode: 'cluster',
      max_memory_restart: '400M',
      env: apiEnv,
    },
    {
      name: 'therum-cms-worker',
      script: 'dist/worker.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '300M',
      env: apiEnv,
    },
    // The admin (Next.js) runs as its own process; Postgres + Redis are managed
    // services (systemd / docker), not PM2 apps.
    {
      name: 'therum-cms-admin',
      cwd: './admin',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3100',
      instances: 1,
      exec_mode: 'fork',
      env: adminEnv,
    },
  ],
};

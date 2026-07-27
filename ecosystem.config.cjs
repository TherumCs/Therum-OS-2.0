// PM2 process config for the Therum CMS 2.0 backend (Ubuntu 24 VPS).
// Deploy: npm ci && npm run build && pm2 start ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'therum-cms-api',
      script: 'dist/server.js',
      node_args: '--env-file=.env',
      instances: 'max',
      exec_mode: 'cluster',
      max_memory_restart: '400M',
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'therum-cms-worker',
      script: 'dist/worker.js',
      node_args: '--env-file=.env',
      instances: 1,
      max_memory_restart: '300M',
      env: { NODE_ENV: 'production' },
    },
    // The admin (Next.js) runs as its own process; Postgres + Redis are managed
    // services (systemd / docker), not PM2 apps.
    {
      name: 'therum-cms-admin',
      cwd: './admin',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3100',
      instances: 1,
      env: { NODE_ENV: 'production' },
    },
  ],
};

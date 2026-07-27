# Therum CMS 2.0 — Deploy (Ubuntu 24 VPS)

## Services
- **PostgreSQL 15+** and **Redis 7** — managed (apt/systemd or Docker). Not PM2 apps.
- **API** (Fastify) — PM2 cluster on :4100.
- **Admin** (Next.js) — PM2 on :3100.
- **nginx** — reverse proxy + TLS (certbot).

## Steps
```bash
# 1. Code + deps
git clone <repo> && cd therum-cms-2
npm ci && npm run build
(cd admin && npm ci && npm run build)

# 2. Env (never commit .env)
cp .env.example .env
#   set DATABASE_URL, REDIS_URL, JWT_SECRET (openssl rand -hex 32), WEBHOOK_SECRET

# 3. Database
npx prisma migrate deploy      # applies migrations (reversible; each has up/down)
npm run seed                   # optional first-run data

# 4. Run under PM2
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup        # survive reboots (systemd)

# 5. nginx
sudo cp deploy/nginx.conf /etc/nginx/sites-available/therum-cms
sudo ln -s /etc/nginx/sites-available/therum-cms /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d api.therum.example -d admin.therum.example
```

## Rolling deploy / rollback
- `pm2 reload therum-cms-api` — 0-downtime reload (cluster).
- Migrations are reversible (`prisma migrate resolve` / keep `down`s); test rollback in staging before prod.
- Rollback code: `git checkout <prev-tag> && npm ci && npm run build && pm2 reload all`.

## Health & observability
- `GET /health` → `{status, db}` (use for the load balancer check).
- pino JSON logs to stdout → ship to your log stack (every request has a reqId).

## Hardening checklist (pairs with the 1.9.44 VPS layer)
- Lock the admin host (`admin.therum.example`) behind IP allowlist / SSO at nginx.
- Set a strong `JWT_SECRET` + `WEBHOOK_SECRET`; rotate periodically.
- Postgres: least-priv role, not `root`; Redis: `requirepass` + bind localhost.
- Firewall: only 80/443 public; 4100/3100/5432/6379 localhost-only.

## Still to wire (declared, not faked)
- BullMQ worker process for large async imports (the import service core is done + tested; add a `worker.js` PM2 app that drains the queue).
- True VM/worker sandbox for third-party extension JS (current extensions are manifest + in-process providers + isolated error handling).

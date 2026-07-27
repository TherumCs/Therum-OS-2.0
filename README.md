# Therum CMS 2.0 — Backend

Ground-up rebuild of Therum OS. Node 20+ / TypeScript / Fastify / PostgreSQL (Prisma) / Redis.
Data shape is the source of truth: `prisma/schema.prisma` defines Product, Vendor, Order, Customer, Extension.

## Phase 1 (this slice)
- Prisma schema for all five core entities (money in integer minor units; `sourceId` for idempotent imports).
- Fastify server + JWT auth middleware + structured error handler.
- Product routes (`/api/products` GET/POST/PATCH/DELETE) + product service (cursor pagination, slug conflicts).

## Run it
```bash
cp .env.example .env            # then set a real JWT_SECRET for non-dev
npm install
npm run db:up                   # Postgres :5433 + Redis :6380 via Docker
npm run prisma:migrate          # creates tables (name it: init)
npm run dev                     # http://localhost:4100
```

Health: `curl localhost:4100/health`
List: `curl localhost:4100/api/products`
Create (needs a JWT signed with JWT_SECRET, role admin):
```bash
curl -X POST localhost:4100/api/products -H "authorization: Bearer <jwt>" \
  -H 'content-type: application/json' \
  -d '{"name":"Test","variants":[{"price":1999}]}'
```

## Discipline
- Every route parses input with Zod before touching the DB.
- Every error is `{ error: { code, message, field?, details? } }`.
- Money is integer cents. Orders are atomic (Phase 2). Extensions hook services, not routes.

## Next
Phase 2 — Order state machine + inventory lock + payment webhook receiver.

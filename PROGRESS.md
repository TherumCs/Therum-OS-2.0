# Therum CMS 2.0 — Build Progress / Resume Checkpoint

> Live checkpoint to resume after the session-limit reset (~9:20pm ET, 2026-06-22).
> Repo: `/Users/bam/Local Sites/therum-os/therum-cms-2`

## The section-by-section port list (01–12)
Rendered as an Artifact (2026-07-07), not saved as a file at the time — recovered once from the raw
session transcript after it scrolled out of context, so pointing at it here to save that trip next time:
**"Therum OS 1.9.44 → CMS 2.0 — Feature Inventory"** —
`https://claude.ai/code/artifact/c321c86d-9d08-4096-b71b-57431cfbb105`

01 Content & editing · 02 Media · 03 SEO engine · 04 Design system (brand tokens) · **05 Chrome &
Customization Studio** (Quick Controls panel + per-user Behavior/Advanced tabs — DONE, see
CHANGELOG.md workstream 7; theme store & saved themes deliberately deferred per direction, public-
site motion layer still blocked on no public theme/renderer existing) · **06 Auth & access**
(login skin + custom roles from capability bundles — DONE, see CHANGELOG.md workstream 8; also
found+fixed a real live bug where 2FA silently broke login; 2FA itself and API tokens were
already built, confirmed as parity not new work) · **07 Connections hub (Nexus)** — React/2.0 flavor
DONE, see CHANGELOG.md workstreams 11+12: new "Studio Apps" registry (3rd concept, distinct from
Foundations/Capabilities) + Nexus as its first app; real 5-category, 63-provider catalog; AES-256-GCM
encryption at rest, masked-only round-trip; **29 real live testers** (of 63 — the rest are
storage-only, honestly, not faked); vault + audit log; **real OAuth authorization-code flow**
(Slack/Google Drive/GitHub, admin-configured app credentials, stateless signed CSRF); **real webhook
signature verification** (GitHub/Stripe/Slack — a configured secret that fails verification is
rejected, not just logged). Per-provider webhook *business logic* for all 63, and live testers for
the remaining 34, are real incremental follow-up, not one closeable task — each is its own small
integration. **WordPress-plugin flavor of Nexus is separate, queued next, not started.** ·
**08 MCP server & job queue** (JSON-RPC 2.0 `/api/mcp` with
2 real tools — `get_preview_url`, `check_queue_status` — DONE, see CHANGELOG.md workstream 10; 5 of
the inventory's 8 spec'd tools skipped by explicit user choice since they need subsystems 2.0
doesn't have yet — build pipeline, theme-store, token-mining — added back as those land; pub/sub
event bus confirmed dead, not ported) · **09 Settings & ops** (404 monitor + real redirect
enforcement, backup zip/S3, real email+Slack notifications, Find&Replace confirmed, Performance's
11 toggles + cache-busting honestly flagged N/A — DONE, see CHANGELOG.md workstream 9; the
inventory's own "mostly already done" framing was wrong for 5 of 6 sub-items, caught by audit
rather than assumed) · **10 Onboarding wizard** (strict binary `/login` gate — no account → setup
only, account exists → sign-in only, no tab-switcher either way — plus a separate post-setup
in-app wizard: edition → connections → branding → finish, skippable/resumable from the dashboard —
DONE, see CHANGELOG.md workstream 9) · 11 Dead ends (nothing to do) · 12 Deferred —
WordPress/Bricks/WooCommerce (explicitly parked, not lost).

01–10 built and verified this session (Content&Editing, Media, SEO, Design System, Chrome &
Customization Studio minus themes, Auth & access, Nexus/Connections hub, MCP & job queue, Settings &
ops, Onboarding). Every "port now" section from the inventory is done for the React/2.0 side. What's
left: Nexus's WordPress-plugin flavor (separate codebase, not started), plus real follow-up work
flagged honestly rather than built — OAuth flow, per-provider webhook logic, and live testers for the
~51 providers that only have storage today. Known adjacent gap: no
multi-admin invite/creation flow exists yet — the new role system has nowhere to assign a role to
beyond the original account without one (see CHANGELOG workstream 8's "Explicitly flagged").

## TL;DR
Phase 1 (Foundation) + Phase 2 (Commerce) backend are **DONE and VERIFIED LIVE against real Postgres** (2026-06-23). Order create + atomic inventory reservation, idempotency, state-machine confirm (reserve→sale), oversell guard (409), and the HMAC payment webhook (→ markPaid → transition; forged sig → 401) all proven end-to-end. Docker containers are left UP for next session. **Next: Phase 3 — the React/Vite builder.**

## DONE ✅ + VERIFIED
**Phase 1 — Foundation**
- Scaffold: package.json, tsconfig (strict, noUncheckedIndexedAccess), .gitignore, .env.example, docker-compose.yml, README.
- `prisma/schema.prisma` — Product, ProductVariant, Vendor, Order, OrderItem, Payment, Customer, Address, Extension. Money = integer cents. `sourceId` for idempotent imports. Enums for every state machine.
- lib/: env (Zod fail-fast), errors (AppError + subclasses), logger (pino), db (Prisma singleton), redis (lazy), webhook (HMAC verify).
- middleware/: errorHandler (one place → `{error:{code,message,field?,details?}}`), auth (@fastify/jwt + `app.authenticate`).
- Product slice: schema + service (cursor pagination, slug conflict) + routes (GET/POST/PATCH/DELETE).

**Phase 2 — Commerce**
- Order: schema + service (atomic create with **guarded inventory reservation** via raw `UPDATE ... WHERE inventory - reserved >= qty`, idempotencyKey dedupe, state-machine `transition()` with reserve→confirm→release/restock inventory effects, `markPaid`) + routes.
- Customer slice: schema + service + routes.
- Payment webhook receiver: HMAC-SHA256 (constant-time) over raw body, idempotent markPaid, `/api/webhooks/:provider`.
- server.ts: helmet + cors + jwt + raw-body parser + structured 404 + /health + graceful shutdown; registers products/orders/customers/webhooks under `/api`.

**Verified (commands actually run):**
- `npm install` ✓ · `npx prisma generate` ✓ · `npm run build` (tsc) ✓ · `tsc --noEmit` CLEAN ✓
- Server boots; `/health` → `{status:degraded, db:false}` ✓ · 404 → structured ✓
- Minted JWT accepted; **auth → Zod → structured 422** proven (bad body returns field+details) ✓
- POST without JWT → 401 structured ✓ · DB-down query → caught, no crash ✓

## VERIFIED LIVE ✅ (2026-06-23, real Postgres in Docker)
- migrate `20260623104015_init` applied; seed = House Brand vendor + Starter Tee (3 variants) + demo customer.
- `/health` → `{status:ok, db:true}`; `GET /api/products` returns seeded data.
- Order TEE-M×2 → 201 pending, total 3998¢; variant reserved 0→2.
- Idempotency: re-POST same key → SAME order, reserved stays 2 (no dupe).
- Transition → processing: inventory 40→38, reserved 2→0 (atomic confirm).
- Oversell TEE-L×9999 → 409 "Insufficient stock".
- Webhook (valid HMAC) → order processing, payment paid, txn stored; forged sig → 401.
- Containers left UP (`docker compose ps` to confirm); just `npm start` to resume the API.

## RESUME — one paste once Docker Desktop is running
```bash
cd "/Users/bam/Local Sites/therum-os/therum-cms-2"
# 1) Make sure Docker Desktop app is open and fully started, then:
docker info >/dev/null 2>&1 && echo "docker ok" || echo "open Docker Desktop first"
docker compose up -d                       # postgres :5433 + redis :6380
[ -f .env ] || cp .env.example .env
npx prisma migrate dev --name init         # creates tables
npm run build && npm run seed              # seeds vendor + product(3 variants) + customer
npm start &                                # boots :4100  (node --env-file=.env dist/server.js)
sleep 3
curl -s localhost:4100/health                                  # expect status:ok, db:true
curl -s localhost:4100/api/products | head -c 400              # expect the seeded Starter Tee
JWT=$(npm run -s mint-jwt admin)
# create an order for variant TEE-M (look up its id from the products response), e.g.:
# curl -s -X POST localhost:4100/api/orders -H 'content-type: application/json' \
#   -d '{"items":[{"variantId":"<TEE-M id>","quantity":2}],"idempotencyKey":"demo-1"}'
```
Expected on success: order created `pending`, variant `reserved` +2; re-POST same idempotencyKey returns the SAME order (no dupe); transition to `processing` decrements inventory.

## PHASE 3 — Builder ✅ (build-verified)
`builder/` — Vite 8 + React 19 + Zustand. Canvas (live selectable render), schema-driven Inspector, Layers tree (move/delete), palette (section/container/heading/text/button/image/productList), undo/redo, serialize→HTML export, productList binds REAL products from the API (proxy /api → :4100). `npm run build` passes (tsc -b + vite). Run: `cd builder && npm run dev` (port 5174) with the API up.

## PHASE 4a — Extensions backend ✅ (verified live)
`src/lib/hooks.ts` (isolated hook bus: throwing handler caught+logged+marks unhealthy, op continues), `src/services/extension.service.ts` (manifest-validated register/enable/disable/remove, in-process providers, bootWire on start), `src/schemas/extension.schema.ts` (Zod manifest + permissions enum + HOOK_POINTS), `src/api/routes/extensions.ts`. Services fire `onProductCreate` / `onOrderCreate` / `onOrderPaid`. Verified: register/list/toggle work; bad permission → 422. (Third-party JS-package loading + VM sandbox = declared Phase 6 hardening, not faked.)

## PHASE 4b — Admin (Next.js) ✅ (build-verified)
`admin/` — Next.js 14 App Router. Overview (live counts), Products (list + create via Server Action), Orders (list + state transitions), Extensions (list + enable/disable), Import (CSV detect/preview). Server-side JWT minting → calls the API. `next build` passes all 8 routes.

## PHASE 5 — Importer ✅ (verified live)
`src/services/import.service.ts` + `src/schemas/import.schema.ts` + `src/api/routes/import.ts`. Detect/map/run, dry-run default, idempotent by (vendorId, sourceId), partial-failure tolerant (log+skip+continue), audit summary, fires onImport* hooks. Verified: dry-run (no persist), real import created:2, re-run updated:2 (no dupes), bad row → skipped:1 + error. Fixed a real bug: empty price → invalid (was becoming $0).

## PHASE 6 — Polish & Deploy ✅
`ecosystem.config.cjs` (PM2 cluster: api + admin), `deploy/nginx.conf` (reverse proxy + security headers), `DEPLOY.md` (full Ubuntu 24 runbook + rollback), `test/webhook.test.mjs` (node:test, 2 pass). `npm test` green.

## POST-P6 additions ✅ (verified live)
- **BullMQ async import worker**: `src/lib/queue.ts` + `src/worker.ts` + routes `POST /api/import/async` (202 + jobId) and `GET /api/import/jobs/:id` (state + audit). PM2 app `therum-cms-worker` added. Verified: enqueue → worker drains → poll → completed with audit (partial-failure carried through). Run: `node --env-file=.env dist/worker.js`.
- **Integration tests**: `test/integration.test.mjs` (Fastify inject() over buildServer; server.ts guards `main()` to entry-point only). `npm test` = **9/9 pass** (health, auth, product, order reserve+idempotency+total, oversell 409, webhook bad/valid+markPaid, extension+bad-perm 422, + 2 HMAC unit). Needs DB up + `--env-file`.

## ARCHITECTURE — Foundations × Capabilities (verified live)
Two axes, both surfaced in admin **Studio**:
- **Foundations** (how/where you build): `native` (Therum OS Pure base, always on), `bricks` (toggleable add-on), `wordpress` (planned). `GET/PATCH /api/foundations`. Guards: can't disable native, can't enable planned. Bricks is now a self-contained **builder extension** (`builder/src/extensions/bricks/`, matching the Counter/Nexus/Cluster/Milieus ecosystem-plugin pattern) — not baked into core Toolbar.tsx. `useEnabledExtensions()` resolves against the foundation flag; the core builder has zero Bricks-specific imports.
- **Capabilities** (what the OS does, native to Pure): `commerce`, `connections`, `content` — each is **toggleable on/off** AND **provider-selectable**. `GET /api/capabilities`, `PATCH /api/capabilities/:id {enabled?, provider?}`.
- **Providers** carry `distribution`: `native` (built-in 2.0 engine), `ecosystem` (**Counter, Nexus = standalone own-versioned Therum products / spin-offs — dual function**), `platform` (WordPress), `custom` (per-site builds, e.g. a per-store custom Counter build).
- **Verified an example store composition live:** foundation=bricks, Commerce ON → a custom Counter build [custom], Connections ON → `nexus` [ecosystem] = "Therum OS + Bricks + Nexus + custom Counter". Planned-provider select → 422.
- Studio is the interactive control center (toggle foundations + capabilities, pick providers; ◆ = Therum product, ✎ = custom).
Files: `src/services/{foundation,capability}.service.ts`, `src/api/routes/{foundations,capabilities}.ts`, `admin/app/studio/page.tsx`, `builder/src/lib/bricks.ts`.

## CLEAN BASELINE (verified): backend tsc clean, `npm test` = 14/14 pass (commerce/extension/import + edition-gate), builder + admin build clean. Pure (native-locked) ⟷ Unlocked (pairing) regression-covered.

## DESIGN PASS (Critique audit, verified): single shared token source `shared/therum-tokens.css` (@import'd by admin globals.css + builder styles.css — 0 duplication, tokens in both bundles). Fixed: muted contrast 2.56→4.76:1 AA, global :focus-visible, accent/line/type tokenized, Studio inline drift → `.row-between`/`.field-label` utilities. Vite `server.fs.allow:['..']` for the shared import.

## FOLIO — native Content engine ✅ (verified live)
First native provider to flip a planned capability to stable. `prisma` Content (type page/post/case_study, status, slug, body=canvas/markdown/html, SEO json) + MediaAsset (migration `folio_content`). `src/services/content.service.ts` (CRUD, publish flow → publishedAt, getBySlug = published-only, fires onContentCreate/onContentPublish), `src/api/routes/content.ts` (admin CRUD + public `/content/slug/:slug`). Capability `content` → `folio` [native, stable] (was planned). Admin `/content` page (pages/blog/case-studies filter, create, publish toggle) + nav. Verified: draft private → 404, publish → public+SEO, slug conflict 409, content capability resolves to folio when enabled. 3 new tests → `npm test` = 17/17.

## "SOLID BASE" HARDENING PASS ✅ (verified) — see CHANGELOG.md for full detail
Direction: no git yet (track via CHANGELOG.md + this file), ignore the WP-plugin ecosystem builds for now, make the Pure + Unlocked BASE solid rather than add capabilities. Found + fixed real gaps:
- **Capability toggle was cosmetic** — disabling e.g. Commerce never gated `/api/products`/`/api/orders`. Now enforced via `requireCapability()` plugin-scoped preHandler (`src/middleware/capability.ts`) on products/orders/customers (commerce) + content/media (content). Test-proven 403.
- **Fresh-install defaults were wrong** — everything defaulted OFF even Commerce/Content whose native providers are already built. Now: `stable` native provider → defaults ON; `planned` → defaults OFF.
- **MediaAsset was schema-only** — built the full slice (service/routes/admin page), URL-referenced assets only (upload pipeline is a follow-up).
- **No real admin auth at all** — the Next.js admin self-minted an admin JWT with zero credential check; anyone reaching the server was auto-admin. Built a real login gate: `admin/middleware.ts` + signed session cookie (Web Crypto HMAC, works in both Edge + Node) + `/login` checked against `ADMIN_PASSWORD`. Verified live via curl (real 307 redirects, not faked): `/` → `/login?from=%2F`, `/products` → `/login?from=%2Fproducts`, `/login` itself → 200. Admin restructured into a route group (`app/(app)/`) so `/login` isn't wrapped in the authenticated shell.
- **Bricks adapter had zero tests** — added a builder test runner (tsx + node:test) + 5 round-trip tests.
- **CORS was wide open** (`origin:true`) — now an explicit `CORS_ORIGINS` allowlist.
- New: `.claude/launch.json` (api :4100, admin :3100), `CHANGELOG.md` (the durable tracking log going forward).

**Test coverage: 32/32 across all three apps** (backend 23, builder 5, admin 4) — up from 18/0/0.

**Known gaps, explicitly flagged (not silently skipped):** no rate limiting, media is URL-only. (Previously also listed "single shared password only" and "login not click-verified" — both superseded: there's now a real per-account `AdminUser` table with username+password, and the full login form has been click-verified end-to-end in a real Chrome browser — see CHANGELOG.md.)

**Still parked (per direction — not touched this pass):** Nexus/Cluster/Milieus native engines (all `planned`); the WordPress-plugin ecosystem ports (Counter-wp/Nexus/Cluster/Milieus) — provisions in `INTEGRATION-PROVISIONS.md` at the Therum OS root.

## CONTENT & EDITING — Cards Admin for Pages/Posts ✅ (verified live, see CHANGELOG.md for full detail)
First section ported from the fresh 1.9.44 zip inventory (11-agent read, scoped with Bam
before touching code — full report + section-by-section port-now/deferred/dead-end split).
Pages/Posts only; Case Study stays off (future "From the Studio" addon, same Content model
already supports `type: case_study`, just not user-facing yet). Real kebab menu (Preview/
Duplicate/Delete) + View Live, `contentService.duplicate()`/`renderById()`, `/preview/[id]`,
content-agnostic word count, `pages`+`posts` de-duplicated into one shared component. Also
fixed a live recurrence of the Server-Action-staleness bug (see workstream-2 below) in the
pre-existing `createContent` action.

## MEDIA — real image pipeline + NeoRename ✅ (verified live, see CHANGELOG.md for full detail)
Second section from the zip inventory. The gap media.service.ts's own comment already
flagged ("no image-processing dependency yet") is now closed: real EXIF-strip/resize/
thumbnail pipeline (`sharp`) on upload, real width/height extraction. Built the rename engine
from scratch (didn't exist at all before this pass) — one implementation, not the two 1.9.44
had: suggest/rename with collision-checked slugs, extension-locked, rolls back on partial
failure, rewrites canvas-body image references automatically (verified: `refsUpdated:1` on a
real rename). Alt text now inline-editable. Found and flagged (not silently fixed): a schema
mismatch means `Content.coverImage` can't reference a local media URL yet (`z.string().url()`
vs. media's relative `/api/uploads/...` paths) — separate gap, no "pick from media library"
flow exists anywhere yet either. AI-vision suggest and bulk-rename deliberately deferred (no
Connections/credentials infra yet; single-item engine first).

## LOCAL PREVIEW: live and working at localhost:10004/tos-admin (see CHANGELOG.md for full detail)
The "Therum OS" Local site's nginx (`conf/nginx/site.conf.hbs`) was rewritten to front 2.0 instead of the old WP/Bricks install: `/tos-admin` → admin (:3100, Next.js `basePath` — not bare "/", deliberately not WordPress-shaped), `/builder/` → builder (:5174, Vite `base:'/builder/'`), `/api/` → backend (:4100), bare `/` → redirects to `/tos-admin` (no public storefront built yet), `/wp-admin` + `/wp-login.php` → redirect to `/tos-admin` (compatibility shim for Local by Flywheel's own stale WP-admin launcher / old bookmarks — this site was WordPress before). 1.9.44 was fully backed up first (`_backup-1.9.44-<timestamp>/`: DB dump + `app/` files + old `conf/`). Both the `.hbs` source and the live generated config under Local's run dir are in sync; reloaded via `kill -HUP` on the running nginx master, no Local app restart needed.
**Login verified end-to-end in a real Chrome browser** through `localhost:10004/tos-admin`: real form, real credentials (`Therum`/`therumos`), real dashboard, session survives a full page reload, and logout now genuinely clears the session (was silently broken — see CHANGELOG's "found a real full-auth-bypass bug" entry, along with a separate real full-authentication-bypass bug on the dashboard root that was found and fixed the same pass).

## STATUS: 6 phases + worker + foundations/capabilities + edition gate + design-token merge + Folio (native Content) + solid-base hardening pass + local preview wired to :10004, all built & verified. Native build queue remaining: Nexus, Cluster, Milieus (deliberately parked).
Only declared-not-faked item left: a true VM/worker sandbox for third-party extension JS (today: manifest + in-process providers + isolated error handling).

## QUICK START (everything)
```bash
cd "/Users/bam/Local Sites/therum-os/therum-cms-2"
docker compose up -d && npm run build && npm start &     # API :4100
cd admin && npm run build && npm start &                 # Admin :3100
cd ../builder && npm run dev &                           # Builder :5174
```
**Admin now requires login** (see the hardening-pass section above) — copy
`admin/.env.example` → `admin/.env.local` and set `ADMIN_PASSWORD` +
`ADMIN_SESSION_SECRET`, or the admin app throws on the first request. Local
dev already has `admin/.env.local` with `ADMIN_PASSWORD=local-dev-test-password`.

## CLUSTER — native merged-products engine ✅ (2026-07-22, see CHANGELOG.md for full detail)
Last planned native Studio plugin. 1.x semantics from the REAL plugin at
`Therum OS/wordpress plugins/cluster/` (group-engine.php + GroupEngineTest.php as spec).
ClusterGroup/ClusterMembership (one group per product), full 1.x group rules (steal/GC/
dissolve/primary override), read-time merged-variant resolution (combo union, in-stock
wins ties, routes to REAL source variants — nothing copied), drift detection, /clusters
admin (typeahead editor, drift panel, merged preview with routing). 9/9 cluster tests,
**full regression 65/65 exit 0**, live-browser verified with a real 2-vendor group
(genuine drift caught between seed tee and a second-supplier tee). Demo data cleaned.
Capability merged-products now stable+ON; cluster+milieus studio apps enabled (nav live).
Follow-ups queued: admin order-column "Group source" display, WP-plugin flavor ports.
**All four "From the Studio" native plugins now exist: Counter, Nexus, Milieus, Cluster.**

## MILIEUS — native memberships engine, M1 ✅ (2026-07-21, see CHANGELOG.md for full detail)
First of the remaining "From the Studio" plugins. Members = Customers. 1.x semantics ported
from the REAL WP plugin at `Therum OS/wordpress plugins/milieus/` (it exists — earlier
"greenfield" claim was a search-scope mistake; cluster/nexus/counter sources live there too).
M1 = models+migration (`20260721121215`), milieu.service.ts, /api/milieus (capability-gated),
Studio App entry + dynamic studio-app nav injection, /milieus admin page, 6/6 tests.
**Milestone queue (cross-machine resume point):**
- ✅ M1 groups + member lists
- ✅ M2 discounts in orders (Order.discountPct/Amount/Label; largest-single-wins at create;
  Payment created at discounted amount; guests/pending/expired unaffected)
- ✅ M3 daily sweep via BullMQ job scheduler on the worker (04:00) + once-only
  expiring-soon reminders emitting new `onMembershipExpiringSoon` hook point
- ✅ M4 public registration links (`POST /api/public/register/:regSlug`, unauthenticated +
  capability-gated; honeypot, 5/hour per-IP limit, max signups, approval gate with
  pending-until-approved semantics; admin form + Approve button) — ALL verified live
  2026-07-21: real browser create → real curl signup → member in panel, 9/9 tests.
- ⬜ next: Cluster (merged-products; Product.vendorId/variant.sourceVendorId groundwork already
  migrated), CSV import/export, wire onMembershipExpiringSoon into 2.0 notifications,
  Counter auto-group-on-purchase bridge, Milieus events → webhooks/audit.
Spec: `docs/superpowers/specs/2026-07-21-milieus-native-design.md`.
Note for other machines: M4's migration was authored via `prisma migrate diff` +
`migrate deploy` (migrate dev prompts interactively on the unique constraint); fresh
DBs just run `npx prisma migrate deploy` as usual.

## FORGE-AUDIT PASS ✅ (verified live, see CHANGELOG.md for full detail) — one known gap open
All 3 apps bumped to current latest and re-verified live (2026-07-14): Prisma 7.8.0 (config file +
required driver adapter — breaking), Zod 4.4.3 (`z.record` signature — breaking), Next 16.2.10 (fully
async `cookies()`/`headers()`/`params` — breaking, real 18+ file blast radius, see CHANGELOG for the
silent-typecheck-gap callout), React 19.2.7 (`useRef`/ambient `JSX` — breaking), Vite 8.1.4 + TS 7.0.2.
Backend typecheck 46→0 errors, real boot + smoke tests. Admin + builder both live-browser-verified
under the new versions (real interactions, zero console errors). Bonus fix: `.claude/launch.json`'s
real location is the **project root** (`/Users/bam/Local Sites/therum-os/.claude/launch.json`), not
`therum-cms-2/.claude/launch.json` — a stray duplicate of the latter caused an edit-the-wrong-file loop
before this was caught; `builder` entry now correctly added to the real one.
**Open gap: `next build` (admin) intermittently throws `The "id" argument must be of type string.
Received undefined.`** under both Turbopack and `--webpack`, non-deterministic across identical
retries, isolated away from the `proxy.ts` rename as a cause. `next dev` is unaffected. Do not deploy
admin via `next build` until this is root-caused.

## Notes
- npm 11 blocks lifecycle scripts: run `npx prisma generate` explicitly; run via built `dist/` (`npm start`), not tsx (esbuild postinstall was blocked) — or `npm run dev:tsx` after `npm approve-scripts esbuild`.
- 1.9.44 (WordPress) is SUNSET; do not deploy the parked mu-plugin wiring. Ignore any instance-specific/legacy store references.
- Ports: PG 5433, Redis 6380, API 4100, Builder 5174. JWT roles: admin|editor|viewer.
- Real launch.json for preview tooling lives at Therum OS root, not inside `therum-cms-2/`.

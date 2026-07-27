# Sidemoney Build Session — Kickoff (written 2026-07-25)

Drop this file (or point the session at it) + the Sidemoney assets folder.
Everything below is the state a fresh session needs to start building.

## What Sidemoney is
Bam's site, first real site on Therum OS 2.0. The build doubles as the beta
test: dogfood the Builder + Base Theme + Counter end to end, fix what breaks.

## Where everything lives
- Repo: `/Users/bam/Local Sites/therum-os/therum-cms-2` (Drive-mirrored at
  "My Drive/Therum Projects/Therum OS/therum-cms-2")
- Memory: `~/.claude/projects/-Users-bam-Local-Sites-therum-os/memory/`
  (mirrored to Drive `.claude-memory/`) — read MEMORY.md first.
- 1.x source of truth: "Therum OS/" folder (WP plugins, previews/ = Bam's
  design specs — ALWAYS check previews/ before designing any admin surface).
- Dev: `npm run dev` (API :4100, watches dist — `npx tsc -p tsconfig.json`
  to rebuild), admin :3100/tos-admin, login user `Therum` (Bam knows pw).
- Tests: `node --env-file=.env --test --test-concurrency=1 test/*.test.mjs`
  — 134/134 green at handoff. Re-seed the dev mock connection after runs
  (suites clean it up; see memory).

## What 2.0 has (beta-ready pieces)
- Public site: Base Theme — `/` (homepage picker), `/:slug`, `/blog`, `/work`,
  themed 404, custom menu (Settings → Site), full SEO heads.
- Commerce: full Counter — catalog (categories/tags/search/filters), product
  media cards (hover-video/arrow-flip), cart, coupons, tabbed method-strip
  checkout, orders, refunds, receipts, sales reports. Gateways: Stripe +
  Square implemented (NO live transaction ever run — sandbox E2E pending
  Bam's keys), mock for dev.
- Admin: product editor (/products/[id]) w/ MediaPicker + variants; Nexus
  connections (card grid + slide-over, 76 providers incl. POD fleet:
  printful/printify/gelato/gooten/spod/podplus/podpartner/tapstitch/contrado
  + custom-* connectors); MCP endpoint (/api/mcp, 7 tools).
- Content: pages/posts/case studies author in admin/Builder → publish →
  live on Base Theme.

## The build order for this session
1. **WP Bridge research FIRST** (spec: docs/superpowers/specs/
   2026-07-24-wp-bridge-design.md — research checklist gates code):
   inventory WP fns the target theme calls; Bricks JSON deep-dive;
   php-cgi pooling on macOS/Ubuntu. Only build after research verdicts.
   (If Sidemoney goes Base-Theme-native instead of Bricks/WP-theme, Bridge
   can wait — ASK BAM which route Sidemoney takes before researching.)
2. Site content: pages in Builder, homepage assignment, menu, case studies.
3. Shop: products w/ real media (use the product editor + MediaPicker),
   categories/tags, coupon(s).
4. POD partner: Bam named podplus/podpartner/tapstitch/contrado — when he
   picks one, that provider gets the first fleet module (order push +
   shipping/tax quotes; doctrine = fulfillment delegates, NO zones engine).
5. Square sandbox E2E when keys arrive.
6. VPS deploy last (deploy/nginx.conf has site+api+admin blocks; pm2
   ecosystem.config.cjs; DEPLOY.md).

## Standing rules (non-negotiable, from memory/CLAUDE.md)
- NO CHECKS EVER in any checkout (test-enforced in methodRegistry).
- WooPayments→Square is Bam's real payout setup (NOT Whop — old mishearing).
- Never build Update schemas via .partial() (default-clobber footgun).
- Every counter/limit = atomic conditional UPDATE, never check-then-write.
- Hostile-audit any new money path before calling it done.
- Literal port over reinterpretation; check 1.x + previews/ before designing.
- Drive sync after every milestone (rsync repo + memory; see memory file).
- Test suites must clean up after themselves (orders FK-pin variants).

## Open items carried over
- WP Bridge (#49): research → build (tiers T1 theme shim / T2 Bricks / T3
  bounded plugins).
- Preview gap report (docs/PREVIEW-GAP-REPORT.md): big three remaining —
  connections-powered dashboard (partially done: status card + MCP card
  live), theme store/saved themes, NeoRename. Plus vault/webhook depth,
  branding settings, per-role dashboards.
- FUTURE-BUILDOUT.md: full theme system, native builder/post editor, menus
  manager, storefront customer accounts, Woo-compatible custom build.

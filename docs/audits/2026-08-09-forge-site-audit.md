# Forge Site Audit — 2026-08-09 (pre-launch)

Ran per `Forge/addons/forge/knowledge/audit-playbooks.md`: security pass +
pre-merge engines (`cli-cycle` scorecard) + the last 24h's three deep passes
(front-end drive, back-end wiring, static runtime review) rolled in. Every
finding logged with category, why, and status — no invented findings.

## Changelog

| # | Category | Finding | Why it matters | Status |
|---|----------|---------|----------------|--------|
| 1 | git / data-loss | `main` was ~27 commits ahead of `origin/main`; nothing pushed since Aug 6 | One disk failure erases the launch codebase | **Resolved** — pushed on Bam's call (4491542..832a3b4), secrets re-checked clean first |
| 2 | security / deps | `brace-expansion` DoS (GHSA-rgw5-rvv9-x895) + `fast-uri` host confusion (GHSA-7p8r-x3mc-p8w7), both high, in prod deps | Known-vuln surface on a public API | **Resolved** — `npm audit fix`, 0 vulns local + box, deployed (`10e28ef`) |
| 3 | security / transport | `notification.service.ts:156` sends direct-MX mail with `rejectUnauthorized:false` (Semgrep blocking) | MITM could read outbound order emails | **Accepted by design** — opportunistic STARTTLS; MX certs routinely mismatch, verifying = mail simply stops. Documented in-code |
| 4 | security / secrets | `git ls-files` env check | A pushed key = rotate immediately | **Resolved** — only `.env.example` tracked |
| 5 | git / hygiene | Tags stop at `v2.0.0-beta.6` (package.json at beta.8); stray tag literally named `Main`; stale branch `backup-before-purge` | Release archaeology breaks; tag pollution | Open (post-launch tidy) |
| 6 | tooling | `gh` CLI unauthenticated — repo-health audit (rulesets/PRs) could not run | Blind spot on branch protection | Open (needs `gh auth login` by Bam) |
| 7 | payments / device | Apple Pay sheet died after its one async leg on a real iPhone; infra verified healthy (domains active both registries, association byte-identical, PMC on, pk=sk account) | The money button on the money device | **RESOLVED — confirmed working on Bam's iPhone.** Fix = fully-synchronous sheet, no network inside it (shipping pre-quoted), + flight recorder (`8c669de`). This unblocks the held money-path refactors |
| 8 | prior passes | Four device-bug classes in main checkout, 5 dead admin wires, dead nightly backups, memory-cycling API, Redis eviction policy, zombie order, stuck bar on rotate, SDK hangs, oval discs, below-fold errors | — | **Resolved** — commits `37e2a7c`…`24b9382`, all deployed + re-verified (static re-audit PASS, 29/29 runtime gate) |
| 9 | content | 7 home/about links point at never-migrated content (blog posts, Soul Sold Out Tee, manifesto) | 404s from the homepage | **Accepted** — Bam's call: catalog/content import fills them |
| 10 | ops | Nightly backups proven working again (2× 120MB Aug 9); pm2 caps raised; env perms tightened | Safety net restored | **Resolved** |
| 11 | docs | README frozen at Phase-1 (RCI 3.2/10): quickstart dies on fresh clone (`npm run dev` targets gitignored dist/), admin+builder+storefront invisible, 48-model schema described as 5, shipped work announced as "Next" | Misleads any collaborator; zero customer impact | Open — post-launch rewrite (cli-forge-readme envelope saved at .claude/cli-forge-readme.json) |
| 12 | structure | Tree audit SHS 8.0/10 "clean" — 3 hygiene items (stray credential backup on disk, 0-byte dev.db, .DS_Store) | Disk hygiene; nothing tracked | **Resolved** — all deleted same session; never in git |
| 13 | tests | Test audit 55/100 (TMMi L2): content best-in-class (real-crypto money/auth tests, incident-memory culture, no fixture theatre) but NO CI gate, tests share the dev DB (documented residue incidents), no coverage/mutation tooling, PayPal/wallet gateways + BullMQ consumption untested | 513 tests that only run when a human remembers | Open — post-launch program: wire CI (compose services exist), DB isolation, smoke tier. Envelope .claude/cli-audit-test.json |
| 14 | docs | Doc audit DQI 5.2/10: README time-capsule + broken quickstart (dupes #11), CHANGELOG missing beta.8 entry + facts diverged 3 ways across state docs (MCP tools 2/7/14, providers 63/76/86), 204 endpoints with no API reference, no architecture diagram, 2 of 3 apps without entry docs. Inline code comments scored 0.95 — model-grade | Collaborator onboarding + cross-machine state drift; zero customer impact | Open — post-launch doc pass (cli-forge-doc). Envelope .claude/cli-audit-doc.json |
| 15 | code quality | Code audit CQI 7.3/10 "ship-ready": money-path + crypto reference-quality; typecheck clean. Structural debt (7 god-files, productCard 460 lines, slugify×4 diverged) all post-launch | Maintainability, not correctness | Open — post-launch refactor |
| 16 | **security** | `admin/lib/api.ts` minted a **valid admin JWT when no session cookie is present** (fallback token); backend accepts any signature-valid `role:admin` without an existence check, so a proxy-matcher hole = anonymous full admin | Privilege-escalation trap on the admin API | **Resolved** (`b726158`) — fallback role → `anon-ui`, which the backend rejects; proven live: anon-ui→401, admin-role→passes gate. Fails closed |
| 17 | **security** | Woo-compat accepts `consumer_secret` via query string + no pino `redact` → partner secrets written to `req.url` in info logs | Secret leak into logs | **Resolved** (`b726158`) — request serializer masks credential query params + redacts auth/cookie headers; proven live: log shows `consumer_secret=***`, raw value in 0 lines |

## Remediation pass (drive-to-ceiling, 2026-08-09 later)

Safe, verified fixes across every category. Money-path god-file splits held
until Apple Pay is device-confirmed (re-cutting productGrid/checkoutFlow now
risks the exact flow under test).

| Category | Item | Status |
|---|---|---|
| Code / security | fallback admin token neutered; log secret-masking | Resolved `b726158` (proven live) |
| Code | scrypt cost now stored per-hash (N=2^17 new, legacy still verifies) | Resolved `4c…` — proven legacy+new verify |
| Code | rate limiter atomic Lua + self-heal (was permanent-lockout race) | Resolved — proven stranded-key recovers on box |
| Code | worker shutdown closes backupWorker; mail transports log failures + dedup | Resolved |
| Tangle | oauth↔connection hard cycle cut (lazy import) | Resolved (+15) |
| Tangle/Code | 7 dead exports removed (kept test-affordance + plugin API per CLAUDE.md) | Resolved |
| Tests / Docs | GitHub Actions CI: typecheck+build+runtime gate+audit+3-app typecheck (blocking); DB suite reports until isolated | Resolved — all blocking steps proven green locally |
| Tests | `tools/runtime-check.mjs` gate (node --check on shipped browser JS), coverage script | Resolved — 12/12 |
| README/Docs | README rewritten (working quickstart, diagram, config); admin+builder READMEs; docs/ARCHITECTURE.md; CHANGELOG beta.8; allowlist | Resolved |
| Deps | 2 high vulns patched | Resolved `10e28ef` |

**HELD for post-Apple-Pay-confirmation (the only path to a literal Tangle/Code 100):**
split the money-path god-files (productGrid 3213 LOC, checkoutFlow, wooCompat);
declare a counter↔services direction; reduce max import-chain depth. Each
re-touches the checkout runtime currently under device test.

## Connectors (2026-08-09, reported live by Bam: "sync/push down, site not reading")

Investigated by reproduction, not theory. Finding: the backend was never down.

| Item | Evidence | Status |
|---|---|---|
| Printful sync | `run('printful')` and the full admin path both 200 — updated 5, 17 variants | Was already working |
| Printify sync | 422 "needs a Shop ID" — stored credential had token but no shop id | **Resolved** — now auto-resolves the shop from the token via `/v1/shops.json` (like Printful's store id); proven live 200, 41 products / 99 variants |
| "site not reading" | `providers()`, `fulfillmentProviders()`, `paymentProviders()` all return connected (Printful, Printify, Stripe, Square, PayPal) | Backend reads fine — was a stale admin bundle; admin `.next` rebuilt clean (63 restarts had left a deploy-race `.next` error) |
| Contrado fulfillment | `status: error, lastTestOk: false` | Flagged — one connector genuinely erroring; not Printful/Printify |

## Scores / gates at close
- Build: API + admin exit 0, 0 TS errors. Runtime gate 29/29 `node --check`.
- Deps: 0 vulnerabilities (prod).
- Live: all pages 200 (~40ms), crawl = only the 7 accepted placeholders,
  services online, no fresh server errors.
- Full `cli-cycle` scorecard waves were dispatched; anything they surface
  beyond the rows above gets appended here with status.

## The one blocking recommendation
Push `main` to origin (finding #1). Everything else on this list is either
resolved, accepted with a reason, or post-launch tidy.

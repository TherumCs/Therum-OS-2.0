# WP Bridge — From the Studio app (DESIGN DRAFT)

2026-07-24, per Bam (voice): a Studio App that lets 2.0 use **WordPress themes**,
**WordPress plugins in certain capacities**, and **Bricks (and Bricks-likes) without
full-blown WordPress**. "I know there's a way to do that." Not WordPress itself —
a compat surface. the reference store's local build (new session) is the first consumer.

## What 2.0 already has that maps
- `Compat/WooBridge` in 1.x Counter (Functions.php / Bridge.php / Stubs.php) — the
  pattern to steal: a STUB LAYER that implements just enough of the host API for the
  guest code to run. 1.x did Woo-on-SQLite; WP Bridge does WP-on-2.0.
- Content render pipeline (html + seo + jsonLd), Base Theme shell, token system.
- Studio Apps registry — WP Bridge registers like Nexus/Case Studies did.
- Import pipeline (WP import exists) — themes/plugins arrive as zips the same way.

## The three capability tiers (build in this order)
### T1 — WP theme rendering (highest value / clearest path)
A WP theme is PHP templates + functions.php against the template hierarchy + loop.
Two candidate approaches, DECIDE IN RESEARCH:
  a) **PHP runtime shim**: run the theme's PHP via php-cgi/php-embed subprocess with a
     wp-stubs.php that implements the ~200 core functions themes actually call
     (the_title, the_content, wp_head, get_header, WP_Query façade over our content
     API, wp_nav_menu over our nav). Local already ships PHP 8.5 (memory:
     local-php-lint-binary). Real fidelity, real cost: sandboxing + per-request exec.
  b) **Template transpile**: parse theme templates, map the hierarchy to Base Theme
     slots, run no PHP at runtime. Cheaper, breaks on any nontrivial functions.php.
  Verdict expectation: (a) for fidelity — WP themes without PHP aren't WP themes.
### T2 — Bricks without WordPress
Bricks stores layouts as JSON post-meta and renders through its own element classes.
Research targets: what minimal WP surface Bricks' renderer needs (it's a plugin, so
T1's shim grows plugin-grade functions: hooks table, options API, post-meta API);
whether Bricks' saved JSON can render through OUR renderer instead (element JSON →
2.0 canvas blocks — likely the smarter road: import Bricks layouts, render native).
### T3 — WP plugins "in certain capacities"
Explicitly bounded: content-shaping plugins (shortcodes, SEO fields, blocks) YES;
anything touching WP DB schema/admin/auth NO — those are 2.0-native domains.
Capability manifest per plugin: what the shim exposes, everything else stubbed inert.

## Architecture sketch
- `wp-bridge/` Studio App: registry entry + admin surface (upload theme/plugin zips,
  activate, map menus/homepage).
- `src/lib/wpshim/` — the stub layer: hooks (add_action/apply_filters table),
  options (Setting rows), posts (Content façade), menus, WP_Query→content queries.
- Renderer integration: Base Theme yields to an active WP theme — site.ts asks
  themeResolver first (active WP theme? render through bridge : Base Theme).
- PHP execution: pooled php-cgi workers, request-scoped, no network, read-only FS
  except theme dir; timeouts hard. (Security posture: a theme is untrusted code.)
- Bricks: importer first (JSON → native blocks), live-render shim only if importer
  proves insufficient.

## Research checklist (next session, before code)
- [ ] Inventory the actual WP functions the target themes call (grep a few real
      themes incl. whatever the reference store wants) — sizes the T1 shim honestly.
- [x] Bricks data format deep-dive (bricks_page_content meta JSON schema).
      DONE 2026-07-25: `_bricks_page_content_2` postmeta = PHP-serialized flat
      element array `{id, name, parent, children[], settings}` (NOT JSON in the
      DB — serialize; template export/clipboard ARE JSON). Verified against
      bam-leon's real DB: the reference store page = 501 elements (text-basic 225,
      block 139, div 53, image 23, code 23, heading 13, addon elements
      morphingmenu/coretabs degrade to container per adapter fallback).
- [ ] php-embed vs php-cgi pooling on the VPS (Ubuntu 24) + Local (macOS).
- [ ] "Forge" — Bam referenced it as the resource hub for skills/MCP servers to
      lean on here; identify and wire in.
- [ ] License check: Bricks is commercial — running it outside WP is fine for his
      own licensed sites; no redistribution.

## Non-goals
- Not WordPress. No wp-admin, no WP auth, no WP DB tables, no plugin marketplace
  promises. The bridge serves 2.0 sites wearing WP clothes — 2.0 stays the OS.

Status: T2 (Bricks) BUILT + E2E-VERIFIED 2026-07-25 — importer road confirmed
as the right call. `src/lib/bricksAdapter.ts` + `/api/bricks/import|export`
(gated on bricks-bridge studio app) + builder extension; 4/4 unit tests green.
Live E2E: real 501-element the reference store Bricks layout from bam-leon DB imported
→ 502-node canvas → published → renders on Base Theme
(/the reference store-bricks-import-e2e); export round-trips all 501 elements with
settings preserved (__bricks lossless).
MEDIA STEP built 2026-07-25: `bricksMediaService.localize()` — import accepts
optional `mediaBaseUrl`; downloads every canvas image into the native media
library (same upload pipeline as manual uploads: EXIF-strip/thumb/MediaAsset
row, so imports appear in the admin Media list with auto-alt), rewrites srcs
to /api/uploads/, dedupes shared srcs, reports dead links per-src without
failing the rest. `POST /bricks/localize-media/:contentId` backfills earlier
imports. Live-verified: 18/18 the reference store assets pulled from bam-leon
(:10014), page serves 23/23 images locally (SVG naturalWidth=0 is normal —
no intrinsic size, they render). Tests 3/3, full suite 141/141.
T1 (theme shim) + T3 (plugins) remain design-draft; research checklist above
still gates those. Open: parseBricksPayload doesn't take PHP-serialized DB
dumps directly (decode externally first).

# Changelog

## [2.0.0-beta.5] — Server panel, quick checkout, provider catalog sync (2026-08-01)

The release that makes the box administrable and the store sellable. Everything
below was verified against the running install rather than reasoned about, and
the suite went from 318 to 356 tests.

**Settings → Server — the control panel this stack no longer has to install.**
Fifteen actions (reload the API, restart the admin or worker, test and reload
nginx, enable the firewall, disable SSH passwords, install updates, dry-run
certificate renewal, cap Redis memory, tune Postgres, read the logs), each
stating what it runs and how to undo it before it runs, each audited. Plus a
console that parses your line against a fixed grammar instead of running a
shell: `df; id` is refused as shell syntax, `rm -rf /` as an unknown command,
and the refusal names what IS accepted. No endpoint anywhere takes a command;
`deploy/therum-sudoers` grants NOPASSWD on exact argv, because granting the
binary would be granting everything sed, systemctl or apt-get can do.

**Out-of-band control.** The panel above runs ON the box and dies with it, so
Hostinger joins Nexus as the first `hosting` provider: state, IP, hard restart
and snapshot through the provider's API, reachable when the server is not.
Provider-agnostic — a second host is one adapter, not another panel.

**Quick checkout completes in the card.** Two card types the settings could
never actually produce before (hover video, gallery arrows) now follow the
product's own media via a new `auto` default. Pick options, pay with a wallet
or a card, never leave the page — and the same Nexus method strip the full
checkout shows.

**Money is right on every surface.** Shipping address, live rates from the
provider or Counter settings, tax, and a full breakdown — items, discount,
shipping with its method, tax, total — on the order, the confirmation, the
admin and the receipt email. An order that charged $54 for an $83.45 cart is
what started this.

**Catalog sync is provider-agnostic.** Printful and Printify ship as adapters;
re-syncing is idempotent on the provider's own ids and only ever overwrites
name, image, price and stock, so descriptions and categories you improved
survive.

Also: Host Advisor (20 probes, 25 deterministic rules), scoped editing behind
propose → review → apply, the Studio assistant as a dashboard card, appearance
settings that actually change the page, the navigation freeze fixed at its
cause, and a test suite that can now run twice in a row — stock reservations,
rate limiters and throwaway accounts all clean up after themselves.

## [2.0.0-beta.2] — Admin hardening, Media library rebuild, front-end dock (2026-07-28)

Released after a full audit pass: every admin route, all 10 Appearance sections,
all 15 Settings sections, the public site, the builder and the login flow were
driven end to end and verified working. Highlights of this release:

- **Appearance** rebuilt into the Settings shell (rail + content pane), 50
  controls across 10 sections, saving per field on change. 14 fields ported from
  1.9.44 that 2.0 had no schema for. Every control verified to change the rendered
  chrome — 4 that saved into the void are now wired.
- **Settings**: zero broken saves. Uploads' 11 settings are enforced for the first
  time (the six `allow*` toggles previously enforced nothing).
- **Media**: real-shape masonry, hover captions, a full lightbox with crop /
  rotate / flip / rename / alt text, non-destructive with revert.
- **Front-end admin dock**, ported from 1.9.44, with a safe hand-off to the
  visual builder.
- **Login was completely broken** by a CSP that blocked React hydration — the form
  could not submit and the server logged no attempt. Fixed.

### Added — scheduled backups

- `Settings > Backup` had `enabled` and `frequency` saving into nothing: there was
  no scheduler for them to configure. A BullMQ repeatable job now runs on the
  chosen cadence (hourly `0 * * * *`, twice-daily `0 3,15 * * *`, daily `0 3 * * *`,
  weekly `0 3 * * 0`), verified computing correct next-run times, and disabling
  removes the schedule outright. The schedule re-arms on PATCH rather than waiting
  for the next worker boot — changing the frequency and seeing nothing happen for
  a day is indistinguishable from the setting being broken.
- Scheduled runs go through the same `runNow()` as the manual button, so both
  produce the same artifact, and now also fire `notifyBackupComplete` — the
  unattended run is the one you are more likely to want told about.

### Fixed — backups could never complete on a Docker-Postgres host

- `runNow()` required `pg_dump` on the host PATH and threw otherwise. On a machine
  where Postgres runs in Docker (this one) there is no host `pg_dump`, so **no
  backup had ever succeeded** — manual or scheduled. It now falls back to the
  `pg_dump` inside the Postgres container via `docker exec`, dumping to stdout
  (`-f` would write inside the container) and rewriting the host to the
  container's own loopback. Container name overridable via `BACKUP_PG_CONTAINER`.
- `DATABASE_URL` is Prisma's and carries `?schema=public`, which `pg_dump` rejects
  with "invalid URI query parameter". The query string is now stripped before the
  dump. First successful backup on this machine: 89 MB, containing
  `manifest.json`, a 638 KB `database.sql`, and the full uploads tree.

### Added — ⌘K command palette

- The sidebar advertised "⌘K" from the day the shell was built and **nothing ever
  listened for it**; the search box beside it had no state or handler either, so
  typing in it did nothing. Appearance > Workspace > "Keyboard shortcuts" was
  equally hollow — it saved, with no handler to gate. All three are now real:
  ⌘K / Ctrl-K opens a palette over nav, all 10 Appearance sections, all 15
  Settings sections and a debounced content search; ↑↓ moves, ↵ opens, Esc
  closes; the sidebar box opens the same palette rather than duplicating it; and
  the setting genuinely disables it.

### Fixed — Settings > Performance partly load-bearing

- `lazyImages`, `minHtml` and `minCss` now apply to every public page as it is
  served (verified: 0 → 6 lazy images on /contact). The page's own copy claimed
  "2.0 has no public renderer yet" — stale, there is one — and now states exactly
  which toggles are live and which are not.
- HTML minification collapses whitespace between tags only; `<pre>`, `<textarea>`,
  `<script>` and `<style>` are preserved byte-for-byte. Real but small on ported
  pages (~200 bytes) because Bricks-exported markup arrives already single-line.
- The remaining Performance toggles are labelled honestly rather than faked:
  revisions/trash/autosave need a feature built (no revision table, no soft
  delete, no builder autosave), and emoji/oEmbed/heartbeat strip WordPress-era
  behaviour this stack never emits.

### Fixed — addon install could be un-manageable

- `bricksAddon.service.ts` built its return objects with an explicit `slug` and
  then spread the manifest over it, so `manifest.slug` silently won. Every other
  route keys off `PREFIX + slug` from the stored name, so a ZIP whose manifest
  disagreed produced an addon that could not be enabled or removed. This was also
  the pre-existing `tsc` error that had been blocking the production build.

### Fixed — login and admin hydration

- **Nothing in the admin was interactive, including the login form.** Helmet's
  default `script-src 'self'` applied to `/tos-admin`, which blocks the inline
  `self.__next_f.push(…)` tags Next ships its RSC payload in. React hydrated with
  nothing: markup rendered, every control was dead HTML, and submitting the login
  form made no request at all (the auth event log recorded zero failed attempts,
  which is what identified it). Fixed with `@fastify/helmet`'s own per-route
  opt-out — note it reads `helmet: false` at the TOP level of route options;
  `config: { helmet: false }` is silently ignored. The public site and `/api` keep
  helmet's strict defaults.
- **Do not mutate responses in a Fastify `onSend` hook.** Two separate attempts at
  the above (deleting headers via `reply.raw.removeHeader`, and later injecting the
  dock by rewriting the body) each threw `ERR_HTTP_HEADERS_SENT` on the *next*
  response and killed the process. Header deletion belongs in route config; body
  injection belongs in the render context.

### Added — front-end admin dock

- Port of 1.9.44's `thd_*` block. Renders only for a valid session cookie —
  logged-out HTML is byte-identical. Auto-hide on scroll, drawer + pull-tab, focus
  mode, per-route breadcrumb, and Edit for real content rows. Drives the
  `defaultMode` and `mobileStyle` settings, which until now saved and did nothing.
- **Edit hands off without leaking the session token.** The dock renders into
  public page HTML, so it cannot carry `builderEditUrl()`'s `?token=<jwt>`. It links
  to `/tos-admin/edit/<id>`, which reads the httpOnly cookie server-side and
  redirects.
- **The builder was unreachable.** `NEXT_PUBLIC_BUILDER_URL` pointed at
  `localhost:10004` — a port nothing has listened on since the API moved to 10009 —
  so every Edit hand-off in the admin went to a dead host. The builder is now served
  from the API at `/builder/`, keeping the whole product on one origin.

### Fixed — Settings > Uploads enforced

- **The six `allow*` toggles enforced nothing.** Turning off "allow code" did not
  stop `.php` uploads; any file type was accepted. All 11 Uploads settings are now
  applied in `lib/uploadPolicy.ts`, called from `mediaService.upload()` so every
  caller is covered. `maxUploadMb` and `resizeMaxPx` had been hardcoded constants.
- `autoWebp` wrote WebP bytes into a `.png` filename; `exifStripped` was hardcoded
  `true` regardless of the setting. Both fixed.
- The multipart ceiling moved from 50 MB to 2048 MB so `maxUploadMb` is the real
  limit — which left the plugin-ZIP route unbounded, so it gained its own check.

## [Unreleased] — earlier beta.1 shakedown work (2026-07-27)

Sidemoney-beta shakedown pass. Everything below came out of driving the real admin
at `localhost:10009/tos-admin` rather than reading code, so each item is a defect
that was actually reproduced, or a behaviour Bam asked for by name.

### Fixed — list pages

- **Every admin list lost its filters, sort, and paging past 100 rows.** Filtering
  and search ran client-side over an already-truncated fetch, so a pill count could
  claim 368 while the filter only ever saw the first page; sorting did not exist at
  all. Moved all four to the query string and the database: `src/schemas/listing.ts`
  (shared `sort`/`order` + a real `total`), `admin/app/(app)/ListControls.tsx`
  (URL-driven pills / debounced search / sort select / cursor pager). Applies to
  pages, posts, media, case studies, products, orders, users.
- **`kind=audio` returned 422 on media.** The uploader and the UI pill both produce
  `audio`, but it was missing from the list-query enum.
- **Cluster and Milieus had ad-hoc page headers.** Rebuilt on the standard
  `th-lp-header` (live counts, title, plain-English description) so they match Pages
  / Posts / Media / Bricks Bridge. Inner headings disambiguated: "Groups" →
  "Merged products" / "Member groups".

### Fixed — single-origin admin proxy (`src/api/adminProxy.ts`)

- **Login POSTs arrived empty and Server Actions white-screened.** Fastify's own
  JSON and multipart parsers consumed the request body before it could be forwarded.
  A scoped catch-all parser is not enough — a specific parser registered on the ROOT
  instance still wins over a child's `'*'` — so the plugin now calls
  `removeAllContentTypeParsers()` first and forwards the raw bytes.
- **Next rejected Server Actions as cross-origin.** The proxy now forwards the real
  browser `Host` alongside `X-Forwarded-Host`, with `serverActions.allowedOrigins`
  in `admin/next.config.mjs` covering the rest.
- **Helmet's default CSP (`script-src 'self'`) applied to the admin.** Next ships its
  RSC flight payload as inline `<script>` tags, so the whole admin would have been
  served as un-hydratable static HTML. Helmet's headers are now stripped for the
  `/tos-admin` prefix only — the public site and `/api` keep the strict defaults.
  Note `@fastify/helmet` writes through `reply.raw.setHeader`, so removal has to go
  through `reply.raw.removeHeader` too.

### Added — media library

- **Lightbox viewer** (`admin/app/(app)/media/MediaLightbox.tsx`). Full-bleed, with
  the action bar floating over the image rather than beside it: one row, icon-over-
  label buttons, grouped edit / copy / destructive with rules between the groups.
  Rename, alt text, crop and adjust each open their own screen in that same bar,
  replacing the `window.prompt()` calls. Arrow keys walk the loaded page; Escape
  backs out of a screen before it closes the viewer.
- **Non-destructive image editing.** `POST /api/media/:id/transform` (crop as
  normalised 0–1 rect, rotate 90/180/270, flip X/Y) and `POST /api/media/:id/revert`.
  Edits apply in place so every Bricks canvas pointing at the URL keeps working; the
  first edit copies the as-uploaded file to a `-original` sibling, which is what
  revert restores. Refuses SVGs (sharp would rasterise vector artwork while keeping
  the `.svg` name) and animated images (would flatten them to one frame).

### Changed — media tiles

- **Tiles are artwork, not cards.** The caption box under each thumbnail is gone and
  the name now appears on hover; grid uses `contain` so nothing is cropped. The old
  `cover` crop meant a wide banner or a logo showed as an unidentifiable centre slice.
- **Masonry shows the file's true shape.** It was forcing `aspect-ratio` computed
  from the stored `width`/`height` columns, which fall back to `1` when those are
  missing or stale — squaring and cropping everything. The `<img>` now renders at its
  natural ratio and the tile takes that height. Verified 12/12 tiles match exactly.
- **The Cols slider drives masonry too** (3–7 columns), not just grid. Only the table
  view greys it out now.
- **Metro tile view removed** at Bam's request. Gone from the view switcher, the
  panes, the CSS, and the `viewMode` enum; a stored `metro` preference falls back to
  grid.
- **GIFs and videos move on hover.** Tiles paint a still poster and swap to the
  moving file only when pointed at — 48 autoplaying tiles is a CPU fire and makes the
  library impossible to scan. Videos are `muted`/`loop`/`playsInline` with
  `preload="metadata"`, and reset to frame 0 on leave. `prefers-reduced-motion` is
  honoured; a `GIF`/`▶` badge marks tiles that will move.

### Changed — list toolbar is one control language

- **Five control styles collapsed into one.** The bar mixed pill radius on the
  filter chips with rounded-rect everywhere else, and ran five different paddings
  (`6/12`, `8/12`, `8/10`, `6/12`, `6/10`) so no two controls shared a height. Filter
  chips, sort, search, Cols and the view switch now all resolve from a single pair of
  tokens — `--th-ctl-h: 34px` and `--th-ctl-r` — with one border and one surface.
  Verified in the browser: all five report 34px / 10px. View-switch buttons are square
  (side = control height) rather than three differently-proportioned buttons, and SORT
  now reads exactly like COLS: one box, inset uppercase label, control inside.

### Fixed — CSS specificity trap in `admin/app/globals.css`

- **The shared input/select base rule outranked every component class.** It is written
  as `#th-content :where(input…, select, textarea)` and its own comment claims it
  "contributes ZERO specificity — any component class still wins without
  `!important`". That was only true of the right-hand side: the bare `#th-content`
  prefix contributes (1,0,0) by itself, beating any single-class rule. The visible
  symptom was `.th-lp-sort-select` keeping a border and white background inside its
  own wrapper — a bordered select sitting inside a bordered control. Wrapping the id
  in `:where(#th-content)` makes the whole selector zero-specificity, which is what
  the comment always described. Fixed once at the source rather than per component;
  Settings-page controls verified unchanged.

### Fixed — image pipeline (`src/lib/imagePipeline.ts`)

- **Animated uploads were silently flattened to a single frame.** sharp reads only
  the first page unless opened with `{ animated: true }`, so every GIF uploaded to
  date went in moving and came out still (the four already in the library are past
  saving — their originals are gone). Animation is now detected off the input's own
  page count, so animated WebP is covered too; per-frame height is read from
  `pageHeight` rather than the stacked filmstrip; thumbnails stay deliberately
  single-frame so tiles have a still poster to swap from. Verified end to end: a
  4-frame GIF in, 4 frames out, 1-frame thumbnail.

## [Unreleased] — Bricks Bridge Studio App (2026-07-25, post-beta.1)

Bam's call: Bricks-only bridge (T1 theme shim + T3 plugin compat deferred). "Use
Bricks without full-blown WordPress" — and the load-bearing core ALREADY EXISTED:
the builder's tested fromBricks/toBricks adapter. This pass packaged it into a real
Studio App with server-side surfaces, verified against the REAL Bricks theme source
(local install: postmeta `_bricks_page_content_2`, template-export `{content:[…]}`,
clipboard `{source:'bricksCopiedElements'}` — all three shapes accepted).

### Built
- `src/lib/bricksAdapter.ts` — server-side Bricks⇄canvas (lossless via `__bricks`
  raw-settings preservation; unmapped elements degrade to container/text).
- `POST /api/bricks/import` {title, type, payload} → NATIVE canvas draft (editable
  in the Therum Builder, rendered by the existing server renderer — publishing stays
  human). `GET /api/bricks/export/:contentId` → Bricks template JSON Bricks' own
  importer accepts. Both gated on the app being enabled in From the Studio.
- Studio Apps registry: `bricks-bridge` entry (5 apps now).

### Verified
4/4: gate message, all three payload shapes + garbage rejection, imported page stored
as bodyFormat 'canvas' and RENDERING PUBLICLY through Base Theme (heading/text/button),
export round-trip preserving element names + settings. **Full regression 138/138.**

Also: `.claude/commands/therum-setup.md` — /therum-setup scaffolds the project
.claude folder in Bam's _core/addons kit shape, loaded with the build context.


## ═══ 2.0.0-beta.1 — OFFICIAL BETA (2026-07-25) ═══

**The first official Therum OS 2.0 release.** Everything below this banner (every
`[2.0.0-beta.1]` entry) shipped in this beta — the complete ground-up rebuild:
Node/TypeScript/Fastify/Prisma/Postgres core, Next.js admin, Base Theme public
frontend, full Counter commerce engine (catalog → tabbed checkout → orders →
refunds → receipts → reports, hostile-audited money paths), Nexus connections hub
(76 providers, structured credentials, custom connectors), Studio Apps (Nexus,
Milieus, Cluster, Case Studies), MCP site-operations surface, and the admin
punch-list (product editor, media picker, site settings + menu editor).

Status: **beta** — feature-complete core, 134/134 regression at cut. Known
not-yet: no live payment processed (sandbox E2E pending), Builder undogfooded on
a real site, VPS deploy unproven. First consumer: the Sidemoney build.


## [2.0.0-beta.1] — Pre-Sidemoney punch list (2026-07-25)

The alpha→beta gap-closers so the Sidemoney build session starts clean.

### Built
- **Settings → Site** (new section — documented 2.0-native addition, outside the
  1.9.44 parity list): site name, tagline, HOMEPAGE PICKER (published pages via
  select, or auto landing), and a **navigation menu editor** (add/remove/reorder;
  whole-array saves; empty = auto-built nav). Base Theme honors a stored menu
  outright — auto-build is the zero-config fallback.
- **Variant CRUD API**: POST/PATCH/DELETE /api/products/:id/variants(/:variantId) —
  cross-product paths 404; a variant with orders refuses deletion cleanly.
- **MediaPicker** — reusable modal grid over the real Media library (admin proxy for
  the list); pick → URL. First consumers: product editor primary image + gallery.
- **Product editor** at /products/[id] (the page WooCommerce calls Edit Product):
  name/status/description save-on-blur, primary image + gallery via MediaPicker
  (video entries badge ▶), category/tag toggle chips wired to the taxonomy API,
  variants table (inline sku/color/size/price/stock edits, add row, delete),
  products list links in.
- Admin proxies: GET /api/media list, catch-alls for /api/products/* and
  /api/catalog/*.

### Verified
Variant CRUD + cross-product 404 + custom-menu-overrides-nav tests added.
**Full regression 134/134, exit 0.** Both apps typecheck clean. (Admin pages
server-render behind login — visual pass rides Bam's next session.)


## [2.0.0-beta.1] — MCP site-ops + connections-powered dashboard (2026-07-25)

Bam's call on the AI-chat gap: don't reinvent the wheel — "having a connection to the
site for you to chat and do stuff, maybe with MCP, is the way." The MCP endpoint
(/api/mcp, JSON-RPC, tro_ token auth) grew from 2 tools to 7:

### Built
- New tools: `list_content` (type/status filters), `create_draft` (WRITE — draft-only
  by design, publishing stays human), `sales_report` (the C6 summary over MCP),
  `list_orders` (access tokens never included), `connections_status` (health, never
  credentials). Existing get_preview_url + check_queue_status unchanged.
- Scope enforcement at tools/call: write-flagged tools require a 'write'-scoped API
  token or a real admin session; read tokens can look, not touch (the route's old
  "re-check when a write tool lands" comment is now discharged).
- Dashboard (preview gap #1, first slice): **Connections status card** — sticky per
  Bam's spec ("always shown when any connector is active"), real Nexus state, health
  dots, needs-attention first, Manage →. **Claude · MCP card** — endpoint + token
  pointer, 7-tool count, "connect Claude to run this site" framing. Both in the bento
  grid.

### Verified
4/4 MCP tests (7-tool list; read token reads sales/connections but is BLOCKED from
create_draft; session write creates a real draft row; no accessToken/credential
leakage). **Full regression 132/132, exit 0.**


## [2.0.0-beta.1] — Preview gap review + credential-shape research round 2 (2026-07-24)

Full review of ALL 1.x preview HTMLs completed (agent pass over
connections-and-dashboard.html, therum-os-experience.html 12.8k lines,
dist/admin-preview.html [byte-identical dupe], previews/captures/). Findings
persisted as docs/PREVIEW-GAP-REPORT.md — 16 feature gaps + 9 visual gaps, sized,
with Bam's own annotation prose transcribed verbatim (the dashboard-composition,
chat-surface, customization, and connector-framework specs).

### Built this pass (quick closes from the report)
- 5 more providers with real key+secret shapes (round 2 of the auth research):
  Adyen (API key+merchant account), Authorize.net (login id+transaction key),
  Vonage (key+secret), Pusher (app id+key+secret+cluster), OneSignal (app id+REST
  key) — 12 structured providers total.
- V5 status strip on Connections header ("N connected · M action needed · T total").
- V2 stat-strip pattern: Vault tab gets the 4-up stats (Stored / Tested OK /
  Failing / Untested).
- Stale "67 providers" header line replaced (catalog is 76 now, counts live in tabs).

### Verified
Typechecks clean both apps; grid+strip+stats live in browser (1440px session);
full regression 128/128.


## [2.0.0-beta.1] — Nexus: structured key+secret credentials (2026-07-24)

Bam: "some have keys, keys + secrets, or secrets only." Providers now declare their
real auth shape: `fields` on the catalog entry (label + secret + optional per part)
render as separate inputs in the slide-over — masked where secret — and join into the
single vault string with EXACTLY the delimiter that provider's tester/gateway already
splits (':' pairs for Twilio/PayPal/Braintree/Trello; '|' for Square/Shopify/
BigCommerce). Structured: Twilio (SID+token), PayPal (client id+secret), Braintree
(public+private), Trello (key+token), Square (access token+location+optional sandbox),
Shopify (store domain+admin token), BigCommerce (store hash+token). Secrets-only
providers stay one masked field. Rotate-credential uses the same per-part form.
Verified live: Square panel renders the three labeled fields. Typechecks clean; no
backend change (vault format identical).


## [2.0.0-beta.1] — Nexus grid redesign: provider cards + slide-over (2026-07-24)

Bam: the section needed to be "much more robust — select stuff out of a grid, enter your
credentials right there, test stuff right there." The original design was already on
Drive: previews/connections-and-dashboard.html, whose spec line reads "click any card →
opens a slide-over panel with the connection form … once connected, the same panel
becomes the management surface … '+ Add custom' in every section." Built exactly that.

### Built
- Category tabs now render a PROVIDER CARD GRID (auto-fill 220px, the 1.x cn-grid):
  brand-colorway icon tiles (~27 real brand colors + stable hash-hue fallback), status
  dot top-right (connected green / test-failed red / off muted), connected cards get the
  green tint+border, masked-key or auth-type meta line, Connect →/Manage → footer CTA,
  hover lift.
- Click any card → SLIDE-OVER PANEL (400px, overlay-dismissed): not-connected API-key
  providers get the credential field (auto-focused) + Connect + live-test note; OAuth
  providers get Connect-with-X (when the app is configured) or the one-time client
  id/secret setup, plus the paste-a-token fallback; CONNECTED providers get the
  management surface — masked key, last-test status, Test connection, rotate-key,
  Disconnect, and the provider's inbound webhook URL.
- "+ Add custom connector" dashed card in EVERY category (per the preview spec) —
  opens the panel in blank-card mode (name + credential → custom-<slug> vault row).
- All existing handlers preserved (connect/disconnect/test/OAuth app/webhook secrets);
  Vault + Activity tabs untouched.

### Verified
Admin typecheck clean; live in the browser (real session): Fulfillment tab renders
Printful/Printify/Gelato cards with brand tiles; clicked Printful → slide-over opened
with the API-key form + Connect + test note, overlay dimming behind. Backend untouched
(128/128 stands).


## [2.0.0-beta.1] — Nexus: fulfillment (POD) category + custom-API connectors (2026-07-24)

### Built
- New `fulfillment` catalog category: Printful, Printify, Gelato, Gooten, SPOD, plus
  Bam's named partners Podplus, PodPartner, Tapstitch, Contrado (catalog 67 → 76;
  the named four are store-and-hold — no live testers until each API is verified). Printful + Printify have LIVE credential testers (bearer GET
  /stores and /v1/shops.json); the rest store-and-hold until their Counter fleet
  modules land. Doctrine reminder encoded in the catalog comment: these providers
  also quote shipping/tax — fulfillment delegates, no Woo-style zones engine.
- **Custom-API connectors**: any `custom-<slug>` id is now a first-class provider —
  same vault encryption, masked previews, audit log, and generic webhook receiver as
  catalog providers. findProvider synthesizes the entry (name from slug, category
  'custom'); list() surfaces connected customs alongside the catalog. Optional
  self-test: store the credential as `key|https://test-url` and the Test button does
  a bearer GET against that endpoint. Malformed ids (regex-gated) still 404.
- Admin Connections: Fulfillment + Custom tabs added, with an "Add connector"
  form on the Custom tab (slug + credential → the standard connect flow).

### Verified
4/4 fulfillment tests (catalog entries + tester flags, printful vault flow,
custom-* connect → list surface under Custom with masked credential → disconnect,
malformed/unknown ids rejected). **Full regression 128/128, exit 0.**

## [2.0.0-beta.1] — Product media: hover-video cards (2026-07-24)

Bam's feature: cards show stills; hover plays the product's video; no video → arrows
flip through the gallery. "A really cool feature I haven't seen in many things."

### Built
- Gallery schema: `images[]` entries accept `type: image|video` + `poster`; type also
  inferred from the extension (.mp4/.webm/.mov). No migration (Json column).
- `normalizeGallery()` — one ordered media list per product (primary image + gallery),
  video stills resolved via poster → primary-image fallback.
- Shop cards: still + hidden `<video muted loop playsinline preload="none">` (zero
  bytes downloaded until hover) + prev/next arrows + dot indicators when multiple
  stills. Runtime: hover-capable devices get video-on-hover (arrows/dots fade during
  playback, video resets on leave); arrows are tap-targets everywhere — that's the
  mobile story (`@media(hover:none)` keeps them visible; hover wiring is gated on
  `matchMedia('(hover: hover)')` so touch devices never bind it). Arrow clicks
  swallow the event so taps don't navigate the card link.
- Product page gallery: video entries first-class — badge (▶) on the thumb, selecting
  one plays it (controls, muted, autoplay) in the main slot; stills swap back.
- Storefront CSP: `img-src`/`media-src` widened to https: for CDN-hosted media.

### Verified
- Markup/schema test (video accepted, preload="none", arrows+dots, CSP, .webm
  inference). **Live browser: hovered the Starter Tee card and watched the video
  fade in over the still** (arrows/dots auto-hid). Mobile-emulation caveat noted:
  the resized pane still reports hover-capable, so the hover:none path is verified
  at the CSS/markup level, not visually. **Full regression 124/124, exit 0.**

## [2.0.0-beta.1] — Counter C6: receipts, refund notices, sales reports (2026-07-24)

### Built
- `notificationService.sendToAddress` — customer-facing sends over the existing
  per-call SMTP transport (same timeouts/leak guards); silent no-op until SMTP is
  configured in Settings → Notifications.
- `commerceEmail.service.ts` — plain-text order receipt (line items, discount line,
  total, tokened receipt link when PUBLIC_ORIGIN is set) fired on CONFIRMED payment
  (webhook apply path, fire-and-forget — SMTP can never slow a webhook ack), and a
  refund notice fired when succeeded refunds cover the whole order.
- `salesReportService.summary(days)` + `GET /api/reports/sales?days=N` (authenticated):
  paid-orders-only (pending never counts as revenue), gross/refunded/net/discounts/
  average-order, top products by revenue, daily buckets.

### Verified
2 new tests (report math invariants + auth; email paths are safe no-ops without SMTP
and never throw). **Full regression 123/123, exit 0.**

## [2.0.0-beta.1] — WP Bridge design draft (2026-07-24)
`docs/superpowers/specs/2026-07-24-wp-bridge-design.md` — the Studio App that runs WP
themes, bounded WP plugins, and Bricks WITHOUT full WordPress. Three tiers (theme PHP
shim → Bricks importer/renderer → bounded plugin compat), research checklist gated
before code. First consumer: the Sidemoney local build session.

## [2.0.0-beta.1] — Catalog presentation (2026-07-24)

"1:1 Woo but better": the shop grew its presentation layer.

### Built
- Taxonomy models: `ProductCategory` (hierarchical, cycle-guarded reparenting) +
  `ProductTag`, m-n joins to products; `Product.images` gallery ([{url, alt}], max 20)
  alongside the existing primary image + description.
- `taxonomy.service.ts` + `/api/catalog/categories|tags` CRUD and
  `PUT /api/products/:id/taxonomy` assignment (authenticated reads, storefront-manager
  writes — same convention as products/coupons).
- `/shop` rebuilt: search (name AND description, case-insensitive), filter rails as
  chips — Category, Tags, Color, Size (the last two derived live from active variants,
  filling Woo's attribute-filter role) — all riding the query string so every filtered
  view is a shareable, crawlable URL. Toggle chips on/off; empty state offers
  clear-filters. Cards now show product images and category lines.
- Product page: image gallery (main + thumb strip switcher), description block,
  category/tag pills that link back into the filtered shop.

### Fixed
- integration.test.mjs had leaked ACTIVE "IT Product" rows + their orders into the
  shared dev DB (and the public /shop) on every run since C1 — purged 17 products +
  35 orders and made the suite clean up after itself (orders first, FK order).

### Verified
5/5 catalog tests (CRUD + cycle guard + gating, assignment, search-by-description,
each filter narrowing + combined filters, gallery/description/pills, card images).
Live browser: filter rails + search on /shop, Starter Tee page with description and
Apparel/#Basics pills. **Full regression 121/121, exit 0; post-suite leak check: 0.**

## [2.0.0-beta.1] — Base Theme: the public site frontend (2026-07-24)

2.0 finally has a face. Bam: "default theme so stuff is just popping up" — Sidemoney
needs to ship; the full theme system is recorded in docs/FUTURE-BUILDOUT.md.

### Built
- `src/site/siteHtml.ts` — Base Theme shell: same real-1.9.44 token values as the
  storefront (one visual system across the whole public surface), prose styles for
  rendered bodies, card indexes, nav, footer. Server-rendered, zero client JS.
- `src/api/routes/site.ts` — the public site: `/` (configured homepage via new site
  settings, else an auto-landing from published work/posts), pages at `/:slug`, posts
  at `/blog(/:slug)`, case studies at `/work(/:slug)`, themed 404. Nav auto-builds
  from published pages + Blog/Work/Shop as they exist. Published-only everywhere
  (drafts 404). CMS metaTags + JSON-LD injected into every content head; canonical
  carries the section prefix (/work/x canonicalizes to /work/x, not /x).
- Site settings: `settingsService.getSite/setSite` ({siteName, tagline, homepageSlug})
  + `GET/PATCH /api/settings/site` (authenticated / manage-settings).
- Bare `/` moved from the shop redirect to the site renderer — the shop is a section
  of the site now, not its root.

### Verified
- 7/7 site tests: landing + homepage modes, SEO head injection, draft leak-proofing,
  type-scoped URLs, /shop not shadowed by /:slug, settings auth. Live browser: real
  landing with the actual published Sidemoney Rebrand case study, /work/sidemoney-
  rebrand rendering with correct canonical. **Full regression 116/116, exit 0.**

## [2.0.0-beta.1] — C5a: Square gateway (2026-07-24)

Direction (Bam): Square as the real second rail; Braintree and WooPayments are NOT
separate integrations — their logic is absorbed (WooPayments = Stripe rails + instant
payout, his goes to Square; Braintree = aggregation the method registry's provider
routing already does). CORRECTION recorded: his setup is WooPayments→Square, not Whop.

### Built
- `src/lib/payments/squareGateway.ts` — full PaymentGateway contract via bare REST
  (no SDK): Payment Links hosted checkout (createIntent → redirectUrl; idempotency
  key scoped to the order so double-submits re-mint the same link), refunds resolved
  order→tender→payment with idempotency, webhook verify = constant-time
  HMAC-SHA256(notificationUrl + rawBody) base64, status-aware event mapping
  (COMPLETED→succeeded; FAILED/CANCELED/REJECTED→failed — Stripe audit H-2 lesson
  pre-applied), order_id reconcile fallback in the payment note, sandbox support.
  Credential convention: "accessToken|locationId(|sandbox)"; webhook secret
  "signatureKey|notificationUrl".
- Registered in GATEWAYS — connecting Square in Nexus lights up Card, Cash App, and
  Afterpay in the checkout method strip with zero further code.

### Verified
- 5/5 gateway tests (signature verify + tamper reject, payment/refund status maps,
  credential validation, strip lighting: card/cashapp/afterpay flip available with
  venmo correctly still dark). **Full regression 109/109, exit 0.**

## [2.0.0-beta.1] — C4.1: tabbed payment method strip (2026-07-24)

Bam: WooCommerce's payment picker sucks — 1.x Counter had tabbed selection. Ported the
real thing: previews/checkout-experience.html's method strip + MethodRegistry.php, 1:1.

### Built
- `src/lib/payments/methodRegistry.ts` — 1:1 port of 1.x MethodRegistry: 20 methods in
  six strip groups (card | wallets | bnpl | bank | crypto | p2p) with ordered provider
  lists (router picks first connected), needsRedirect hints, and panel copy. 'mock'
  appended to card's providers as the dev/testing rail. NO CHECKS EVER (test-enforced —
  the registry can never contain a check/cheque method).
- `paymentGatewayService.methods()` + public `GET /api/checkout/methods` — grouped
  registry, each method resolved to its first CONNECTED provider; unresolved methods
  still ship (Bam's ruling: show what's possible, "setup required" until Nexus connect).
- Checkout page rebuilt around the strip (1.x CSS ported: pills with colored icon chips
  + hover preview tooltips, active-pill surface+shadow, panelIn animation; BNPL brand
  tiles Klarna/Affirm/Afterpay/Sezzle/Zip/PP-Credit; crypto coin chip grid BTC/ETH/USDC/
  USDT/SOL/XRP with QR note; wallets + P2P + bank rows). Selecting a method drives which
  provider gets the payment intent.

### Verified
- Live browser: six-tab strip renders; Card lights up via mock and is auto-selected;
  Pay later shows all six BNPL tiles "SETUP REQUIRED"; Crypto shows the coin grid;
  tab switching animates panels; placed a real order through the strip (card → mock) →
  receipt THR-20260724-6bb72752d1. Method-strip API test added (group order, resolved
  provider, setup-required state, no-checks invariant). **Full regression 104/104,
  exit 0.** Dev mock re-seeded post-suite (test cleanup removes it — this is why Card
  briefly showed "setup required" mid-verify).

## [2.0.0-beta.1] — Counter C4: public storefront (2026-07-24)

The five public surfaces, server-rendered from the SAME Fastify process as the API
(same origin, so the cart runtime's /api fetches need no CORS). Zero client framework —
plain HTML + a small vanilla-JS cart runtime; all colors/type/spacing from the real
1.9.44 token values (shared/therum-tokens.css): #fafafa canvas, white surfaces,
near-black ink, blue action buttons, red only for brand.

### Built
- `src/site/storefrontHtml.ts` — layout/escape/money helpers, tokened CSS, client cart
  runtime (token in localStorage, x-cart-token header — never in a URL, C2 M-3 applies
  to pages too).
- `src/api/routes/storefront.ts` — GET /shop (active-only catalog grid; drafts can never
  leak), /product/:slug (variant picker with live price/stock swap, draft+unknown 404),
  /cart (client-hydrated: qty steppers, coupon apply/remove), /checkout (guest email,
  gateway radio list from /api/checkout/gateways, place-order → intent → receipt),
  /order-received/ (server-rendered receipt, access token constant-time-compared, wrong
  token = generic 404 — the URL C1's finalizeReturn already redirects to), bare / → /shop.
- Per-route CSP for HTML pages (helmet's global script-src 'self' would strip the inline
  runtime): self-only fetch/img, inline allowed, nothing external loadable.
- Capability gate: commerce off → every surface renders a "store isn't open yet" page.
- nginx: shop.therum.example server block (bare-/ takeover) added to deploy/nginx.conf.

### Verified
- `test/storefront.test.mjs` 5/5: active-only + draft-never-leaks, product 404s, shells,
  receipt token auth (wrong/missing token 404), capability-off closed page.
- **Live browser walk of the entire purchase flow**: shop grid → Starter Tee page →
  variant S→L (price $19.99→$21.99, stock swap) → add to cart (badge 1) → cart qty bump
  (badge 2) → lowercase "welcome10" applied as WELCOME10 −$4.40 (case-insensitivity live)
  → checkout $39.58 (= 43.98 − 4.40) → mock gateway → order THR-20260724-90528b4262
  receipt with coupon line + guest email + awaiting-payment pill, cart cleared.
- **Full regression 103/103, exit 0.**
- Housekeeping: 12 leftover "IT Product" integration-test rows set to draft (hidden from
  storefront; deletion blocked by order FKs). Mock gateway + WELCOME10 left connected in
  dev so checkout stays playable.

## [2.0.0-beta.1] — Counter C3 hardened: coupon audit + remediation (2026-07-24)

Hostile audit (attacker + accountant) found 1 HIGH + a cluster of accounting-integrity
gaps, all one shape: validate-then-increment was non-atomic. Fixed; full regression 98/98.

### Fixed
- **F1/F2/F4 (HIGH) usage-limit race**: the global/per-user limit was checked in
  validate() and the counter bumped separately — N concurrent checkouts of a limit:1
  coupon all passed and all redeemed. Replaced record-after-create with an atomic
  `reserveForOrder`: a conditional `UPDATE … WHERE usage_count < usage_limit` claims the
  slot (exactly one winner), per-user cap re-checked inside the same transaction with
  rollback, and the discount is applied to the order ONLY if the slot was won (new
  `orderService.applyDiscount`, pending-only, syncs the payment amount). A slot lost to a
  concurrent checkout means the order stays full price — never a discount that wasn't
  counted. Proven by a real concurrent-checkout test (exactly-one-redemption).
- **F3** recordForOrder no longer swallows all errors — only P2002 (retry) is absorbed;
  real faults surface.
- **F5** release-on-refund is now a guarded one-shot (`updateMany WHERE releasedAt:null`)
  — concurrent releases can't double-decrement usageCount below zero.
- **F6** coupon release moved to the CONFIRMED-refund path (refund.succeeded webhook, only
  when succeeded refunds cover the order) — a refund that later fails no longer frees a
  slot for money that never moved.
- **F7** coupon-apply rate-limited per IP (20/10min) and the 404-vs-422 response unified
  to one "not valid" message — no code-enumeration / config-leak oracle.
- **F8** codes normalized to uppercase on store + lookup — 'save10' == 'SAVE10'.
- The `discountOverride` order path (the audit's TOCTOU surface) removed entirely —
  coupons now apply post-create bound to the reservation.

### Verified
coupon suite 6/6 (incl. the concurrency race + confirmed-refund release + case-insensitive
+ unified-error tests). **Full regression 98/98, exit 0.** (Also: cart/coupon tests now
clear their per-IP rate-limit keys in setup so a prior run's window can't 429 the suite.)

## [2.0.0-beta.1] — Counter C3: coupons (2026-07-24)

Ported from 1.x Counter's CouponService + coupons/coupon_redemptions schema. Spec:
`docs/superpowers/specs/2026-07-24-counter-c3-coupons-design.md`. Doctrine: coupon and
Milieus member discount do NOT stack — best single wins.

### Built
- `Coupon` + `CouponRedemption` models (percent|fixed, min/max subtotal gates, global +
  per-user usage limits, date window, status, individualUse). v1 scope: percent|fixed,
  cart-scope, single coupon per cart (1.x's product/vendor scope + free_shipping +
  auto-promotions deferred).
- `coupon.service.ts` — admin CRUD; the 1.x validation reasons (inactive, date window,
  global limit, per-user limit by guest email, min/max) enforced on BOTH apply and every
  recalc; percent/fixed math capped at subtotal (never negative); redemption ledger with
  usageCount bump on checkout and release-on-refund (a refunded order frees the per-user
  slot).
- Admin routes `/api/coupons` (authenticate + commerce + storefront-manager on mutations).
  Deliberately NO public coupon-lookup route — validity is probed only inside the cart, so
  codes can't be enumerated.
- Cart integration: POST/DELETE `/api/cart/coupon`; totals quote the stored code live and
  silently drop it if it's gone invalid mid-session (1.x recalc rule); best-single-wins
  vs the member discount. Checkout passes the realized discount to the order as an explicit
  override and records the redemption (idempotent via UNIQUE(couponId, orderId)).
- Full refund releases coupon redemptions alongside the existing cancel+restock.

### Verified
- `test/coupons.test.mjs` 5/5: admin gating + percent>100 + dup-409, percent/fixed math +
  all validation reasons, live recalc drop on global-limit-hit, the full ledger lifecycle
  (checkout redemption + usageCount bump → per-user block → pay → full refund releases +
  frees the slot), best-single-wins. **Full regression 97/97, exit 0.**

## [2.0.0-beta.1] — Counter C2 hardened: cart audit + remediation (2026-07-24)

Direction: "get C2 situated, close any remaining gaps in C1." C1 was already audited+
fixed; this pass hostile-audited C2 (cart/checkout) and the C1↔C2 seam. One HIGH + five
mediums/lows fixed; the money core verified solid. Full regression 92/92 exit 0.

### Fixed — the HIGH (H-1/M-2): unauthenticated discount theft + enumeration oracle
An anonymous cart could attach ANY email via /cart/identity, which (a) computed and
returned that customer's Milieus member discount — a clean membership/PII oracle over
guessed emails — and (b) at checkout bound the order to the victim's customer record at
the victim's member rate, with the payment token handed to the attacker. Root fix: the
storefront email is now a GUEST CONTACT only (new `Order.guestEmail`, Woo's billing_email
model) — no customer lookup, no discount, no account binding from an unverified address.
Member discounts remain a logged-in benefit flowing only through the authenticated admin
order path; storefront customer auth + member pricing is a future milestone. Tested:
typed member email → null discount, list price, `customerId` stays null, email recorded.

### Fixed — hardening
- M-3 token-in-URL: the cart token (the only credential) moved off the URL path onto an
  `x-cart-token` header for read/delete — no more leaking it into request/nginx/Referer
  logs. GET /cart/:token route removed (path token now 404s, tested).
- M-4 cart-creation DoS: per-IP rate limit (30 new carts/hour) on the lazy-mint path —
  unbounded anonymous 7-day Redis keys were a memory-DoS vector.
- M-5 Redis fail-slow: the shared client had `maxRetriesPerRequest: null` (commands
  queued forever when Redis was down → cart requests hung). Now finite retries +
  connect/command timeouts → fail fast. (Not the BullMQ connection, which is separate.)
- L-1 stock-conflict message now names the SKU, not the internal variant id.
- L-3 corrupt cart value resets to not-found instead of 500 (guarded parse, tested).

### Verified clean (audit)
No oversell (the transactional reserve is the real gate; cart pre-check is advisory);
prices never trusted from the cart (order re-reads the catalog); idempotency/concurrency
correct (shared transaction + P2002 → stock reserved exactly once on double-submit);
money math identical cart↔order to the cent; no IDOR / Redis namespace collision;
capability gate anonymous-safe; accessToken exposure contained to the creator.

### Verified
checkout suite 11/11, cart suite 8/8 (incl. 4 new audit-regression tests). **Full
regression 92/92, exit 0, 0 cancelled.** C1 and C2 both closed.

## [2.0.0-beta.1] — Counter C2: unified cart/checkout session (2026-07-23)

The 1.x differentiator, ported: cart and checkout are ONE Redis-backed state
container, created LAZILY on first add-to-cart (anonymous browsing = zero session
overhead). Prices are never stored in the session — totals compute live from the
catalog on every read, so price changes always reflect.

### Built
- `cart.service.ts` + public `/api/cart/*` routes (capability-gated, anonymous by
  design — the 128-bit cart token is the only credential, sliding 7-day TTL):
  add/merge lines (caps: 50 lines, 999 qty), set-quantity/remove, get (slides TTL),
  identity attach, clear, checkout.
- **Totals pipeline** with stable slots the storefront can rely on: lines → subtotal
  → Milieus member discount (largest-single-wins, unlocked by attaching the checkout
  email) → coupon (C3 slot) → shipping/tax (provider-interface slots) → total.
- **Checkout handoff**: live stock validation (409 names the short SKUs), guest
  customer upsert by email, order created through the REAL order service (inventory
  reservation, discount, access token — all existing machinery), session cleared.
  The cart token doubles as the order idempotency key — a double-submitted checkout
  returns the SAME order instead of reserving stock twice.

### Verified
- `test/cart.test.mjs` 6/6: lazy session mint, live-price totals (price change
  reflected instantly), quantity ops + inactive-product block, member discount in
  cart totals (20% live), stock-conflict naming, and the FULL C1+C2 lifecycle —
  cart → checkout → order (discounted) → intent → signed webhook → paid, plus the
  idempotency-key dedupe proof. **Full regression 90/90, exit 0.** Fixtures removed.

Next: C3 coupons → C4 storefront surfaces → C5 provider fleet → C6 money ops.

## [2.0.0-beta.1] — Counter C1 hardened: payment audit + full remediation (2026-07-23)

Direction: "close all gaps in C1, audit, then proceed to C2." Hostile payment-focused
audit (attacker + accountant lens). Every confirmed finding fixed and regression-tested
same session; full regression 84/84 exit 0.

### Fixed — the two criticals
- **C-1 lost payment events**: ledger-insert-then-apply meant a throwing apply left the
  event ledgered; the provider's retry read as a replay and no-oped — customer charged,
  order never marked paid, forever. Now: events carry an `applied` flag; success is
  acknowledged ONLY after apply completes; a ledgered-but-unapplied event RE-APPLIES on
  retry. Proven by test (manually seeded stuck event → retry applies it).
- **C-2 double refunds**: idempotency key was random per call — a network retry created
  a second provider refund with a fresh key; plus refundable was read outside any
  transaction (two concurrent refunds could both pass the cap). Now: deterministic key
  (client-supplied or derived from orderId+amount+reason) with the DB unique constraint
  turning retries into return-the-existing-refund (NO provider call — proven by test);
  amount RESERVED via conditional update (cap enforced in the WHERE) before the
  provider call, rolled back on gateway failure or unique-race loss.

### Fixed — highs
- **H-1 guest-token harvest**: admin order list/get/transition returned `accessToken`
  (an order's permanent bearer password: intent creation + return-leg finalization +
  future receipt PII) to ANY authenticated session including read-only roles. Stripped
  everywhere except the create response. Test asserts absence.
- **H-2 failed Stripe refunds recorded as succeeded**: `refund.updated` was mapped to
  refund.succeeded unconditionally — Stripe emits it for FAILED refunds too. Now mapped
  by the refund object's own status (succeeded/failed/canceled/pending), unit-tested.

### Fixed — mediums/lows
- M-1 orphaned intents: webhooks now fall back to `metadata[order_id]` (stamped on
  every intent) when txnId was overwritten by a later createIntent — a success on any
  issued intent still resolves its order; unknown intents log a reconcile warning.
- M-2 refund.failed rollback: status flips exactly once via a guarded updateMany
  (pending|succeeded → failed) — no double decrement, and provider-reversed successes
  are corrected.
- M-3 type hole: `refund()` contract now takes a typed `ctx: { intentId }` — both
  `as never` casts gone.
- M-4 currency: Zod allowlist (USD/EUR/GBP/CAD/AUD, all 2-decimal) — zero-decimal
  currencies (JPY…) stay out until minor-unit normalization is built per gateway.
- L-1 webhooks without a raw body now 400 with a clear message (re-serialized JSON can
  never match a signature — fail loudly, not confusingly).
- L-2 anonymous `/checkout/gateways` now lists CONNECTED gateways only (no provider
  recon); admin surfaces will use includeUnconnected.
- L-3 mock gateway reads unknown intents as unpaid (was: succeeded — a restart-wiped
  map could have marked orders paid).

### Verified
- checkout suite 11/11 (5 new audit-regression tests: token absence, retry idempotency
  incl. derived-key dedupe, stuck-event re-apply, status-aware refund mapping + metadata
  fallback, connected-only public list). **Full regression 84/84, exit 0, 0 cancelled.**
- Audit's verified-clean list held: constant-time non-oracle guest auth, no mock
  reachability in production, internal credential methods unrouted, webhook 404s
  pre-ledger for unknown providers, markPaid double-apply guards, Stripe signature
  verification sound.

C1 is closed. C2 (unified cart/checkout session) begins.

## [2.0.0-beta.1] — Counter C1: the payment gateway layer (2026-07-23)

The big build begins. Direction: "a WooCommerce replica in theory almost 1:1, but
faster/smarter — same logic, better core." Epic spec + milestone map (C1–C6):
`docs/superpowers/specs/2026-07-23-counter-native-design.md`. Source of truth: the 1.x
Counter plugin (253 files; PSPGateway.php contract ported verbatim). Doctrine enforced
structurally: no check/eCheck gateway exists in the registry, ever.

### Built (C1)
- **Gateway contract** (`src/lib/payments/gateway.ts`) — 1.x PSPGateway 1:1: id/
  displayName/supports(capability)/createIntent/refund(idempotent)/verifyWebhook/
  parseEvent, plus intentStatus for the redirect-return leg. Canonical event kinds
  payment.*, refund.*, dispute.*.
- **Models**: `PaymentEvent` ledger (replay deduped on UNIQUE(provider,
  provider_event_id), sha256-of-body fallback for id-less providers — 1.x provisions
  rule), `Refund` (partial/full, provider refund id, idempotency key),
  `Order.accessToken` (128-bit guest receipt/checkout token, constant-time compared)
  + `Order.refundedTotal`.
- **Gateways**: MockGateway (full contract incl. REAL HMAC webhook verification — the
  test suite exercises the genuine verify path, not a stub) and Stripe (PaymentIntents
  + refunds via bare REST/fetch — no SDK dependency; webhook verify reuses the
  existing verifyStripeSignature; canonical kind mapping).
- **Nexus is the only credential store**: gateways resolve their secret via a new
  internal connectionService.credentialFor(); a gateway is "available — setup
  required" until its provider is connected (the exact UX Bam described: sign back in
  → checkout lights up). Webhook signing secrets come from the existing Nexus
  WebhookSecret store with credential fallback.
- **Routes**: GET /api/checkout/gateways (public, capability-gated), POST
  /api/checkout/intent (guest-safe — authenticated by the ORDER's own access token,
  one 401 for wrong-order/wrong-token, no oracle), GET /api/checkout/return (the
  endpoint 1.x's redirect gateways pointed at but never registered — verifies status
  with the provider, never trusts the query, 303s to the receipt), POST
  /api/webhooks/psp/:provider (signature-verified through the gateway, ledgered,
  applied), POST /api/orders/:id/refund (admin + storefront-manager bundle).
- **Refund accounting**: atomic (refund row + refundedTotal in one transaction);
  over-refund 422; partial leaves order status alone; full-remaining refund cancels
  through the REAL order state machine (which owns restock); refund.failed webhook
  rolls the accounting back.

### Verified
- `test/checkout.test.mjs` 6/6 — full mock lifecycle: token minting, gateway
  availability vs Nexus connection, guest-token auth (+401/409 paths), forged/unsigned
  webhook rejection, payment.succeeded → processing with reservation→sale inventory
  conversion, replay dedup, unknown-kind no-op, bundle-gated refunds, partial→full
  refund with cancel+restock, refund.failed rollback, return-leg 303 with token.
- **Full regression 79/79, exit 0, zero cancelled.** All fixtures removed.

### Next (per the epic spec)
C2 cart/checkout session (Redis, unified container, totals pipeline) → C3 coupons →
C4 storefront surfaces → C5 provider fleet (Square/Braintree/Whop/PayPal/Zip/Sezzle/
Plaid/Zelle/Crypto) → C6 refund UI, receipts, reports.

## [2.0.0-beta.1] — Pre-Counter full audit + remediation (2026-07-23)

Direction: "run one more audit to make sure we have everything we need built out thus
far before we get to Counter." Two hostile agents (backend security lens; admin UI/proxy
lens) + a direct sweep. Every confirmed finding fixed same-session; full clean
regression after: **73/73 pass, 0 cancelled, exit 0** across all 12 test files.

### Fixed — backend
- **CRITICAL (caught by direct sweep AND agent, independently): the partial()-keeps-
  defaults clobber existed in TWO more update schemas.** UpdateMilieuInput — a
  name-only PATCH injected discountPct:0/regEnabled:false/etc, wiping discounts and
  tearing down registration links. UpdateProductInput — a name-only PATCH injected
  status:'draft' (de-listing live products) + meta:{}. Both rebuilt as explicit
  optional-no-default objects (content pattern); proven empirically (parse({name})
  yields exactly {name}); regression tests added (milieus 13/13). Third and fourth
  instances of one footgun — every .partial() in src/ now verified clean.
- **HIGH: cluster applyMembers made transactional** (Serializable) — the steal step
  deleted donor memberships before target insertion with no transaction; a crash
  between the writes permanently stripped products from an unrelated group, and
  concurrent edits could interleave into corrupted membership. Whole body now one
  db.$transaction, donor-dissolution recount included.
- Cluster primary-resolution deduplicated into one pickPrimary() helper (list() had
  inlined a diverging copy). Telegram tester credential now encodeURIComponent'd
  (latent, pre-existing).

### Fixed — admin
- Connections mutations no longer fail silently: connect/saveOAuthApp/
  saveWebhookSecret/disconnect surface the backend's error message (was try/finally
  with no catch and no !res.ok branch — wrong API key produced zero feedback).
- Nexus tab survives OAuth round-trips: tab mirrored to ?tab= (init-from-URL +
  replaceState), start link carries the category, start/callback proxies persist it
  through the provider redirect via a short-lived cookie.
- OAuth start/callback proxies now build ALL URLs via redirectUrl() instead of
  req.url — behind nginx, req.url is the internal :3100 bind, so the provider's
  redirect_uri bypassed the front door (pre-existing).
- CardResizeHandle: pointercancel/cleanup handling (a cancelled touch drag left
  hover-resize listeners attached forever), save-failure revert, no-op on failure
  instead of unhandled rejection; resize Route Handler returns JSON (its only caller
  is the fetch — following the old 303 downloaded the dashboard HTML for nothing);
  grip hidden below 900px where the grid ignores spans anyway.
- Case-study Details form re-seeds from current props on every open (stale mount-time
  values could resurrect overwritten data after router.refresh); Details kebab item
  respects busy.
- Search inputs double-padded by the global control rule fixed (padding:0 on
  .th-lp-search-input/.settings-search input — wrappers carry the padding).
- ClustersClient: delete confirmation, truly-parallel detail fetches (were
  accidentally serialized), typeahead sequence guard (stale responses could
  resurrect picked products), BASE_PATH instead of 8 hardcoded /tos-admin strings.

### Accepted / declared (not fixed, on purpose)
- Meta merge-on-write lost-update window (concurrent writer between PATCH and
  refresh) — inherent to replace-on-write; documented, revisit if collaborative
  editing lands. Cluster list() N+1 drift queries — bounded, follow-up. Drift ignores
  zero-dimension members — matches 1.x. Force-included curated sections render at
  top — cosmetic.

### Verified clean by the audit (highlights)
Google OAuth family fallback cannot leak apps to non-Google providers; OAuth state is
provider-bound; Braintree basic-auth is header-injection-safe; no credential URL
interpolation in any new tester; cluster authz complete (capability + bundle on every
mutation); studio-app mutations bundle-gated; all 8 cluster fetch→proxy→backend pairs
match; content PATCH path genuinely fixed.

## [2.0.0-beta.1] — Case Studies follow-ups + a real content-API bug found and fixed (2026-07-23)

### Built
- **Case-study Details editor**: kebab → Details on case-study cards — client, project
  date, services, one-line outcome, stored under `Content.meta.caseStudy` via a new
  PATCH proxy (merge-on-write client-side so unrelated meta keys survive). Client name
  surfaces as a pill on the card. Case-studies-only (flag threaded from the list page;
  shared ContentCard stays clean for pages/posts).
- **Case-study SEO**: case studies now emit OG `type=article` + the full Article
  JSON-LD node (same treatment as posts — one condition in resolveSeo, which
  buildJsonLd already keys off).

### Fixed — found live by the new editor's first save
- **`UpdateContentInput = CreateContentInput.partial()` kept the .default()s** — any
  partial PATCH silently injected `type:'page'`, `status:'draft'`,
  `bodyFormat:'canvas'`, `seo:{}`. The very first meta-only save through the new PATCH
  path un-typed AND un-published the real "Sidemoney Rebrand" case study and reset its
  seo. Latent since Folio shipped — nothing PATCHed through this schema before (publish
  uses its own route). Update schema rebuilt with plainly-optional fields, zero
  defaults; parse of `{meta}` now yields exactly `{meta}`. Row fully restored (type,
  published status, original publishedAt; its seo had been the default `{}` anyway).
  Same trap as Milieus' regConsistent refactor — partial()-over-defaults is now a known
  codebase footgun, twice.
- Regression test added (create published case study with custom SEO → meta-only PATCH
  → type/status/seo all survive): content suite 5/5. Verified live twice: broken path
  reproduced + damage confirmed via DB ground truth; fixed path re-run end-to-end with
  the row staying published/case_study and the new outcome persisted.

## [2.0.0-beta.1] — Case Studies Studio App + Nexus polish (2026-07-23)

Direction (voice): build the case-study plugin ("call it Case Studies for now") enabling
portfolio functionality; give the Connections provider list category tabs instead of one
long list; rename the nav entry to "Nexus."

### Built — Case Studies (fifth Studio App)
- Registry entry `case-studies` with new `curatedSection` flag: this app's nav lives in
  the sidebar's CURATED Portfolio section (pre-built since the nav port, hardcoded off
  until now) rather than the generic Studio section — no double entry. Enabling the app
  is the 2.0 rebirth of 1.9.44's `therum_case_studies_enabled` option: layout resolves
  `portfolioActive` from it, Portfolio joins the curated-section force-include list.
- `/case-studies` page = third caller of the shared ContentTypeListPage (the component's
  own comment predicted exactly this). Full canvas/builder, SEO, publish flow inherited
  from Folio — `type: case_study` existed in the schema since Folio shipped, deliberately
  not user-facing until this app. NewContentButton type union widened.
- Proof it rides the real pipeline: on first render the page surfaced "Sidemoney
  Rebrand" — a pre-existing case_study row invisible to the UI until today.

### Changed — Nexus
- Nav label "Connections" → **"Nexus"** (registry navLabel; topbar follows).
- Provider list: the single Providers tab (67 rows stacked) replaced by five CATEGORY
  tabs with counts — AI tools (13) / Messaging & APIs (13) / Ecommerce (8) /
  Payments (13) / External apps (20) — plus Vault and Activity. Verified live: tab
  switch renders only that category.

### Verified
- Backend + admin typecheck clean; studio/google-connections/content suites 18/18.
- Live browser: nav shows Nexus + Case Studies (Portfolio section, no Studio-section
  duplicate), /case-studies lists the real existing item, category tabs functional.

## [2.0.0-beta.1] — Nexus: Whop provider + payments doctrine recorded (2026-07-23)

Direction (voice): checks are NEVER a payment method — standing rule for the Counter
checkout milestone. Bank/ACH, cards, P2P (Cash App Pay via Square, Venmo via
Braintree/PayPal), BNPL (Zip/Sezzle — 1.x provider modules port with checkout), crypto
all wanted. Bam's REAL current rails: **Whop Payments connected to his Square** for
instant payouts (dictation renders it "who/loop payments" — when he says Braintree he
sometimes means Whop; both are wanted). Stripe stays a first-class gateway but not the
only rails — multi-gateway Counter architecture is deliberate so payout routing is
per-site. Reconnect UX confirmed: relaunching a site = sign back into the provider in
Nexus → Counter gateways flip from "setup required" to live.

### Built
- `whop` provider (Payments) + live tester — endpoint found by probing: `api/v2/me`
  is the auth-checked path (v5 paths 403 shielded); fake key proven rejected with a
  real 401 through the full connect→test→disconnect path, rows cleaned. Catalog 67,
  testable 38.

## [2.0.0-beta.1] — Nexus punch-list: Dropbox, Figma, Calendly, Braintree testers (2026-07-23)

Direction: promote these four from storage-only, Braintree chosen deliberately as the
aggregator gateway (cards + PayPal + Venmo through one integration). Architecture call
confirmed alongside: Nexus stays the credentials vault for ALL providers including
payments; Counter's future checkout milestone consumes those connections (gateways show
"available — connect in Nexus to enable" until their account is connected). 1.x already
points this way: Counter owns the gateway provider modules (Zip/Sezzle/Crypto port with
that milestone), Nexus owns the keys.

### Built
- Live testers: Dropbox (POST get_current_account), Figma (X-Figma-Token /v1/me),
  Calendly (bearer /users/me), Braintree (GraphQL authenticated viewer→merchant query,
  basic auth over "Public Key:Private Key" — new credentialHint — with production→
  sandbox endpoint fallback). New POST helper for POST-only identity endpoints.
  Testable: 33 → 37 of 66.

### Caught during live probing (why "test with fake creds" is the standard here)
- First Braintree tester used their GraphQL `ping` — which answers 200 OK WITHOUT
  authentication. Fake credentials tested green. Replaced with the authenticated
  viewer/merchant query and a non-null merchant requirement; fake creds now correctly
  rejected. Dropbox/Figma/Calendly proven against real APIs via genuine 401/403/401
  rejections. All probe rows and audit entries cleaned after.

## [2.0.0-beta.1] — Nexus: Google family (Gmail, Calendar, Sheets) (2026-07-23)

Direction: "connect anything Google — Gmail, Drive, Calendar, etcetera." First item off
the new Nexus punch-list. Catalog grows 63 → 66.

### Built
- Three new OAuth providers: `gmail` (Messaging), `google-calendar` + `google-sheets`
  (Apps) — Google Drive's existing OAuth rails generalized to the whole family (shared
  `GOOGLE_AUTH` endpoints; per-service readonly scopes: gmail.readonly,
  calendar.readonly, spreadsheets.readonly).
- **Shared-app fallback**: one Google Cloud OAuth app (client id/secret) configured
  under ANY Google service powers all four — Google apps aren't service-scoped, scopes
  are requested per authorization. Resolution: provider's own row, then any family
  sibling's. Deliberately does NOT leak to non-Google providers.
- Live testers for all four: cheapest authenticated read per service that actually
  proves the token's scope (Drive about, Gmail profile, Calendar list, Sheets file
  query). Testable count 29 → 33 of 66.

### Verified
- `test/google-connections.test.mjs` 6/6: catalog count + oauth typing, providers list,
  testable flags via real endpoint, 409-without-app, shared-app fallback producing
  correct per-service scopes + offline access + signed state, no-fallback-leak to
  Slack. App rows cleaned after.
- Live browser: Connections page renders 66 with Gmail/Calendar/Sheets carrying the
  OAuth affordances ("Set up OAuth app" / "Use token instead").

### To use it (one-time, needs Bam)
Create one OAuth client in Google Cloud Console (Web application; redirect URI =
`<admin origin>/tos-admin/api/connections/<provider>/oauth/callback` for each service
you connect), paste client id/secret under any one Google provider in Connections —
all four then offer real "Connect with Google" consent flows. PAT paste stays available.

## [2.0.0-beta.1] — Admin chrome consistency pass (2026-07-23)

Direction: replicate the dashboard's padding across every page (content was flush
against the sidebar everywhere else), replace the bento cards' xs/sm/md/lg chips with
corner-drag resizing, and normalize any control not matching the internal chrome.

### Changed
- **Page padding lives in ONE place now**: `#th-content` carries the dashboard's
  32/64/80 token rhythm; `.th-dash`'s own copy removed (would have doubled). Survey
  had confirmed only the dashboard wrapper was padded — clusters/milieus/products/
  pages/settings/studio/extensions all rendered flush. Verified live via computed
  styles on multiple routes: every page now 32px 64px 80px, dashboard not doubled.
- **Bento corner-resize** (`CardResizeHandle.tsx`): the size-chip row is gone; each
  card has a hover-revealed corner grip (bottom-right, nwse cursor). Dragging
  live-previews the card snapping to the nearest of the same four tiers; release
  persists through the same resize Route Handler — backend/tier model untouched,
  only the control surface changed. Reorder arrows kept. Verified live: drag
  preview snapped xs→lg, persisted across reload, then layout reset.
- **Bare form controls match the chrome**: element-level rule for input/select/
  textarea (checkbox/radio/range/color exempt) using the token set — scoped to
  `#th-content` and wrapped in `:where()` for ZERO specificity so every component
  class still wins. First version shipped unscoped and instantly repainted the
  sidebar search white — `:not([attr])` chains carry attribute-selector specificity
  and beat single-class rules; caught in live verify, rescoped, sidebar confirmed
  restored via computed styles.

### Fixed
- **Dashboard layout Route Handlers 500ed after every mutation** (pre-existing):
  `NextResponse.redirect` defaults to 307, which re-POSTs the dashboard page —
  mutations applied but the follow-up request 500ed on every chip click/reset since
  the feature shipped. All three handlers (resize/move/reset) now redirect 303.

## [2.0.0-beta.1] — Cluster: the merged-products Studio App, native engine (2026-07-22)

Direction: "lets get Cluster fully built out." Last of the planned native Studio plugins.
Semantics ported from the real 1.x plugin (`Therum OS/wordpress plugins/cluster/` —
group-engine.php's 741 lines read in full; its GroupEngineTest.php used as the spec).
Spec + declared divergences: `docs/superpowers/specs/2026-07-22-cluster-native-design.md`.

### Built
- `ClusterGroup` + `ClusterMembership` models (migration `..._cluster_groups`): symmetric
  groups, one-group-per-product schema-enforced, primary override stored once on the
  group (1.x mirrors it to every member — same semantics, single source of truth).
- `cluster.service.ts` — the 1.x group-engine rules: steal-from-other-group with donor
  dissolution under 2 members, member-list GC, override validate-or-clear, primary =
  override else earliest-created member; `resolveMerged` = one entry per (color,size)
  combo with in-stock-source-wins-tie (1.x merged-variations rule) resolved at READ time
  from live variants — nothing copied, so no sync drift and checkout routes to real
  source variants by construction; `detectDrift` = 1.x missing/extra shape over 2.0's
  two variant dimensions; candidates typeahead (ungrouped products only).
- `/api/clusters` routes — all Milieus-audit conventions from day one: authenticate +
  requireCapability('merged-products') everywhere, `storefront-manager` bundle on every
  mutation, reads open.
- Capability catalog: cluster native planned → stable. Studio Apps registry entry →
  nav 'Cluster' → `/clusters` (cluster + milieus studio apps enabled).
- Admin `/clusters` + 6 proxies: groups table (members/primary/drift badge), create-edit
  editor (debounced product typeahead excluding picked+grouped, chips, ≥2 validation),
  detail panel (keyed by group; members with vendor + Make-primary/Clear-override, drift
  findings in plain language, merged-variant preview with per-combo routing).

### Verified
- `test/clusters.test.mjs` 9/9 — the ported 1.x GroupEngineTest cases (symmetric write,
  dissolve-on-empty, shrink-GC, steal-dissolves-donor, primary default/override/clear/
  auto-clear-on-removal) + resolveMerged union & tie-break, both drift polarities,
  candidates exclusion, delete-leaves-products, capability + bundle gates.
- Full regression: **65/65 pass, 0 cancelled, exit 0** (one teardown fix along the way:
  settings.test double-quit of redis after closeQueues() took over that job —
  disconnectRedis also made idempotent-safe).
- Live browser: created a real 2-vendor group through the UI (typeahead picked both
  Starter Tees), auto-primary correct, REAL drift caught (seed tee is size-only, second
  supplier color+size — flagged "missing color"/"only member with color"), merged table
  showed all 5 combos each routed to the correct source product+vendor. Zero console
  errors. Demo data fully removed after (0 groups, 0 memberships).

### Declared divergences (spec §Declared)
Earliest-created member as primary fallback (no numeric IDs); non-member setPrimary
422s (1.x silent-ignores); no memo-cache/flush event (stateless queries); drift over
the two fixed dimensions; no anti-tamper cart validation needed (checkout posts real
variant ids); 1.x admin order-column "Group source" = follow-up (source already
derivable from any order line via variant → product → vendor).

## [2.0.0-beta.1] — Milieus full audit + remediation (2026-07-21)

Direction: "LETS RUN A FULL AUDIT ON MILIEUS." Two independent review agents (hostile
security/correctness lens; 1.x-fidelity + UI lens) plus a direct runtime pass. The audit
found real problems in same-day code — all confirmed findings fixed and regression-tested
same session. Full reports summarized here; spec addendum documents the now-declared
deliberate divergences.

### Fixed — security (the three merge-blockers)
- **Public endpoint could overwrite any customer's name** (unauthenticated upsert
  updated `name` for an existing email — also a stored-XSS delivery path into the admin
  member list). Now: an existing customer's record is never mutated from the public
  path; name is set only at first creation.
- **Public re-registration renewed existing memberships** (re-submitting a member's
  email reset expiry to now+duration — indefinite unauthenticated benefit extension;
  duration-0 groups became permanent). Now: re-registration of an existing member is a
  strict no-op — reports status, changes nothing, burns no signup slot.
- **No bundle gate on admin mutations** — any authenticated custom-role user could
  manage milieus and read member PII. Now: every mutation requires the
  `storefront-manager` bundle (same convention as products/orders/customers); reads
  stay open per the codebase-wide rule.

### Fixed — mediums
- `trustProxy: ['127.0.0.1','::1']` on Fastify: rate limiter now sees real client IPs
  through the local nginx instead of one shared 127.0.0.1 bucket (which made the 5/hour
  limit site-wide), without trusting spoofable XFF on direct connections.
- Max-signups TOCTOU race: cap now enforced by atomic conditional increment — concurrent
  signups can't overshoot; counter only moves for genuinely new memberships (repeat
  submissions no longer burn the quota, closing the link-lockout DoS).
- Rate-limit map now bounded (evicts stale IPs past 10k entries — was an unbounded
  per-IP memory leak); bad-slug POSTs 404 before consuming rate budget (1.x order).
- Worker resilience: `error` listeners on both BullMQ workers; sweep-scheduler upsert
  retries with backoff instead of crashing the whole worker when Redis is down at boot.

### Fixed — fidelity + UI
- Admin `assign()` of a pending customer now clears the pending flag (operator add IS
  the approval — 1.x parity; was leaving "assigned but benefit-blocked" rows via API).
- Sweep emits new `onMembershipRevoked` hook per removal (1.x fires its equivalent;
  without it the notification/webhook follow-ups had no seam). Bulk extend no longer
  counts permanent members it didn't change (1.x rule). Honeypot fake-success now
  matches the real response shape per link type (was a bot-detectable tell).
- PATCH regSlug conflicts now a clean 409 (was raw unique-violation path);
  `regEnabled` without a slug rejected at the schema (was storing unreachable links).
- MembersPanel keyed by milieu (switching groups no longer leaks page/filter state
  across groups); member-filter debounced with a stale-response guard (out-of-order
  responses can't show wrong results); typeahead timer cleaned up on unmount.
- **Edit finally exists**: the spec-promised editor is real now — every field including
  group expiry (also newly surfaced as a form field + table column) editable via the
  previously-dead PATCH proxy. Duration/max-signups inputs coerce to integers.
- Backend-down no longer masquerades as "No milieus yet" — explicit error banner.
- First-run cosmetic: empty-groups+creating no longer renders a header-only table.

### Declared, not changed (spec addendum has the full list + reasons)
Honeypot silent-success; re-registration no-op (vs 1.x's hard error — avoids an email
enumeration oracle); real-time benefit expiry (1.x waits for cron, up to ~24h grace);
reminders re-arm per renewal cycle; assignedAt list ordering. Follow-ups queued:
approvals inbox, group duplicate, CSV, event wiring, Counter bridge.

### Verified
- `test/milieus.test.mjs` 12/12 — original nine + three new audit-regression tests:
  hostile re-registration no-op (expiry/assignedAt/name/counter all unchanged, with a
  literal XSS payload as the attacker name), bundle gate (custom role: reads 200,
  mutations 403 `bundle_required`, sweep included), reg-slug consistency + clean 409.
- Backend + admin typecheck clean; worker boots with sweep scheduler confirmed in Redis.
- The "contaminated suite runs" mystery fully root-caused (next day, 2026-07-22): NOT
  port contention as first suspected — three stacked resource leaks meant every test
  process finished its tests then could never exit (node kept alive by open sockets):
  (1) M3's new `milieusQueue` — test files closed only `importQueue`; (2) the login
  rate limiter's lazy `lib/redis.ts` client — nothing had EVER closed it (settings.test
  had discovered this exact class of bug before and fixed it locally; the knowledge
  never propagated); (3) `notification.service.ts` leaked one SMTP socket per send in
  production — per-call nodemailer transport, no `close()`, no timeouts. Fixes: a
  single `closeQueues()` teardown (both queues + lazy redis) wired into all 8 server
  test files; SMTP transport now closed in `finally` with connect/greeting/socket
  timeouts. Diagnosed by walking `process._getActiveHandles()` to the leaked socket's
  literal remote address (::1:6380 = Redis).
- Also found: `settings.test.mjs` **deleted the operator's saved appearance setting on
  every run** (raw `deleteMany` in after()) — the real dark-theme appearance row was
  being silently destroyed by test runs, and its "defaults when unset" test only ever
  passed against an already-wiped row. Now snapshots the real row in before() and
  restores it exactly in after().
- **Final clean full regression: 56/56 pass, 0 cancelled, suite exits on its own,
  exit code 0** — the first genuinely complete cross-suite run since the Milieus work
  began, covering auth, auth-hardening, content, media, settings, studio, integration,
  webhook, and all 12 Milieus tests together.

## [2.0.0-beta.1] — Milieus M2+M3+M4: discounts, scheduled sweep, registration links (2026-07-21)

Direction: "great now on to m2, m3, m4." All three milestones from the spec, same day as M1.

### M2 — member discounts in real orders
- `Order` gains `discountPct`/`discountAmount`/`discountLabel` (migration
  `20260721205309_order_member_discount`). `order.service.create()` resolves
  `milieuService.discountFor(customerId)` before the inventory transaction — largest single
  active milieu pct, no stacking — deducts from subtotal, stores the receipt label
  ("Friends & Family discount (15%)"), and the Payment row is created at the discounted
  amount. Guests and disabled-capability installs price unchanged. Pending-approval and
  expired memberships grant nothing.

### M3 — scheduled sweep + reminders
- New `milieus-sweep` BullMQ queue; worker upserts an idempotent daily job scheduler
  (04:00) running both 1.x sweep timelines + `runReminders()` (memberships expiring
  within 3 days, fired at most once each via `reminderSentAt`, emitting the new
  `onMembershipExpiringSoon` hook point — extensions can subscribe; 2.0's own
  notification wiring is a follow-up). Manual `POST /api/milieus/sweep` unchanged.

### M4 — public registration links
- `Milieu` gains `regEnabled`/`regSlug`(unique)/`regRequiresApproval`/`regMaxSignups`/
  `regSignupCount` (migration `20260721210500_milieus_registration` — authored via
  `prisma migrate diff` + `migrate deploy` because `migrate dev` hits an interactive
  unique-constraint confirm that can't be answered non-TTY; SQL verified line-for-line
  before deploy). `MilieuMembership.pendingAt` = awaiting approval.
- `POST /api/public/register/:regSlug` — genuinely unauthenticated (its own Fastify
  plugin, no auth hook) but still capability-gated. Creates/finds the Customer by email
  and upserts the membership with source `link`. 1.x protections ported: honeypot
  `website` field (bots get a fake 201, nothing persists), per-IP rate limit 5/hour
  (in-memory — correct for a single-process API, flagged for multi-instance later),
  max-signups cap (422 once reached), disabled/unknown/expired-group links 404.
- Approval gate: `regRequiresApproval` creates the membership pending — **no discount,
  no reminders** until `POST /api/milieus/:id/members/:customerId/approve`, at which
  point duration starts from approval time (1.x rule). Re-registration never demotes an
  already-active member to pending.
- Admin UI: reg-link section in the create form (slug auto-derived, approval toggle,
  max signups), per-group signup-endpoint line with approval/count badges, pending
  members shown with an inline Approve button.

### Verified
- `test/milieus.test.mjs` now 9/9 (M1's six + M2 discount/guest paths + M3
  once-only reminders + M4 signup/approval/honeypot/max-signups/rate-limit) —
  all against real Postgres, test data cleaned after.
- Live browser pass: enabled Milieus in Studio → sidebar nav entry appeared via the
  dynamic studio-app injection → created "Friends & Family" (15%, reg link on) through
  the real form → `curl POST /api/public/register/friends-family` with NO auth returned
  `{"status":"active"}` → member appeared in the panel (source `link`) → all test data
  deleted after (0 milieus, 0 memberships).
- One test-infra find, honestly noted: backend tests that spawn a real server child on
  :4100 leak that child if the runner is killed; a leaked child from a killed run
  earlier polluted DB capability state (commerce off, seed gone) and caused a
  false M2 failure — repaired by clearing capability override rows + reseeding, after
  which 9/9. Full regression suite re-run scheduled at entry time.

## [2.0.0-beta.1] — Milieus M1: the memberships Studio App, native engine (2026-07-21)

Direction: build out the remaining "From the Studio" plugins; Milieus first (user's call —
"quicker build"). NOT greenfield: the real 1.x WP plugin exists at
`Therum OS/wordpress plugins/milieus/` (27 modules — found after an earlier wrong "doesn't
exist" claim; the search had only covered the WP install's plugins dir, not the plugin
source folder). Semantics ported from reading roles-engine.php, expiry.php, members.php,
wc-pricing.php in full. Spec: `docs/superpowers/specs/2026-07-21-milieus-native-design.md`.
Members = Customers (user-confirmed), all 1.x features milestoned M1→M4.

### Built (M1)
- `Milieu` + `MilieuMembership` models (migration `20260721121215_milieus_memberships`):
  color/discountPct/group-lifetime expiresAt/memberDurationDays; per-membership
  assignedAt/expiresAt/source enum (manual|link|csv|api)/reminderSentAt. Cascade on both
  FKs. 1.x's duration {value,unit} deliberately simplified to days-only.
- `milieu.service.ts` — 1.x semantics verbatim: assign idempotent (re-add resets
  timestamps + recomputes expiry from group default), extend = `max(current, now) + s`
  with permanent-membership no-op, bulk revoke/extend-30d/reset-expiry, two-timeline
  sweep (expired milieu → cascade delete; expired membership → revoke), discountFor =
  single largest pct across active milieus (no stacking — 1.x wc-pricing.php rule,
  user-confirmed "no mixing").
- `/api/milieus` routes — CRUD + members (list/search-candidates/add-by-id-or-email/
  revoke/extend/bulk) + manual sweep. Whole surface behind admin JWT +
  `requireCapability('memberships')`.
- Capability catalog: milieus native `planned → stable` — memberships now defaults ON
  per the existing defaultEnabled rule.
- Studio Apps registry: `milieus` entry; admin layout now injects ENABLED studio apps'
  nav entries into the Studio section dynamically (the registry's stated "enable it,
  it adds its own nav entry" design — previously aspirational, now real; Nexus gets
  its Connections nav entry through the same mechanism).
- Admin `/milieus` page + 7 Next proxy routes: groups table (color dot/members/discount/
  duration), create form with auto-slug, per-group members panel (debounced typeahead
  add of not-yet-member customers, 1.x expiry tiers permanent/ok/soon/urgent/expired,
  bulk actions, pagination).

### Verified
- `test/milieus.test.mjs` — 6/6: slug conflict 409 · assign idempotency + default
  duration + re-add reset · extend semantics (future adds, past restarts from now,
  permanent no-op) · discount max-wins + expired exclusion · both sweep timelines +
  cascade · capability gate 403. Test data fully cleaned in `after()`.
- Backend + admin typecheck clean.
- Full backend regression suite + live browser verification: IN PROGRESS at entry time —
  this entry updates when both land. (Environment note: background test runs kept dying
  to a flaky task tracker this session; final runs use direct PID watching.)

### Milestones remaining (spec §Milestones)
- **M2** — discountFor() wired into order.service create path, labeled discount on order.
- **M3** — sweep as BullMQ repeatable job on the existing worker + expiring-soon
  reminder hooks (reminderSentAt column already in place).
- **M4** — public registration links: tokenized signup → Customer + membership,
  approval gate, max signups, per-IP rate limit (1.x reg config shape in spec).
- Follow-ups explicitly not in any milestone yet: CSV import/export, Milieus events
  into 2.0's notification/webhook/audit infra, Counter-side auto-group-on-purchase
  bridge (1.x MilieusBridge.php pattern), customer-facing portal (blocked on public
  site existing at all).

## [2.0.0-beta.1] — Forge-audit pass: dependency currency + real gaps across all 3 apps

Direction: paused the Nexus/section-list work to run a full audit using the Forge framework
(`/Users/bam/Local Sites/Prompts/Forge/`) as operating discipline — confirm every dependency is
genuinely on latest (verified live against npm registry + official docs, never assumed from memory),
fix whatever the audit turns up. No dedicated security-scanner MCP (Semgrep/Snyk/Codacy/SonarQube) was
available in this environment — substituted direct tools (tsc, npm outdated, real builds, real browser
verification) and said so rather than pretending those ran.

### Upgraded (all verified live against npm registry / official docs, not memory)
- **Backend**: `@prisma/client`/`prisma` 7.8.0, `zod` 4.4.3, `fastify` 5.10.0, `@fastify/jwt` 10.2.0,
  `pino` 10.3.1, `@aws-sdk/client-s3` 3.1086.0, `bullmq` 5.80.2, plus new `@prisma/adapter-pg`, `pg`,
  `dotenv` (required by Prisma 7, see below). `@types/node` 26.1.1, `typescript` 7.0.2.
- **Admin**: `next` 16.2.10, `react`/`react-dom` 19.2.7, `@types/react` 19.2.17, `typescript` 7.0.2.
- **Builder**: `vite` 8.1.4, `react`/`react-dom` 19.2.7, `@vitejs/plugin-react` 6.0.3, `typescript`
  7.0.2. `zustand` already at latest (5.0.2), untouched.

### Fixed — breaking changes from the above, real blast radius traced and closed
- **Prisma 7**: `datasource.url` no longer lives in `schema.prisma` — moved to new `prisma.config.ts`
  (`defineConfig`/`env()`). Every `PrismaClient` now requires a driver adapter (`@prisma/adapter-pg`
  wrapping `pg`); bare `new PrismaClient()` throws `PrismaClientInitializationError`. Rewrote
  `src/lib/db.ts` accordingly, plus every ad-hoc verification/cleanup script this session that
  constructed its own `PrismaClient` directly. CLI no longer auto-loads `.env` — added explicit
  `dotenv` import in `prisma.config.ts`. This one change cascaded: 30+ downstream `TS2339`/implicit-any
  errors across `order.service.ts`, `connection.service.ts`, `foundation.service.ts`, and others
  disappeared on their own once the client was correctly typed again — none were separate bugs.
- **Zod 4**: `z.record(valueType)` single-arg form removed, now requires `z.record(keyType,
  valueType)`. Fixed 8 call sites across 6 schema files (product, media, content, customer, extension
  ×2, import).
- **Next.js 16**: Async Request APIs (`cookies()`, `headers()`, `params`, `searchParams`) are now
  Promise-only with no sync fallback (v15's temporary compat is gone). Traced the full real blast
  radius: `admin/lib/api.ts` (`authToken()`, `forwardedOriginHeaders()` now async; `builderEditUrl()`
  redesigned to take a pre-resolved token instead of calling `authToken()` per-item in a list, avoiding
  N redundant `cookies()` reads), `app/(app)/layout.tsx`, `change-password` and `media/upload` routes,
  `preview/[id]`, `ContentTypeListPage`, `content/page.tsx`, `account/page.tsx`, and **18 Route Handler
  files** switched from sync `{ params: { id: string } }` to `{ params: Promise<{ id: string }> }`.
  Worth flagging explicitly: TypeScript only caught 9 of these on its own — the other 18 had loose,
  non-Promise type annotations that typechecked "clean" while being silently wrong at runtime
  (`params.id` on an actual Promise resolves to `undefined`). Re-typing every route to its real shape is
  what surfaced the full scope; "typecheck passes" alone would not have caught this.
  `middleware.ts` → renamed to `proxy.ts` (function `middleware` → `proxy`, same logic, per Next 16's
  deprecation of the old convention). Turbopack's multiple-lockfile root-detection warning (this repo
  is 3 independent npm projects, not a workspace) fixed via explicit `turbopack.root` in
  `next.config.mjs`.
- **React 19**: bare `useRef<T>()` with no argument no longer allowed (`MediaLibrary.tsx` →
  `useRef<...| undefined>(undefined)`); ambient global `JSX` namespace no longer auto-available (→
  explicit `import type { ReactElement }`). Grepped the whole admin codebase after fixing — confirmed
  each was the only occurrence of its pattern.
- **Vite 8 / TypeScript 7 (builder)**: `tsconfig.json` never had `"types": ["vite/client"]` — a
  genuine pre-existing gap TS 5 silently tolerated on side-effect CSS imports and TS 7 correctly
  started rejecting (`TS2882`). Fixed, not a regression from this pass.
- **`.claude/launch.json` had no `builder` entry, AND the file being edited to add one was the wrong
  file** — a stray duplicate exists at `therum-cms-2/.claude/launch.json`; the real one `preview_start`
  reads is at the actual project root, `/Users/bam/Local Sites/therum-os/.claude/launch.json`. Added
  the entry to the correct file. Separately found port 5174 already held by an 8-day-old builder `vite`
  process that predated every dependency bump in this pass — killed and restarted clean so the browser
  verification below actually reflects Vite 8/React 19, not stale Vite-5-era state still resident in an
  old process.

### Verified
- **Backend**: typecheck 46 errors → 0. Real rebuild, real boot, live smoke tests (63-provider
  connections list, Zod validation rejecting a bad body with structured error, real content list read).
- **Admin**: typecheck clean. `next dev --webpack` boots with zero errors. Full live-browser pass:
  login gate, Studio/Connections pages against real Prisma data under React 19/Next 16, full
  connect→test→disconnect flow, `router.refresh()` re-fetch, zero console errors before and after.
- **Builder**: typecheck clean, real production build (`tsc -b && vite build`) succeeds. Live-browser
  pass: `vite@8.1.4` boots in 268ms, zero console errors, all asset/module requests 200 including the
  live `/api/foundations` proxy call to the backend, and a real interaction (clicking "Add Heading")
  correctly updated canvas state — confirms React 19 + Zustand state updates work, not just that the
  page renders.

### Known gap — NOT fixed, flagged honestly
- **`next build` (admin) intermittently fails**: `The "id" argument must be of type string. Received
  undefined.` Reproduced under both Turbopack (the 16.x default) and `--webpack`. Isolated via a
  controlled test — reverted `proxy.ts` back to `middleware.ts` and rebuilt: failed identically, ruling
  out the rename as cause. Retried the exact same build again with zero code changes: failed again,
  non-deterministically. `next dev` is completely unaffected (verified clean above) — this is a
  production-build-only issue on a toolchain where Next 16.2.10 and TypeScript 7.0.2 were both
  published within days of each other per the live registry, so a bleeding-edge interaction bug is
  plausible. **Do not trust `next build`/deploy for admin until this is root-caused** — dev-mode is
  fully verified working in the meantime.

## [2.0.0-beta.1] — Nexus follow-up: closing real gaps from workstream 11

Direction: "fix whatever you skipped." Triaged the previous entry's 4 "Skipped, not silently
dropped" items into what's actually a bounded, closeable task versus what's inherently 63x separate
integration work, and closed everything in the first category for real.

### Fixed
- **Real OAuth authorization-code flow**, Slack/Google Drive/GitHub — no longer a personal-access-
  token-only stand-in. New `OAuthAppCredential` model (this install's own registered client_id/secret
  per provider, encrypted same as everything else). Real, documented authorize/token endpoints for
  all 3. CSRF `state` is a signed, stateless token (HMAC over provider+nonce+expiry, same shape as
  2FA's challengeToken) — no server-side session store needed. Cross-origin correctly handled: the
  OAuth provider redirects the browser to the **admin app's own** Route Handler (which has the real
  session cookie), which then calls the backend server-side with a real bearer token — the backend's
  OAuth routes are never hit directly by the browser. PAT-paste stays available as a real alternative
  for all 3, not removed. Verified live: start-url correctly 409s before an app is configured, and
  after configuring a (test) app, produces a well-formed, real `slack.com/oauth/v2/authorize` URL
  with correct params and a real signed state — the one boundary that can't be verified further here
  is an actual user consenting in a real Slack/Google/GitHub account, same "can't complete the last
  mile without a real external account" limitation as this session's `pg_dump`/SMTP gaps.
- **Multi-field credentials** — Twilio, Trello, and PayPal all need 2 values (SID+token, key+token,
  client ID+secret), which the original single-text-field design couldn't express. Added a plain
  `"FIRST:SECOND"` convention (`credentialHint` on the catalog entry drives the input's placeholder)
  rather than building dynamic per-provider multi-field forms. PayPal's tester is a real
  client-credentials token exchange against the live endpoint, not a resource read.
- **Live testers expanded from 10 to 29** (of 63) — added Gemini, Mistral, Grok, Replicate,
  HuggingFace, Stability, Mapbox, Telegram, Discord, Square, Coinbase Commerce, Wise, Linear, Asana,
  HubSpot, Intercom, plus the 3 multi-field ones above. Every one makes a real call to that provider's
  real, documented API — verified live with deliberately fake credentials against Gemini, Discord,
  Linear, and Twilio, each returning a genuine rejection (`400`/`401`) from the real provider, not a
  canned result. The remaining 34 are honestly still storage-only (`testable: false`), not faked.
- **Real webhook signature verification** for GitHub, Stripe, and Slack — `src/lib/
  webhookSignatures.ts` implements each provider's actual documented HMAC scheme (GitHub's
  `X-Hub-Signature-256`, Stripe's timestamped `Stripe-Signature`, Slack's timestamped `X-Slack-
  Signature`), constant-time compared. New `WebhookSecret` model (admin-configured signing secret per
  provider, encrypted). Once a secret is set, a webhook that fails verification is rejected outright
  (`401`), not logged-and-accepted — a real security boundary, not cosmetic. No secret configured, or
  no scheme wired for that provider, logs as `verified: null` (honestly unverifiable) rather than
  blocking everything. Verified live: a correctly-HMAC-signed GitHub payload was accepted and logged
  `verified: true`; an incorrectly-signed one was rejected with a real `401`; a provider with no
  scheme wired (OpenAI) still logs normally with `verified: null`.

### Still not fixed — genuinely not a "skip to close," not silently ignored
- **Per-provider webhook business logic for the other 60 providers** (github/stripe/slack now verify
  signatures for real, but "verify" and "then do something useful with the event" are different
  problems) — inherently 63 separate integrations, not one deferred task. The generic, real receiver
  + verification mechanism is what makes each of those additions incremental instead of a rewrite.
- **34 providers with no live tester yet** — same shape as above: each is its own small, real,
  addable piece of work once its real API shape is looked up and confirmed, not a batch that closes
  in one pass.
- **Real end-to-end OAuth grants** for Slack/Google Drive/GitHub — the mechanism is real and verified
  as far as it can be without a real external account clicking "Allow." Not fixable from here; needs
  a real admin with real provider accounts to complete once.
- **The 5 MCP tools skipped in workstream 10** (`rebuild_site`, list/apply brand presets, derive/
  review/apply design tokens) are a different kind of gap from everything above — they're not "real
  work not yet done," they're blocked on entire subsystems this codebase doesn't have at all yet (a
  public build/render pipeline, a theme-store, a token-mining pipeline). Nothing in this pass touches
  them; building any of those is its own separate, large undertaking, not a fix.

### Verified
- All 3 apps typecheck clean.
- Every mechanism above tested live against real backend endpoints and, where applicable, real
  third-party APIs (not mocked). All test data — connections, audit entries, webhook log rows, the
  test webhook secret, the test OAuth app config — deleted afterward; confirmed back to a genuinely
  empty state (0 connections, empty audit/webhook logs, no OAuth apps or webhook secrets configured).

## [2.0.0-beta.1] — 1.9.44 admin-parity build, workstream 11: section 07 — Nexus (Connections hub), React/2.0 flavor

Direction: name the Connections hub "Nexus"; build two flavors — a React/native one (this entry) living
under "From the Studio" and enabling the Connections hub, and a separate WordPress-plugin flavor of the
same thing (queued next, not started here). This is the last "port now" section from the inventory.

### Built
- **Studio Apps — a new, third registry concept**, distinct from the existing Foundation (builder/CMS-
  compat layer, edition-gated) and Capability (feature resolving to a swappable provider) registries
  already on the Studio page. A Studio App is a self-contained feature module: enable it, it adds its
  own nav entry + settings area. Not edition-gated — these are native Therum features, not WP/Bricks
  compat, so Pure vs Unlocked doesn't apply. This is what task "Build Studio page ('From the Studio'
  apps registry)" actually meant; the existing Foundations/Capabilities grids were a different, narrower
  concept that only looked like a superset of it. `studioApp.service.ts` mirrors `foundation.service.ts`'s
  own catalog-array + `Extension`-row-per-id pattern for consistency, minus the edition lock.
- **Nexus**, the first (and so far only) Studio App: enabling it reveals "Open Connections →" on the
  Studio page, linking to the real Connections settings page below.
- **The Connections hub itself** — 5 categories, 63 providers, matching the inventory's counts exactly
  (AI tools 13, Messaging & APIs 12, Ecommerce 8, Payments 12, External apps 18). The inventory named a
  subset of each category as examples; the rest are real, well-known services in the same category, not
  placeholders — `src/lib/nexusCatalog.ts`. 3 providers (Slack, Google Drive, GitHub) marked OAuth per
  the inventory's "only 3 providers use it today," though real OAuth authorization-flow isn't built this
  pass (see Skipped below) — they connect via a pasted personal-access-token instead, honestly labeled
  as such in the UI, which is a genuinely working alternative for all three, not a placeholder.
- **Real encryption at rest** (`src/lib/crypto.ts`, AES-256-GCM) — a credential is never stored or
  returned in the clear; only a masked preview (last 4 characters) ever reaches the browser. Key is
  derived from the existing `JWT_SECRET` via SHA-256 with a domain-separation string, not a new required
  env var — every environment already has `JWT_SECRET` set.
- **A generic, pluggable test-credential mechanism**, with real testers wired for 10 providers (OpenAI,
  Anthropic, Stripe, SendGrid, Slack, GitHub, Cohere, Resend, Notion, Postmark) — each makes an actual,
  low-risk, read-only call to that provider's real API using the stored credential. Every other catalog
  entry is credential storage only; the inventory itself frames this as "a dozen providers," and 10 is
  an honest count, not silently rounded up. Verified live: connected a real OpenAI row with a
  deliberately fake key, ran Test, got back a genuine `401` from OpenAI's own API — proof the mechanism
  is real, not a canned success.
- **Vault view** (every connected credential, masked, one place) and **audit log** (connect/disconnect/
  test, real timestamps, most recent first) — both real, both populated by actual actions, not stubbed.
- **Generic inbound webhook receiver** (`POST /api/webhooks/connections/:provider`) — logs real receipt
  to a `WebhookLog` table so the URL the Connections page advertises actually does something today.
  Deliberately separate from the existing `/api/webhooks/:provider` route, which is Therum's own
  internal payment-HMAC contract (fixed schema, `x-therum-signature`), not a generic third-party
  receiver — reusing it would have been wrong, not simpler.
- **Outbound key**: rather than re-implement token display, the Connections page's Activity tab links
  to the existing Account page where this site's own scoped API tokens already live (built in
  workstream 8) — one real system, not a duplicate.

### Skipped, not silently dropped
- **Real OAuth authorization-code flow** for the 3 OAuth-typed providers — a genuinely separate,
  substantial subsystem (redirect handling, state/PKCE, token exchange, refresh) beyond this pass's
  scope. Personal-access-token connection is real and working for all 3 in the meantime, honestly
  labeled in the UI as a stand-in, not silently presented as the real thing.
- **Per-provider webhook signature verification and business logic** for all 63 providers — genuinely
  63x real integration work, provider by provider. The generic receiver + log prove the URL is real;
  what each provider's webhook actually *does* lands provider by provider, same honesty pattern as the
  test-credential mechanism above.
- **Live "test credential" for the other ~51 providers** — same reasoning; the mechanism is real and
  generic, each additional tester is its own small, real piece of work to add.
- **The Connections page was deliberately not added to `SETTINGS_SECTIONS`** (`admin/lib/
  settingsSections.ts`) — that file's own comment states it matches 1.9.44's real 16-section Settings
  registry exactly, a literal-port invariant from an earlier workstream. Adding a 17th entry there would
  have silently broken that claim. The Studio page's "Open Connections →" link is Nexus's real, sole
  entry point instead — consistent with Nexus being a Studio App, not a core Settings section.

### Verified
- All 3 apps (backend, admin, builder) typecheck clean.
- Live, real session (a directly-minted JWT for the real admin account, not a guessed password): Nexus
  toggled on from Studio, "Open Connections →" appeared and navigated correctly; all 63 providers
  rendered across 5 correctly-labeled categories; connected a real provider (OpenAI) with a test
  credential, masked preview displayed correctly, Vault count updated; ran a real Test call, got a
  genuine `401` back, pill flipped to the failed state; Audit log showed real connect/test entries with
  real timestamps; generic webhook receiver hit directly, logged for real, then correctly showed empty
  again after cleanup. Every piece of test data (the OpenAI connection, its audit entries, its webhook-
  log entry) was deleted afterward — Nexus itself stays enabled, since that's the real feature being
  shipped, not test state to revert.

## [2.0.0-beta.1] — 1.9.44 admin-parity build, workstream 10: section 08 — MCP server & job queue

Direction: "lets move to 10 + 9 + 8" (9+10 were already done; this is the 8 part). Inventory specs 8
tools for the MCP server; 5 of them (`rebuild_site`, list/apply brand presets, derive/review/apply
design tokens) name 2.0 subsystems that don't exist yet — no public build pipeline, no theme-store
(section 05 explicitly deferred that), no token-mining pipeline. Flagged the mismatch and asked
rather than silently deciding: build only the 2 tools that map to real 2.0 capability now, add the
rest as their underlying feature lands, since an MCP server is actively discovered and called by an
external agent — a broken tool wastes its turn, unlike an inert settings toggle nobody's forced to
touch. Confirmed choice, built accordingly.

### Built
- **`POST /api/mcp`** — a real JSON-RPC 2.0 endpoint (`initialize`, `tools/list`, `tools/call`),
  matching the inventory's "one HTTP route" framing and written for an agentic caller, not a human
  UI. Two tools registered: `get_preview_url` (real content lookup → the actual admin preview URL)
  and `check_queue_status` (real BullMQ job counts, structured as a `queues[]` array so adding a
  second queue later is additive, not a rewrite — the inventory's own "worth having this from day
  one" point about the job queue, applied to its status surface specifically). Calling any of the
  5 unbuilt tools (e.g. `rebuild_site`) returns a clear JSON-RPC "unknown tool" error rather than
  silently accepting it or faking a result.
- **Auth**: a dedicated preHandler, not the existing `app.authenticate` decorator — that decorator
  403s a `read`-scoped API token on any non-GET request, but JSON-RPC always transports over POST
  regardless of whether the called tool is read-only (both registered tools are). Reusing it as-is
  would have locked out a legitimately-scoped read-only token from a read-only tool, purely because
  of wire format. Accepts either a valid JWT session or any valid API token (read or write scope);
  left a comment that this must be revisited the moment a write-capable tool is ever added.

### Skipped, not silently dropped
- **`rebuild_site`, `list_brand_presets`, `apply_brand_preset`, `derive_design_tokens`,
  `review_design_tokens`, `apply_design_tokens`** — each needs a 2.0 subsystem that doesn't exist:
  a public build/render pipeline, a theme-store, and a token-mining pipeline respectively. Not
  registered in `tools/list` at all (rather than registered-but-always-erroring), so an agent
  caller only ever sees tools that actually work.
- **Pub/sub event bus** — inventory itself flags this as confirmed dead in 1.9.44 (zero real
  subscribers anywhere in that codebase). Not ported; nothing to build.

### Verified
- Backend typechecks clean.
- Live, against the real backend: no-auth request rejected (401); `initialize` and `tools/list`
  return the expected shape; `get_preview_url` against a real content id returns the correct
  `/tos-admin/preview/:id` URL; against a nonexistent id returns an honest `isError` tool result
  instead of a crash; `check_queue_status` returns real BullMQ counts; calling the excluded
  `rebuild_site` is correctly rejected as an unknown tool; a real `read`-scoped API token (issued
  and then revoked as part of this check, not left lying around) successfully calls a tool through
  this route, confirming the dedicated auth gate's whole reason for existing. Docker had gone down
  mid-session for an unrelated reason (not this work) — restarted, `docker compose up -d` brought
  Postgres/Redis back, re-verified clean after.

## [2.0.0-beta.1] — 1.9.44 admin-parity build, workstream 9: sections 09+10 — Settings & ops, onboarding

Direction: "lets do 09 + 10 first then we can do 07 + 08," plus an explicit, verbatim requirement for
the setup wizard: no admin account yet → setup form only; an account exists → login form only — no
tab-switcher either way. Audited the inventory's own "section 09 mostly already done" framing before
trusting it (a background audit reversed that framing for 5 of 6 sub-items) and found several real
gaps — one of them a live enforcement gap, not just missing UI — along the way.

### Fixed — real gaps found during the build, not hypothetical
- **Redirect rules were never actually enforced.** `RedirectRule.hits` existed in the schema and the
  CRUD UI worked, but nothing anywhere applied a saved rule to a real request — confirmed via
  `grep -rn "\.hits\b" src/` (zero results) and no middleware referencing `RedirectRule` outside its
  own CRUD routes. Fixed by adding `redirectsService.findMatch()` (exact match first, then regex
  fallback in creation order, an invalid saved regex skipped rather than 500ing every request) and
  wiring it into `server.ts`'s `setNotFoundHandler` ahead of 404 recording — a saved rule now
  actually redirects, and `hits` genuinely increments.
- **`redirects.ts` and `tools.ts` had zero `requireBundle` gating** on their mutating routes — only
  `app.authenticate` — unlike every other settings-adjacent route from workstream 8's rollout. Both
  gated behind `requireBundle('manage-settings')` (find-replace's `execute` only, not `preview`,
  same read/write split every other domain already uses).
- **A real hydration bug in the pre-existing Find & Replace UI**: its match-count block was a `<p>`
  wrapping a conditional `<ul>` — invalid HTML (block content inside a paragraph), caught via a live
  React hydration warning while browser-verifying the feature. Fixed by changing the wrapper to a
  `<div>` (identical classes/styles, so no visual change) — confirmed via direct DOM inspection that
  the `<ul>`'s parent is now the `<div>`, not the old `<p>`.

### Built
- **404 monitor**: new `NotFoundHit` model (path-unique, upserted on every miss so a scanner hammering
  one dead URL increments a counter instead of growing the table without bound), wired into the same
  not-found handler as the redirect-enforcement fix above — one hook point closing two gaps at once.
  Settings > Redirects now lists unmatched paths by frequency with one-click "create redirect" /
  dismiss / clear-all actions.
- **Backup**: real `.zip` bundling (SQL dump + `uploads/` + a `manifest.json`, via `archiver` v8's
  ESM class API — `ZipArchive`, not the old factory-function call `@types/archiver` still documents)
  and real S3 upload via `@aws-sdk/client-s3` using the already-persisted-but-previously-unused
  bucket/region/key fields. Local "run now" verified live: correctly and honestly reports that
  `pg_dump` isn't installed in this dev environment rather than faking success — the real
  dump→zip→S3 success path is blocked by that same missing system dependency here, not a code gap.
- **Notifications**: a real dispatcher (`notification.service.ts`) with email (nodemailer) + Slack,
  fired on admin login and on backup completion — both fire-and-forget, so a broken SMTP/Slack
  config can never slow down or fail the real operation being reported on. The separate manual
  "send test" path deliberately does the opposite: honest per-channel failure, which is the whole
  point of a manual test. Verified live: with neither channel configured, test-send correctly
  reports "nothing to test" rather than a false success or an unhandled error.
- **New `/login` gate — a strict binary, not a default.** Per explicit instruction: zero admin
  accounts → setup form only, no way to reach a sign-in form that would just fail; one or more
  accounts → sign-in form only, no way to reach setup (the backend already refused `setup()` once an
  account exists — this just stops the dead end being offered in the UI at all). Replaces
  `LoginScreen.tsx`'s previous always-both-tabs design (a `mode` client state + switcher buttons, from
  an earlier workstream) with a direct render off the server-supplied `needsSetup` boolean — no
  client state to switch at all. Verified live in both states: against the real single-admin
  database (login-only, screenshotted) and against a freshly-migrated, genuinely empty temporary
  database created specifically for this check (setup-only, confirmed via the real `needsSetup()`
  service logic returning `true`) — the temp database was dropped and `.env` never left pointing at
  it once the check was done.
- **Post-setup onboarding wizard** (edition → connections → branding → finish) — new, in-app,
  authenticated, skippable and resumable flow, separate from the pre-auth login gate above. Progress
  persists via a new `onboarding` Settings domain (`step` + `completed`). Edition step reuses the
  real `editionService`; branding step reuses the real SEO-defaults / Appearance-accent / Login-
  branding domains (a lean, quick-setup subset — site name, accent color, login heading/subhead —
  not the full Quick Controls panel); connections step is an honest placeholder pointing at the
  not-yet-built Connections hub (section 07). A dashboard banner links back in whenever `completed`
  is false. Caught and fixed one real bug of its own during verification: the accent-color field is a
  native color input, which can never be truly empty, so its "leave blank to keep the current value"
  promise was silently false for that one field — submitting without touching the swatch would have
  overwritten the "use built-in default" sentinel with an arbitrary hardcoded hex. Fixed by defaulting
  the swatch to the actual effective color (`therum-tokens.css`'s `--ac`, `#e83b3b`) instead of a
  made-up one, so an untouched submission is now a genuine no-op. Verified live end-to-end: full
  click-through of all 4 steps against the real backend (edition switch, honest connections
  placeholder, branding save, dashboard banner appearing/disappearing correctly), then every
  test-induced change (edition, site name, onboarding progress) reverted back to its original value.

### Flagged N/A, not silently dropped
- **All 11 Performance toggles, plus cache-busting** — every field saves for real but none is
  load-bearing yet, for one of three distinct reasons, each confirmed by direct inspection rather
  than assumed: (1) Object cache and Heartbeat frequency have no backend mechanism to gate at all —
  no in-memory cache layer, no polling loop (`grep` for both came back empty outside their own
  settings definitions); (2) lazy-load / defer-JS / disable-emoji / disable-oEmbed / minify-CSS /
  minify-HTML all describe public-page rendering, and 2.0 has no public-facing theme/renderer yet —
  the same gap already flagged in the SEO and design-system workstreams; (3) post-revisions /
  trash-days / autosave-interval have no matching Content concept at all (confirmed via the schema
  plus a broad `autosave` grep across `admin/`/`builder/`/`src/`). Kept saveable rather than removed,
  with the real reason stated per group directly on the Performance settings page, not hidden.

### Verified
- Backend, admin, and builder apps all typecheck clean after every change in this workstream.
- Live browser verification this workstream: 404 monitor (create/list/dismiss/clear), Find & Replace
  (preview against real content), the strict login gate (both states), the full onboarding flow (all
  4 steps + dashboard banner), and backup/notifications' honest-failure paths. Backup's success path
  and real email/Slack delivery are blocked by missing system dependencies in this specific dev
  environment (no `pg_dump`, no SMTP/Slack credentials configured) — stated here as untested, not
  claimed as done.

## [2.0.0-beta.1] — 1.9.44 admin-parity build, workstream 8: section 06 — Auth & access

Direction: "lets continue to 06." Audited the real state of all 4 sub-features against the
recovered inventory before touching anything, since half of section 06 turned out to already be
built. Login screen skin was a genuine gap (settings existed, nothing read them). 2FA was fully
built server-side but — a real, currently-live bug found during that audit, not a hypothetical —
silently broken on login: enabling it left an account permanently unable to sign back in. Custom
roles via capability bundles didn't exist at all. Scoped API tokens already matched, as the
inventory itself predicted. Given the roles work touches core auth/session code, scope was
confirmed with an explicit go-ahead before building (this project's CLAUDE.md treats auth code as
a no-exception confirmation boundary) — chose to build both the login-skin fix and the full roles
system.

### Fixed — a real, live authentication bug, not a hypothetical
- **2FA login silently produced a broken session.** `authService.login()`'s real return type is a
  union — a session token, or (2FA-enabled accounts) `{needsTwoFactor: true, challengeToken}` with
  no token at all. `admin/app/api/auth/login/route.ts` destructured `token` unconditionally, so a
  2FA account's `token` was `undefined` — the route still set a cookie (containing the literal
  string `"undefined"`) and reported `{ok: true}`. The browser believed login succeeded; the very
  next authenticated request would have silently failed. Concretely: **any admin who turned on
  2FA would have been unable to log back in**, with no error ever surfacing to explain why. There
  was also no 2FA code-entry UI anywhere in `LoginScreen.tsx` and no caller anywhere in `admin/`
  for the (already fully-implemented, already-tested) `POST /auth/verify-2fa` backend route — the
  gap was entirely client-side; the backend challenge flow was correct throughout.
  - `login/route.ts` now branches on the response shape: a challenge returns
    `{ok: true, needsTwoFactor: true, challengeToken}` to the client instead of setting a cookie.
  - New `admin/app/api/auth/verify-2fa/route.ts` proxies the existing backend route, setting the
    real session cookie only once a code actually verifies. Unlike the login step's deliberate
    username/password ambiguity, these failure modes (wrong code / expired challenge / rate
    limited) are safe to show as-is, so the real backend message is surfaced, not genericized.
  - `LoginScreen.tsx` gained a `challengeToken` state and a third form stage (6-digit code entry,
    "Use a different account" to back out) — the password form and the code form are mutually
    exclusive, matching the two real steps the backend already enforces.
  - **Verified end-to-end via a real API round trip** (login → enroll → confirm with a real
    computed TOTP code → login again, now challenged → verify with a fresh code → authenticated
    request with the resulting token → replay the same code, confirmed rejected → disable → login
    back to a plain token). All 9 steps passed on the real backend, not mocked.

### Built
- **Login screen wired to its own already-built settings.** `Settings > Login` (background
  type/color/image/video/overlay, heading, subhead, version-stamp toggle) was fully built,
  persisted, and even had a dedicated public unauthenticated read endpoint — `LoginScreen.tsx`
  simply never called it. `admin/app/login/page.tsx` now fetches it server-side (matching the
  existing `colorMode()` pattern — no session exists yet on this page) and passes it down.
  `bgType: 'theme'` (the default) reproduces the exact pre-existing `var(--th-bg)` look with zero
  visual change for any untouched install; solid/image/video are the genuinely new looks. Custom
  `heading`/`subhead` apply only in the sign-in context — 'create account' mode keeps its own
  distinct hardcoded copy, since the settings schema has no second heading/subhead pair for that
  context and inventing one wasn't asked for. Extracted `admin/lib/loginBranding.ts` (shared
  `LoginBranding` type + defaults) since this was about to become a 3rd local copy of the same shape.
  - **Verified live**: default (never-configured) state screenshotted, confirmed pixel-identical
    background to before this was wired up, plus the new version stamp and heading/subhead now
    present where nothing rendered before. A full custom configuration (solid dark-green
    background, custom heading/subhead) set directly against the backend and screenshotted,
    confirming all fields apply together correctly.
- **Custom roles via composable capability bundles** — the 1.9.44 concept this section names:
  named roles built from 7 bundles (`read`/`write`/`publish`/`edit-broadly`/`manage-settings`/
  `storefront-customer`/`storefront-manager`) rather than a fixed admin/editor/author ladder.
  - New `Role` model (`prisma/schema.prisma`, migration `20260708013953_add_roles_capability_bundles`)
    — `AdminUser.roleId` is nullable and `onDelete: Restrict`: `null` means full admin (the exact,
    unrestricted behavior every account had before this column existed, so no existing account's
    access silently changes), and a role in active use can't be deleted out from under its users —
    they must be reassigned first, so nobody is ever silently promoted to full admin by a role's
    deletion.
  - `signJwt()` is now data-driven (`'admin' | 'custom'`, was a hardcoded literal `'admin'` at
    every call site) — `login()`/`verifyTwoFactor()` both check `user.roleId` to decide. Bundles
    themselves are deliberately never baked into the JWT — `app.authenticate` resolves them live
    per request (`roleService.resolveAccess()`, mirroring the existing `requireCapability()`
    live-lookup pattern already used elsewhere in this codebase) — so editing a role's bundles
    takes effect on the very next request, not just the user's next login. The same live
    resolution now applies to API-token-derived sessions too: a token issued by a custom-role user
    inherits that user's real access instead of the previous hardcoded `role: 'admin'`, which would
    otherwise have let a custom-role user's own API token silently bypass their own restrictions.
  - `editor`/`viewer` — two literals that sat in the JWT payload type doing nothing (confirmed by
    the section-06 audit: never minted anywhere, immediately rejected by the one guard beside
    them) — removed now that `'custom'` is the real second tier; keeping them alongside a real
    non-admin role would have been actively confusing, not backward-compatible.
  - New `requireBundle(bundle)` middleware (full admin always passes; a custom-role session needs
    the named bundle) wired into the same class of mutating routes `requireCapability()` already
    protects: content create/update/publish/unpublish/duplicate/delete (`write`/`publish`), every
    settings PATCH domain plus backup-run/test-notification/import (`manage-settings`), and
    product/order mutations (`storefront-manager`). GET/read routes are deliberately never
    bundle-gated — restricting read access per-route would make the admin panel unusable for any
    custom-role account, and `read`'s place as the first/most-basic of the 7 bundles reads as a
    baseline-access marker, not a fine-grained per-route switch.
  - New `requireFullAdmin` middleware — creating/editing/deleting roles and assigning them to
    users is deliberately **not** delegable via any bundle, including `manage-settings`: a
    custom-role user editing their own role's bundles, or creating a new, more powerful one and
    assigning it to themselves, would be a direct privilege-escalation path. Full admin only, with
    no bundle able to unlock it.
  - Real Permissions UI (`admin/app/(app)/settings/permissions/`) replacing the prior honest stub —
    create/edit/delete named roles from the 7 bundles, shown as chips, with the in-use count per
    role. The Users page (`admin/app/(app)/users/page.tsx`) gained a Role column with a live
    reassignment select, wired through a new `PATCH /users/:id/role` route.
- **Confirmed, not rebuilt**: 2FA's backend (TOTP, backup codes, the two-step challenge, audit
  logging) was already complete before this pass — only its client-side consumption was broken
  (see Fixed, above). API tokens already match the inventory's own description closely enough to
  treat as parity, exactly as the inventory itself flagged — real issue/list/revoke, hashed
  storage, bearer auth — with one honest gap: scoping is coarse `read`/`write` (an HTTP-method
  gate), not the inventory's 4-tier read-only/write/dangerous-actions/full-admin model. That's a
  documented, deliberate simplification from when the token system was originally built ("no
  MCP-style tool-calling surface here yet to scope against"), not something this pass changed.

### Fixed — a second real bug, found during verification, not before
- **`requireFullAdmin` hung every request it protected instead of ever completing.** Written as a
  plain synchronous 2-argument function (`(req, reply) => {...}`). Fastify's hook system expects a
  preHandler to either be `async` (or otherwise return a Promise) or take a 3rd `done` callback
  parameter — a plain sync 2-arg function matches neither convention, so Fastify waited
  indefinitely for a `done` that was never going to be called. Concretely: creating a role via the
  real browser UI hung forever (confirmed via the browser's own pending-request state and the
  backend's request log showing an "incoming request" with no matching "completed" line, ever).
  `requireBundle` was already correctly `async` and unaffected. Fixed by making `requireFullAdmin`
  `async` too, even though nothing inside it awaits anything — matching Fastify's actual contract,
  not just "happens to work." Re-verified the full create → edit → delete role cycle end-to-end
  afterward, including through the real browser UI this time, not just direct API calls.

### Verified live
- **2FA**: full 9-step API round trip (see Fixed, above) — enrollment, a real computed TOTP code,
  the login challenge, verification, authenticated use of the resulting token, anti-replay
  rejection, disable, and confirmation that login returns to a plain token afterward. Every step
  checked against the real backend, not mocked.
- **Login skin**: default and fully-custom states both screenshotted (see Built, above).
- **Roles/bundles — the full enforcement matrix, via a real login as a genuinely restricted
  account** (a temporary test account, cleaned up after): a custom-role session with only
  `write`+`publish` correctly created and published real content (201/200), was correctly 403'd on
  a settings mutation (no `manage-settings`) and a product mutation (no `storefront-manager`), and
  — the check that mattered most — was correctly 403'd attempting to create a new role or reassign
  its own role via the API directly (`requireFullAdmin`, not delegable via any bundle it might
  hold). Read access remained unrestricted throughout, as designed. The `onDelete: Restrict`
  protection was also exercised for real: deleting a role still assigned to an account correctly
  409'd with the account count named, and correctly deleted once that account was removed.
- **Real browser UI**: role creation/edit/delete exercised through the actual Permissions page
  (not just the API), including the hang found and fixed above; the Users page's new role-select
  correctly reassigns and reflects the change; dark mode checked for the Permissions page, its
  role cards, and the create/edit modal.
- No regressions on Dashboard/Media (screenshotted, zero console errors). All three apps
  (backend, admin, builder) `tsc --noEmit` clean, rechecked after every fix above. All test
  accounts, roles, and content created during verification deleted afterward — confirmed via a
  final direct read of `/api/roles` (`[]`) and `/api/users` (only the original account, `roleId:
  null`, unaffected).

### Explicitly flagged — not silently worked around
- **`edit-broadly` and `storefront-customer`** are real, selectable options in the role
  builder (matching the inventory's actual 7-bundle list) but have no enforcement target of their
  own yet: `edit-broadly` (edit content you don't own) has nothing to distinguish itself from
  plain `write`, since Content has no author/ownership field anywhere in 2.0's schema (a
  pre-existing gap this file already flagged during the SEO workstream); `storefront-customer`
  has no admin-panel analog since the routes it would plausibly gate (`POST /orders`,
  `POST /customers`) are deliberately public/unauthenticated storefront-checkout endpoints, not
  admin actions at all.
- **No multi-admin invite/creation flow exists.** The only way an `AdminUser` row is created is
  the one-time setup bootstrap, which refuses once any account exists — there's no "invite a
  second admin" feature anywhere in 2.0. The role system built here is fully real and enforced,
  but today has nowhere to assign a role to beyond the original account without one. Verification
  above used a temporary account created directly via Prisma, not through any real product flow,
  specifically because that flow doesn't exist yet — flagging as a related, adjacent gap, not
  silently working around it by pretending an invite flow was in scope for "Auth & access."

## [2.0.0-beta.1] — 1.9.44 admin-parity build, workstream 7: section 05 — Chrome & Customization Studio (Quick Controls panel), themes deferred
recovered feature-inventory (theme store & saved themes/presets excluded, explicitly, per that
instruction) rather than the piecemeal single-page pattern the 5 pre-existing Appearance fields
used. The inventory itself flagged several pieces here as fixture-only in 1.9.44, never actually
wired to a save handler — this pass builds the real thing, not a copy of that gap.

### Built
- **Site-wide Appearance grew from 5 fields to 36** (`prisma/schema.prisma`,
  `settingsService`'s `Appearance` interface + `APPEARANCE_DEFAULTS`, `AppearanceInput` schema) —
  accent/intensity, topbar behavior, content width, card grid gap, glass tint/blur/background/
  shadow style, 3 font families + base size/letter-spacing/line-height, corner radius/border
  weight, motion (on-off/speed/page-transitions/hover-lift), card layout/thumbnail source/list
  view/items-per-page, 4 accessibility toggles, keyboard shortcuts + debug overlays.
- **New per-user Behavior + Advanced tabs** (`AdminUser.loginLandingPage/sidebarFolded/
  listPageRowCount/customCss`, migration `20260707234702_add_quick_controls_behavior_fields`) —
  `GET /api/me` extended, `PATCH /api/me/behavior` + `PATCH /api/me/custom-css`, custom CSS
  sanitized on write (`@import`, `expression()`, `-moz-binding`, `behavior:`, `url(javascript:...)`,
  `<script>` all stripped via regex — matches this file's own "sanitized" framing from the SEO
  workstream, same pattern).
- **Export/import** — `GET /api/settings/export` (Appearance + Behavior combined),
  `POST /api/settings/import` (Appearance allow-listed via Zod's default strip-unknown `.parse()`;
  Behavior allow-listed by hand field-by-field, since it isn't a Zod-schema boundary at that
  layer — unrecognized keys silently dropped, never applied, on both halves).
- **~150 new lines in `shared/therum-tokens.css`**, reusing the "flip the existing primitive"
  trick already validated in the design-system workstream wherever one existed (intensity/corner-
  radius/border-weight/base-size override `--radius-*`/`--th-fs-*`/`--e`/`--th-card-shadow`
  directly, so every existing consumer picks up a change with zero edits elsewhere) and adding
  new primitives only where the concept was genuinely new (letter-spacing, line-height, content-
  max-width, card-grid-gap, hover-lift).
- **The Quick Controls panel** (`QuickControlsPanel.tsx`, new) — a slide-out drawer, not another
  settings page, reachable from the topbar on every screen: 9 groups (Appearance/Layout/Surfaces/
  Typography/Shapes/Motion/Content defaults/Accessibility/Advanced) across 3 tabs (Quick Controls/
  Behavior/Advanced), reusing `SettingsControls.tsx`'s existing instant-save `Field`/`Toggle`/
  `SelectField`/`TextInput`/`NumberInput` primitives rather than inventing a parallel set.
- **Wired into both shells** — the standard topbar (`Topbar.tsx`) and Desktop Mode's dock
  (`DesktopShell.tsx`), closing a real gap found mid-build: Desktop Mode previously had no trigger
  for this panel at all (it renders `DesktopShell`, not `Topbar`), so a `triggerClassName`/
  `iconSize` prop pair was added to make the same component mount cleanly in either chrome.
- Shared `Appearance`/`Behavior` types + `appearanceDataAttrs()`/`appearanceInlineVars()` extracted
  to `admin/lib/appearance.ts` — this shape was about to be hand-duplicated a 3rd time across
  `layout.tsx`/`Topbar.tsx`/`QuickControlsPanel.tsx`/`DesktopShell.tsx`.

### Bugs found and fixed along the way (same rigor as every other workstream in this file)
- **A static route was silently shadowing the dynamic PATCH catch-all.**
  `admin/app/api/settings/appearance/route.ts` only ever exported `POST` (the old form-submit
  page); Next.js resolves an exact-path static route file before it ever considers the generic
  `[domain]/route.ts` catch-all, and does not merge HTTP methods across the two — so every
  instant-save PATCH from the new panel would have 405'd the moment it shipped. Added a `PATCH`
  export to the static file directly.
- **Hex vs. RGB-triplet mismatch on glass tint.** `<input type="color">` naturally produces a hex
  string, but `--th-glass-tint` is consumed inside `rgba(var(--th-glass-tint), 0.72)` in
  `globals.css`, which needs "r, g, b" component form — there's no native CSS hex→rgb function, so
  a `hexToRgbTriplet()` conversion was added at the point the inline style is built.
- **A real default-behavior regression, self-caught before verification.** `contentWidth`
  originally defaulted to `'normal'`, mapped to a new 1100px cap on `#th-content` — every existing
  page would have silently shrunk the moment this shipped, since no such cap existed before.
  Re-typed to `'full' | 'normal' | 'narrow'`, default `'full'` → `--th-content-max-width: none`
  (today's real, uncapped behavior); `'normal'`/`'narrow'` are the two genuinely opt-in tiers.
- **The panel's own "Appearance" group was missing the 5 fields it claimed to cover** — found
  during browser verification, not before. `density`/`sidebarStyle`/`cardStyle`/`colorMode`/
  `contrast` (the pre-existing fields the old `/appearance` page already had) were correctly
  present in the shared `Appearance` type and `appearanceDataAttrs()`, but never actually got a
  `Field`/`SelectField` in the new panel's UI — confirmed via `document.querySelectorAll('select')`
  returning 15 controls where 20 were expected. Worse, the old `/appearance` page's own comment
  claimed "these same 5 fields... now live in the panel," which was false until this was fixed.
  Added all 5 as the first entries in the Appearance group; the old page's comment is accurate now.
- **`CustomCssField` was the one save-on-blur field in the entire panel that didn't call
  `router.refresh()`.** Every other of the ~35 instant-save fields does — documented in this file's
  own code comments as load-bearing, not cosmetic, since the `data-*` attributes these fields
  control are computed server-side in `layout.tsx` on every request. Custom CSS alone skipped it,
  so a saved rule wouldn't actually render until the next unrelated navigation. Added the missing
  call, matching every sibling field.
- **Export/import silently dropped `customCss`.** `exportBehavior()`'s own comment promised
  "everything needed to reproduce this user's current setup," and the panel's own Advanced-tab
  help text says "Export everything above as JSON" — Custom CSS sits directly above the
  Export/Import buttons in that same tab. Added `customCss` to both `exportBehavior()` and
  `importBehavior()` (routed through `setCustomCss()`, not `setBehavior()`, so it still gets the
  same sanitization pass as a direct save, not a bypass).

### Verified live, in a real browser (not just typecheck-clean)
- Every one of the 9 Quick-Controls groups + both other tabs render with real initial values read
  from the authenticated user's actual settings — confirmed via `getComputedStyle`/DOM inspection
  (20 `<select>`s, 9 checkboxes, all at their documented defaults), not just visually eyeballed.
- 3 representative instant-save round trips, each traced PATCH → `router.refresh()` →
  `data-*` attribute → rendered effect: Topbar behavior → sticky (floating/rounded/shadowed pill
  returned, matching the exact look this file's own topbar-defloat entry made opt-in); Motion →
  off (`data-motion="off"` present, and a real button's `getComputedStyle().transitionDuration`
  measured `0s` — computed, not assumed); Accent color → `#00a86b` (propagated to the logo tile,
  avatar, links, and active pill; correctly did **not** retint the primary "+ New Page" button,
  confirmed intentional — `--th-accent-btn` is a separate, independently-1.9.44-sourced blue by
  design, documented in `therum-tokens.css` since the earlier design-system pass).
- All 3 Behavior fields saved and persisted through a `router.refresh()` cycle (confirmed the
  toggle's on-state survived the refresh, meaning it reflects the real server value, not
  optimistic local state) — each via its own real `PATCH /api/me/behavior` in the network log.
- Custom CSS: saved a rule containing both a legitimate declaration and a deliberately malicious
  `@import url('evil.css')`; after reload, the live injected `<style>` tag contained only the
  legitimate rule — sanitization confirmed at the actual render boundary, not just read from the
  regex source.
- Export/import: exported JSON contained all 36 Appearance fields + all 4 Behavior fields at their
  live values; re-imported a full-defaults payload with one added `maliciousExtraKey` — the
  extra key was silently absent from the response (allow-list proven, not assumed), and every
  field genuinely reset, reconfirmed via a fresh `GET /api/settings/export` read (the DB-backed
  ground truth, not the client's optimistic view).
- Dark mode: toggled live, panel itself + all 3 tabs (including the Custom CSS textarea, which has
  no special dark-mode handling of its own and still rendered correctly) re-screenshotted — no
  light-mode leakage anywhere in the drawer.
- Desktop Mode: confirmed the panel opens correctly from the dock's own trigger, closing the gap
  noted above — this had never been live-tested from that shell before this pass.
- No regressions on Media or Settings (both screenshotted post-change, zero console errors).
- All three apps (backend, admin, builder) `tsc --noEmit` clean, checked after every fix above,
  not just once at the end.
- All test mutations reset to defaults via the real Import feature itself (not a manual undo) —
  reconfirmed clean against the DB-backed export endpoint: `#th-shell` back to only its two
  always-present baseline attributes, zero leftover custom CSS, zero accent override.

### Explicitly excluded, flagged N/A, or blocked — not silently skipped
- **Theme store & saved themes** (presets/shelves, star/hide, saved-variant CRUD + export/import)
  — excluded per this pass's own explicit instruction, not an oversight. Every other export/import
  path above is the *settings* mechanism, deliberately separate from a theme-shelf mechanism that
  doesn't exist yet.
- **Layout > "variant"** — no architectural concept of a layout variant exists anywhere in 2.0;
  N/A, not deferred.
- **Advanced > drag-handle grips** — no drag-and-drop system exists for dashboard/sidebar layout
  (both already use plain move-up/move-down controls); nothing to attach a grip affordance to.
- **Advanced > an autosave on/off toggle** — dashboard and sidebar layouts already always autosave;
  a toggle would control a distinction that doesn't exist in this architecture.
- **Advanced > code-editor theme** — no code editor exists anywhere in 2.0's admin; N/A.
- **Stored but not yet load-bearing anywhere else, confirmed by grep, not assumed:**
  `itemsPerPage` has no consumer outside the settings layer itself yet (list-query defaults don't
  read it); `listViewDefault` has no current target (Pages/Posts have no view-mode concept the way
  Media does); `keyboardShortcuts` has nothing to gate yet — the sidebar's "⌘K" badge is decorative
  only, there is no `keydown` listener anywhere in `admin/app` today, pre-existing and untouched by
  this pass. All three are real, typed, and saved correctly; they just don't have a downstream
  consumer to flip yet.
- **Public-site motion layer** — still blocked on the same pre-existing gap this file has flagged
  repeatedly in earlier workstreams (SEO, Content & editing): no public theme/renderer exists in
  2.0 yet, so there is nothing to apply page-transition motion to outside the admin itself.

## [2.0.0-beta.1] — Topbar: floating pill → flush bar (default), floating kept as a future opt-in

`#th-top` had a permanent `margin: 12px 48px 0` + `border-radius` + `position: sticky` — an inset,
rounded, floats-and-sticks-on-scroll bar with no way to turn it off. Asked to make the default theme
plain instead, keeping the floating/sticky look available as a later, real toggle once a
customization-settings system exists to host it — not building that settings UI now, just not
foreclosing it either.

- Default `#th-top` is now a flush, static bar — no margin, no `border-radius`, no `position: sticky`.
  Same background/border/height/padding as before, just not inset or pinned.
- The old look moves to `[data-topbar-style='sticky'] #th-top` — an opt-in variant, same pattern this
  file already uses for `[data-sidebar-style]`/`[data-card-style]`/`[data-density]`. Nothing sets this
  attribute yet (no settings-page control exists for it), matching this file's own precedent for
  high-contrast mode: token/CSS capability now, a real UI toggle is separate, later work.
- Verified both states directly: default computed to `margin: 0`, `border-radius: 0px`,
  `position: static`; manually set `data-topbar-style="sticky"` on `#th-shell` and confirmed the old
  `margin: 12px 48px 0` / `border-radius: 14px` / `position: sticky` came back exactly, including the
  ≤900px responsive margin step — the capability works, it's just not wired to a UI yet. Checked in
  both light and dark mode; topbar background correctly tracks `--th-surface` in both, unaffected by
  the positioning change. All three apps typecheck clean.

## [2.0.0-beta.1] — workstream 6: design system — real spacing scale + a token layer that actually swaps for a second theme

Not a 1.9.44 port — this is 2.0-internal tooling, asked for explicitly so padding/spacing stop being
guessed per-component and so a future second theme is an actual swap-the-token-file operation instead
of a re-grep of every stylesheet. The 2026-07-XX color/shadow/status/radius/type-scale audit
("Default OS theme rebuilt") never touched spacing at all and explicitly skipped a component-by-
component pass — this is that follow-through, at full width this time.

### Audit — before
| Category | Defined | Real state |
|---|---|---|
| Spacing scale | 8 steps (4-64px) | **Zero consumers.** Component CSS had drifted to 26 distinct ad hoc values instead — `10px` alone appeared 38 times, more than any single step in the scale meant to replace it. |
| Sidebar semantic tokens | 5 aliases (`--th-sidebar-*`) | **Aliased the wrong source variables** — pointed at the light-page primitives (`--bg`/`--bd`/`--tx`) instead of the dark-rail ones (`--sb-bg`/`--sb-bd`/`--sb-tx`). Silently "worked" only because nothing consumed them; every real sidebar rule reached past them for `--sb-*` raw instead. |
| Primitive vs. semantic | header comment told new shell code to use `--ac`/`--sf`/`--tx` etc. directly | ~90 places in `globals.css` had done exactly that — the precise thing that breaks a second theme, since overriding `--th-accent` alone never touched any of them. |
| "On saturated surface" text color | no token | 17 literal `#fff` scattered across `globals.css` for what is the same role every time (button text, active-pill text, dock icon) — just never given a name. |

### What changed
- **Fixed the sidebar alias bug** — `--th-sidebar-bg/-line/-ink/-ink-2/-ink-3` now correctly point at
  `--sb-*`, not `--bg`/`--bd`/`--tx`. Added the missing `--th-sidebar-active-bg`.
- **New spacing scale**, named by literal px value instead of a sequential index (`--th-space-24`, not
  `--th-space-5`) so a value is legible at the call site without cross-referencing this file: 2/4/6/8/
  10/12/14/16/20/24/28/32/40/48/64/80. Built from the real frequency data above, not invented — every
  gap in the original 4/8/12/16/24/32/48/64 spine that the audit's numbers actually called for.
- **Flipped the file's own guidance**: the raw 1.9.44 values (`--ac`, `--sf`, `--tx`, etc.) are now
  documented as input-only — component CSS reads `--th-*` and nothing else. That's what actually makes
  a second theme a real possibility: swap the values inside that one block, done, instead of hunting
  down every place that reached past the semantic layer.
- **3 new semantic tokens** for gaps the audit surfaced: `--th-accent-btn(-hover)` (buttons are a
  different blue from `--th-accent` on the real 1.9.44 — had no semantic name before), `--th-surface-2`,
  `--th-transition`, and `--th-text-inverse` (`#fff` — the "on a saturated surface" text/icon color).
- **Swept `globals.css` (584 lines) + `builder/src/styles.css`**: 138 raw-primitive → semantic
  replacements, 206 spacing values retokenized, 17 literal `#fff` split onto `--th-text-inverse` (text
  on a colored surface) vs. `--th-surface` (an actually-white surface) by which CSS property was
  setting it (`color:` vs `background:` — held cleanly for all 17, checked each one, not assumed).
- **Swept inline styles across 14 TSX files** (settings pages, Studio, Content, Account, Import,
  MediaUploadButton, LoginScreen, builder's Canvas.tsx) — same spacing scale, React's `padding: 10`
  bare-number shorthand handled alongside the `'10px'` string form.
- **Rounding was a real per-case judgment call, not a blind round-to-nearest.** Where two on-scale
  edges of a pair (e.g. dashboard card padding's `18px 20px`, `22px 24px`, `26px 28px`, `30px 34px`
  tiers) each sat within a step or two of a real value, picked the rounding that made the *whole tier
  progression* consistent — result is a clean 20/24/28/32, +4px per tier, not four near-misses that
  happened to move in different directions. Every other odd value (1,3,5,7,9,13,18 elsewhere,22,26,
  30,34,60px) checked in its actual context before deciding, not rounded mechanically — full mapping
  is in the sweep scripts' `roundTo` tables if it needs auditing later.
- **Left as-is, not drift**: `#f8fafc`/`#cbd5e1` (2 more places, matching the exact 2 grays the prior
  color audit already reviewed and deliberately kept), the sidebar's `⌘K` kbd badge's `#1a1a1a`/
  `#e8e8ea` (a pixel-exact copy of 1.9.44's own light badge floating in the dark rail, by design — not
  a candidate for re-tokenizing), and bare `1px` borders/icon-nudges (below the scale's 2px floor,
  consistent with how every other 1px border in the file was already being treated).

### Verified
- All three apps typecheck clean (`tsc --noEmit` — backend, admin, builder).
- Backed up every file before its sweep (no git repo in this project — no other safety net); scripted
  sweeps were built to throw on any value without an explicit rounding rule rather than silently
  guessing, so a clean run is itself a completeness check.
- Real browser, post-sweep: Dashboard, Settings → Security, Media, and the Login screen all
  screenshotted and structurally snapshotted — no visual break.
- **The sidebar alias fix specifically checked via computed styles, not just eyeballed**: `#th-sb`
  background resolved to `rgb(22, 24, 30)` (exactly `--sb-bg`), `.th-sb-item.active` to
  `rgba(255, 255, 255, 0.07)` / `rgb(199, 204, 214)` (exactly `--sb-active-bg` / `--sb-tx`) — byte-
  identical to what the old, bypassed-alias code rendered, confirming the fix changed which token
  aliases what without changing a single rendered pixel.
- Zero console errors post-sweep.

### Follow-up pass — closing every gap the first pass flagged
The three items below were flagged, not fixed, in the first pass. Went back through all three; two
turned into real bugs once actually tested rather than theorized about.

**Sizing (icon/avatar/dot width & height).** Audited the same way as spacing: 30 distinct hardcoded
values across `globals.css` + `styles.css`. Reused `--th-space-*` rather than a parallel `--th-size-*`
axis — same "how many px" rhythm, no reason for two scales with identical numbers under different
names. 24 exact-or-rounded replacements applied via individually-verified substring matches (not a
blanket regex — several sizes here are geometrically load-bearing). Deliberately left alone:
- The toggle switch's track/thumb (`38x22` track, `16px` thumb at inset `3/3`, `translateX(16)` when
  checked) — `22 - 3 - 3 = 16` and `3 + 16 + 16 + 3 = 38` is exact interlocking math, not a "pick a
  size" choice; rounding any one number desyncs the other three.
- `.th-dock` container width, `.th-density-slider` track width, `.settings-text-input-narrow`
  max-width, and every breakpoint inside an `@media` condition (CSS can't reference a custom property
  there at all — a hard language limit, not a judgment call) — content/container widths, not a
  repeatable icon-scale decision.
- Checked the 14 TSX files too: their hardcoded `width`/`height`/`maxWidth` values are all
  form-field/card/modal content widths (`560`, `480`, `360`, `'100%'`, etc.) — same "leave it, it's
  contextual" category, confirmed rather than assumed by reading each one.

**Dark mode — found real, live bugs, not just missing token coverage.** Actually toggled dark mode
and inspected computed styles (the first pass never did this) rather than reasoning from the CSS
alone:
- **The entire main content area was rendering light-mode-colored in dark mode.** Root cause:
  `data-color-mode="dark"` lives on `#th-shell` (a `<div>` inside `<body>` — see `(app)/layout.tsx`),
  not on `<html>`/`<body>` (the root `layout.tsx`, shared with `/login`, deliberately keeps its own
  branding untouched by this toggle — couldn't just move the attribute up). `<body>`'s own
  `background: var(--th-bg)` is therefore an ancestor of the scoped element, not a descendant, so it
  never saw the override; `#th-main`/`#th-content` have no background of their own, so the page's
  actual light-grey `body` background showed straight through the entire right-hand column. Fixed by
  giving `#th-shell` its own explicit `background: var(--th-bg)` — it already covers the full
  viewport (`min-height: 100vh`), so this fully masks `<body>`'s un-scoped background without
  touching the root layout or affecting `/login`.
- **White text on a near-white pill.** `.th-lp-pill.active`/`.th-lp-view-btn.active`/the card grid's
  Edit link all used `background: var(--th-ink)` for their "filled/selected" look — correct in light
  mode (`--th-ink` is near-black there) but `--th-ink` flips to near-white in dark mode (it's the
  *text* color token, correctly inverting for body-text contrast), leaving these three with
  `rgb(241,245,249)` background / `rgb(255,255,255)` text, confirmed live via computed styles.
  Added `--th-emphasis-bg` — reuses the *raw*, never-overridden `--tx` primitive directly instead of
  the mode-aware `--th-ink` alias, so it's a stable dark fill in every mode without its own override
  block. Swapped all 3 sites onto it.
- **Toggle-switch thumb and dock notification dot both used `--th-surface` as a "stay neutral"
  marker** — correct in light mode (`--th-surface` is `#fff` there) but `--th-surface` correctly
  darkens in dark mode (right for an actual card/modal surface), leaving the switch thumb at
  2.61:1 contrast against its own track (below the 3:1 WCAG non-text-contrast floor, computed) and
  the dock dot dark-on-dark. Both switched to `--th-text-inverse` (`#fff` in every mode) — identical
  value to what `--th-surface` already was in light mode, so this changes nothing there, only fixes
  dark mode.
- Added the missing `--th-surface-2` dark-mode value (`#243447`) — no live consumer breaks without
  it today, but Desktop Mode's floating windows use it for their titlebar and would have shown a
  light titlebar on a dark window body the moment dark mode + Desktop Mode combined.
- Checked `--th-accent-btn` (blue buttons) against `--th-text-inverse` by computing the actual WCAG
  ratio rather than assuming a fix was needed: 5.61:1, already compliant, doesn't change with mode
  (the blue itself is constant) — correctly left alone.

**Component states — a real, if partial, audit.** Built a coverage matrix (base rule vs. hover/focus/
disabled) for every shared interactive class rather than spot-checking. Found and fixed:
- The bare, unclassed `button` element (several Settings pages' inline actions use this — no
  `.th-btn`/`.ghost` class at all) had a `:hover` but no `:disabled` — the only button-like control in
  the file with no deliberate disabled treatment, relying on inconsistent browser defaults. Added
  `opacity: 0.5`, matching the dimming convention every other disabled control here already uses.
- `.th-lp-sort`, `.th-lp-style-btn`, `.th-lp-view-btn` (non-active) had no `:hover` at all, sitting
  directly next to `.th-lp-pill:hover` in the same toolbar — added, matching that sibling's treatment.
- `.th-modal-close` had no `:hover`, unlike every other icon-button pattern in the file
  (`.th-dock-icon`, `.th-lp-kebab-btn`, `.th-window-controls button` all have one) — added.
- `.settings-search input` and `.th-lp-search-input` both set `outline: none` with **no replacement at
  all** — a keyboard user tabbing into either search box got zero focus indicator. Added
  `:focus-within` on the wrapper (border → `--th-accent`), the same pattern `.th-sb-search-box`
  already used correctly elsewhere in this same file.
- `.th-density-slider` also sets `outline: none` with nothing replacing it on the actual visible
  thumb — added a `:focus-visible` box-shadow ring on the thumb pseudo-element (`-webkit-`/`-moz-`
  written as separate rules; an unsupported pseudo-element in a combined selector list invalidates
  the whole rule in some browsers).
- Not fully exhaustive — this covered the shared/reused classes (buttons, inputs, toolbar controls,
  the switch), not literally every one-off element in every page. A narrower, real pass beats a
  claimed-complete one that wasn't actually checked.

**Verification, this round**: dark mode actually toggled and screenshotted at Dashboard/Pages/Media
(not just reasoned about), computed-style-checked for the switch thumb, dock dot, `#th-shell`
background, and both search-box focus rings; light mode re-confirmed unchanged after every dark-mode
fix (same values, since `--th-text-inverse` already equalled `--th-surface`'s old light-mode value);
all 3 apps typecheck clean; new CSS rules confirmed present and parsed via `document.styleSheets`
(not just "should be there"). Found and deleted one more piece of leftover test content
(`Origin Fix Verify`) from an earlier workstream's testing that a prior cleanup pass had missed.

## [2.0.0-beta.1] — 1.9.44 admin-parity build, workstream 5: SEO engine

Zero-config auto-SEO, matching `therum-seo.php`'s fallback chains: manual override → derived
from content → site default, for title/description/image, plus a JSON-LD `@graph` and
auto alt-text for media with no `alt` set.

- `src/lib/seo.ts`: `resolveSeo`/`buildMetaTags`/`buildJsonLd`/`autoAltFromFilename`. Title =
  override → item title. Description = override → excerpt (30-word trim) → first ~155 chars of
  extracted body text → site description. Image = override → coverImage → first image in body →
  site logo. JSON-LD = WebSite + Organization + (Article|WebPage) + BreadcrumbList, cross-referenced
  by `@id`.
- Wired into both render paths (`contentService.renderBySlug`/`renderById`) via a shared
  `_resolveSeoFor` helper; request origin computed per-request (`originOf()` in
  `src/api/routes/content.ts`), not a hardcoded env var — see "Fixed" below, this took two passes
  to get right.
- `/preview/[id]` (the one real render destination — no public theme exists yet) now exports a
  real Next.js `generateMetadata()` off `resolvedSeo`, plus injects the `jsonLd` object as a
  `<script type="application/ld+json">`, with every `<` in the serialized JSON replaced by its
  unicode escape so a title/description containing a literal closing script tag can't break out
  of the tag.
- `autoAltFromFilename()` strips the upload-time UUID prefix, converts separators to spaces,
  drops camera-generated numeric runs, capitalizes — applied read-time only in
  `mediaService.list()`/`get()` (`withAutoAlt`), never written back to the stored `alt` column.
- Minimal `seo-defaults` setting (site name/description/logo) — data layer only, no settings-page
  UI, matching 1.9.44's own "zero-config" positioning (its real branding fields live in a
  separate, not-yet-ported Customization system).

### Verified live (curl + mint-jwt against the raw backend, browser for the actual rendered `<head>`)
- All 4 fallback levels: no-override (body-text/first-image extraction), full manual override
  (+ `noindex` → `<meta name="robots">` present), partial (excerpt + coverImage win over body/logo),
  and nothing-at-all (pure site defaults) — each confirmed against real created/published content.
- `autoAltFromFilename` against 2 real uploads (`sunset-over-lake_02.png` → "Sunset over lake",
  `My Cat Photo.png` → "My Cat Photo"); confirmed the stored `alt` column stays `null` — only the
  read path derives a value.
- `/preview/[id]` in a real browser: `<title>`, canonical, description, og:*, twitter:*, robots,
  and the JSON-LD `<script>` all present and correct in the served HTML for both the no-override
  and full-override cases.
- Test content/media rows and the seo-defaults value were all cleaned up after verification.

### Fixed (a real bug caught by re-checking my own first-pass verification)
The first verification pass ("Verified live" above) checked resolved *values* against the
fallback logic but didn't scrutinize the *origin* closely enough — every canonical/`og:url`/
JSON-LD `@id` was quietly missing its port. Two distinct bugs stacked here:

- **`originOf()` was reading `req.hostname`, which Fastify deliberately strips the port from**
  (`this.host.split(':', 1)[0]` in `fastify/lib/request.js`) — so every generated URL read
  `http://localhost` instead of `http://localhost:10004`, in *any* environment, not just dev.
  Confirmed live: hitting the backend with `Host: localhost:10004` still produced a portless
  canonical before the fix. Now uses `req.host` (raw Host header, port intact).
- **`/preview/[id]`'s own render call never carried the real public host past its own hop.**
  Admin → backend is a hardcoded `fetch('http://localhost:4100/...')`
  (`admin/lib/api.ts`) — an internal call whose `Host` header is always the backend's own port,
  regardless of what URL the browser is actually on. Fixed the same way the nginx config already
  fixes the identical problem one hop up (`site.conf.hbs`'s `$http_host`-not-`$host` comment):
  `admin/lib/api.ts` now reads the real incoming host via `next/headers` and re-forwards it as
  `X-Forwarded-Host`/`X-Forwarded-Proto` (`forwardedOriginHeaders()`); `originOf()` prefers those
  over its own raw connection when present.
- Verified all three shapes live: a direct hit with no forwarded headers, a relayed hit carrying
  `X-Forwarded-Host: localhost:10004`, and a direct hit with `Host: localhost:10004` set straight
  (the real shape a public route would see through nginx, once one exists) — each produced the
  correct origin. Re-verified in an actual browser through `/preview/[id]`: canonical, `og:url`,
  and every JSON-LD `@id` now reflect whatever host the browser is actually on.
- Correcting the record: an earlier draft of this entry flagged `og:image` resolving against the
  wrong origin as a "known gap." That was wrong — this site runs behind one real nginx origin
  (`conf/nginx/site.conf.hbs`: `/tos-admin` and `/api/` both proxied under the same external
  port), so a relative `/api/uploads/...` path resolves correctly from the admin app's own
  origin in that real topology. The apparent mismatch only showed up because this session's own
  test tooling runs the two dev servers on separate raw ports with no nginx in front — a
  limitation of how I was testing, not a product bug. Not worth "fixing" further.

### Known gaps — flagged, not silently worked around
- No `article:section`/`article:tag` in JSON-LD — no taxonomy model exists in 2.0 yet.
- No `author` node in JSON-LD — Content has no author/createdBy field.
- No sitemap generator — 1.9.44 doesn't have one either; not tackled this pass.
- Still behind login: `/preview/[id]` is the only destination for any of this today since no
  public theme/renderer exists yet — real, correct HTML, just not reachable by an actual crawler.

## [2.0.0-beta.1] — 1.9.44 admin-parity build, workstream 4f: Metro tile view

The 4th view flagged as found-but-not-built last pass. Unlike masonry, this is a straight port
of 1.9.44's exact CSS, not a real-data reinterpretation — a metro/bento layout is a curated
tile rhythm by design, not content-driven sizing, so there was nothing to improve by reading
actual image dimensions the way masonry warranted.

- `.th-lp-view-metro`: `grid-template-columns: repeat(6,1fr)` (4 cols ≤1100px, 3 ≤800px),
  `grid-auto-rows: 110px`, `grid-auto-flow: dense`, 10px gap — exact values from
  `therum-list-media-patch.css`.
- Tile spans follow 1.9.44's positional pattern precisely: every `7n+1`'th card spans 2 cols ×
  2 rows, `7n+3` spans 2 rows, `7n+5` spans 2 cols, everything else is a plain 1×1 cell.
  Verified live with 8 uploads: computed `grid-column`/`grid-row` at every one of the 8
  positions matched the spec exactly, including the pattern correctly repeating at position 8.
- Same `MediaCard` component as grid/masonry — no new card variant needed, just a 4th CSS-scoped
  pane and a 4th view-toggle button (icon lifted directly from 1.9.44's own SVG markup).
  `viewMode` enum extended (`grid | masonry | metro | table`) end to end: zod schema → Prisma
  field (already generic `String?`, no migration needed this time) → MediaLibrary.
- Test uploads cleaned up, view reset back to grid afterward. Both apps typecheck clean.

## [2.0.0-beta.1] — 1.9.44 admin-parity build, workstream 4e: grid density + masonry

Media's view controls were entirely missing — found by re-reading the actual 1.9.44 source
(`_therum/admin/pages/therum-list-page.php` + `therum-media-page.php` + `therum-list-media-
patch.css/js` in `therum-admin.php`) rather than guessing, since the request named exact
numbers ("3x3 to 7x7") that turned out to match the real spec precisely.

- **Density slider**: real `<input type="range" min="3" max="7">`, live column-count swap on
  `input` (no lag) + a 400ms-debounced save, matching 1.9.44's exact split (view-toggle saves
  immediately, density debounces). Visually disables itself (opacity 0.4, non-interactive)
  outside grid view — also ported directly, it only ever affected the grid pane in the source.
- **Grid / Masonry / Table view toggle**, all three panes rendered together and shown/hidden
  by class rather than re-fetching per switch — same approach 1.9.44 used and for the same
  reason: instant switching, no flash.
- **Masonry sizes tiles from real media dimensions — a deliberate departure from 1.9.44.**
  The actual 1.9.44 CSS (`--th-aspect` custom property, unset anywhere) turned out to be an
  unused hook — its real masonry variety came from a positional `nth-child(3n/5n/7n/11n)`
  aspect-ratio pattern, not each image's actual dimensions, because 1.9.44 never captured
  per-image width/height in the first place. 2.0 does (the sharp pipeline from workstream 4),
  so `--th-aspect` is set for real here — each card gets its own image's true aspect ratio,
  which is what "based on media size" should actually mean. Verified live with four uploads of
  distinct real dimensions (400×800, 800×300, 500×500, 300×900): every masonry tile's
  rendered height/width ratio matched its source image's ratio exactly, pixel for pixel.
  Grid and table stay square/uniform regardless — only masonry reads real dimensions.
  New shared `useMediaActions`/`mediaUtils` extracted so `MediaCard` (grid/masonry) and
  `MediaRow` (table) share one rename/regenerate/delete implementation instead of two.
- **View state persists per-user** (`AdminUser.mediaViewMode`/`mediaDensity`, new migration,
  same pattern as `dashboardLayout`/`sidebarLayout`/`desktopModeEnabled`) — verified live:
  switched to masonry + density 3, reloaded, both survived exactly as left.
- **Not built, found but out of scope for this ask**: 1.9.44 has a fourth view, "Metro tile"
  (Windows-8-style variable tile spans), registered as `extra_views` right alongside masonry
  in the same config. Same plumbing would cover it almost for free if it's wanted later —
  flagging since it wasn't explicitly asked for and this pass didn't touch it.

## [2.0.0-beta.1] — 1.9.44 admin-parity build, workstream 4d: cut the suggestion engine

Direction: "theres 0 need for suggestions." Removed the guessing layer entirely rather than
leaving it dead in place — `computeSuggestion()`, `suggestRename()`, `bulkRenameCandidates()`,
their two routes (`GET /media/:id/suggest-rename`, `GET /media/rename-candidates`) and two
admin proxy routes all deleted, not just unused.

- **Single-item Rename** no longer fetches a suggestion first — the `window.prompt()` is
  pre-filled with the file's actual current name and nothing else. One less round-trip, one
  less thing to be "smart" about.
- **Bulk rename reshaped**: it was "scan for files my algorithm thinks need a better name";
  now it's "here is every locally-stored file, current name pre-filled, type whatever you
  want for whichever ones you check." `BulkRenameButton` takes the page's already-fetched
  `items` as a prop instead of a dedicated backend scan — one less endpoint, one less fetch on
  open, and the modal now opens instantly instead of showing a "Scanning…" state.
- **Checkboxes now default unchecked.** With the old "candidates" list, every row was already
  algorithm-flagged as worth renaming, so defaulting to all-checked made sense. Now the list is
  every file, most of which nobody's about to touch in this pass — defaulting to unchecked
  avoids an accidental mass-rename of files the user never meant to include.
- Verified live: bulk modal lists all locally-stored files with current names pre-filled,
  checking one + editing its name + executing renames only that one and leaves the rest alone;
  single-item Rename prompts with the current name, no fetch, arbitrary text preserved.
- Housekeeping: deleting a route file left a stale generated type-check shim in
  `admin/.next/types/` referencing the now-gone module — a `tsc --noEmit` false-positive, not a
  real error. Clearing `admin/.next` (disposable Next.js build cache, always safe to
  regenerate) and restarting the dev server resolved it.

## [2.0.0-beta.1] — 1.9.44 admin-parity build, workstream 4c: rename means rename

`rename()` was quietly running the typed name through `slugify()` — same function
`suggestRename()` uses to propose a default. That's wrong for the actual rename action:
lowercased, hyphens-only, punctuation stripped, so `one.jpg` → "Anything Goes! (Final)" landed
as `anything-goes-final.jpg`, not what was typed. Replaced with `sanitizeFilename()` — strips
only what would actually break the filesystem or escape the uploads dir (`/`, `\`, null/control
bytes, a leading dot) — case, spaces, and punctuation now pass through untouched.
`suggestRename()`'s own suggestions are still slug-shaped (a sane default), but whatever the
user actually submits is what lands on disk. Verified live: `one.jpg` → typed exactly
`Anything Goes! (Final)` → stored and served as `Anything Goes! (Final).jpg` (thumbnail
renamed alongside, no orphan); `one.jpg` → `anything` → `anything.jpg`, confirmed servable.

## [2.0.0-beta.1] — 1.9.44 admin-parity build, workstream 4b: Media follow-ups

Closed two of the three things flagged at the end of workstream 4. AI-vision filename
suggestion stays deferred, explicitly — manual rename ("however we want") is the actual ask,
not automation.

- **`Content.coverImage` / `SeoInput.ogImage` now accept local media URLs** — both were
  `z.string().url()`, which rejects the relative `/api/uploads/...` paths media assets
  actually store, so neither could ever reference an uploaded asset. Loosened to accept an
  absolute URL *or* a site-relative path (`src/schemas/content.schema.ts`). `canonical` stays
  strict-absolute — a relative canonical isn't meaningfully "the" canonical URL, so that one
  wasn't touched. Verified all three cases live: relative path accepted, absolute URL still
  accepted, garbage still rejected with a clear message.
- **Bulk rename, built for real** — `mediaService.bulkRenameCandidates()` (scans the library,
  reuses the same suggestion logic as the single-item engine via a shared `computeSuggestion()`
  helper rather than a second copy) and `bulkRename()` (sequential, per-item pass/fail so a
  handful of failures don't hide behind an otherwise-successful batch). Routes: `GET
  /media/rename-candidates`, `POST /media/bulk-rename`. A small self-contained modal
  (`BulkRenameButton.tsx` — no modal pattern existed anywhere in this codebase yet, so this one
  is deliberately minimal rather than pulling in a dependency for one screen) lists every
  not-yet-clean file with its suggested name, editable per row, checkbox to include/exclude,
  executes on demand. Verified live end-to-end in the browser on a clean server: uploaded 4
  uuid-prefixed files, scanned, renamed all 4 through the actual UI, confirmed every file (plus
  its thumbnail) renamed on disk with zero orphans left behind.
- Still deferred, unchanged from workstream 4: AI-vision filename suggestion — no
  Connections/credentials infrastructure exists yet to source an API key from, and per this
  round's direction it's not actually wanted ("we just need to be able to rename media however
  we want" — the manual engine above already does that).

## [2.0.0-beta.1] — 1.9.44 admin-parity build, workstream 4: Media

Second section from the zip inventory. Media already had more built than the inventory
assumed — real local-disk upload, a proper delete-with-cleanup — but zero image processing
("no image-processing dependency yet", per the code's own prior comment) and no rename engine
at all. Both were the explicit ask this pass: finish the real pipeline, not defer it again,
and don't duplicate it into two competing pieces along the way.

- **Real image pipeline** (`src/lib/imagePipeline.ts`, `sharp`) — this is the actual fix for
  the "bug": 1.9.44's own upload UI advertised EXIF-strip + auto-optimize but never implemented
  either (confirmed during the inventory read); nothing in 2.0 did either, until now. On
  upload: auto-orient from EXIF then strip it (re-encode with no `.withMetadata()`), cap the
  long edge at 2560px (verified live: a 3200×2000 source came back 2560×1600, aspect
  preserved), generate a 480px-wide thumbnail. Real `width`/`height` now populate — was
  hardcoded `null`. A file `sharp` can't parse still uploads (raw, unprocessed, error recorded
  in `meta`) rather than failing the request outright.
- **The real NeoRename engine** (`mediaService.suggestRename/rename`, one implementation, not
  two) — suggests a clean slug from alt text, or by stripping the upload-time uuid prefix when
  there's no alt text yet. Rename is collision-checked (numeric suffix), extension can't
  change, renames the thumbnail alongside the main file, rolls back the main file's rename if
  the thumbnail rename fails partway. Verified live end-to-end: 3200×2000 upload → renamed
  `<uuid>-test-oversized.jpg` → `sunset-beach-hero.jpg` (both files on disk, no orphan left
  behind) → renamed again → a canvas body's `image` node `src` referencing that exact URL
  updated automatically (`refsUpdated:1`, confirmed by re-fetching the Content row).
- **Reference rewrite is scoped to what's actually reachable today**: `Content.body` canvas
  image nodes (proven above) and `Content.coverImage` — though `coverImage` turns out to be
  `z.string().url()`-validated (absolute URLs only), while local media stores relative
  `/api/uploads/...` paths, so nothing can point a cover image at a locally-uploaded asset yet
  regardless of this rewrite. Flagging this as a real, separate gap (a "pick from media
  library" flow doesn't exist anywhere yet) rather than quietly loosening that schema as a
  side effect of this pass.
- **Alt text is now editable inline** (`MediaTable`/`MediaRow`) — the only real text field
  `MediaAsset` has, so it's the natural analog to 1.9.44's metadata editor for 2.0's simpler
  schema (no separate caption/description fields invented to force a 1:1 shape match).
- **Kebab menu** (Rename / Regenerate thumbnail / Delete) reuses the `.th-lp-kebab-*` CSS
  built for Pages/Posts in workstream 3 rather than inventing a second pattern. Delete moved
  out of the always-visible column button and into the menu for consistency; already had real
  disk cleanup underneath, unchanged.
- **Removed now-dead code**: `createMedia`/`deleteMedia` Server Actions — `deleteMedia`'s only
  caller was the button just removed above; `createMedia` (URL-register flow) had zero callers
  already, pre-existing, confirmed by grep before removal.
- **Consolidated `slugify()`** into `src/lib/slug.ts` — was a private copy inside
  `content.service.ts`; the rename engine needed the identical logic, so it moved rather than
  getting a second copy.
- **Deliberately deferred, not silently dropped**: AI-vision filename suggestion (1.9.44 called
  an external vision model; 2.0 has no credentials/Connections infrastructure yet to source an
  API key from — building that is its own task, not a side effect of this one) and bulk-rename
  (scan-all → checklist → batch-execute; the single-item engine above is the real, hard part —
  bulk is a loop over it plus a checklist UI, a reasonable fast-follow rather than cramming in
  on top of everything else this pass).
- Verified live end-to-end via direct API calls (mint-jwt + curl, to exercise the real pipeline
  precisely) and in the browser (upload button, inline alt edit, kebab menu, all three
  actions). `tsc --noEmit` clean on both apps. `uploads/` confirmed empty again after test
  cleanup — nothing left behind.

## [2.0.0-beta.1] — 1.9.44 admin-parity build, workstream 3: Content & editing (Pages/Posts)

Following the full 11-agent inventory pass over the fresh 1.9.44 zip (every mu-plugin,
`_therum/src/*`, install-wizard, third-party plugins — reported back and scoped with Bam
before touching anything), this is the first section ported: Content & editing, Pages/Posts
only. Case Study is deliberately excluded — it's the future "From the Studio" addon content
type (already gated off in `nav.ts`), not a rebuild target this pass.

- **Cards Admin, for real this time** — `ContentCard.tsx` now wires up two CSS affordances
  that existed in `globals.css` (`.th-lp-card-kebab-wrap`/`.th-lp-kebab-btn`, `.th-lp-view-live`)
  but had no component behind them: a kebab menu (Preview / Duplicate / Delete) plus a
  two-button footer (Edit always, View Live once published). Status dot is now color-coded
  by status instead of always success-green.
- **Backend**: `contentService.duplicate()` (dedupes title/slug via suffix, forces draft,
  clears `publishedAt`) and `contentService.renderById()` (same canvas→HTML render as the
  public `renderBySlug` path, factored into a shared `_toHtml()`, but keyed by id with no
  published-status gate — feeds the new admin preview). Routes: `POST /content/:id/duplicate`,
  `GET /content/:id/render`.
- **New `/preview/[id]` admin page** serves both Preview and View Live — there's no separate
  public theme/renderer built yet (see "no public storefront" note elsewhere in this file), so
  this is the one honest destination for either link today. Reuses the existing Desktop-Mode
  `?embed=1` bare-render escape hatch (middleware → `x-th-embed` header → layout skips the
  shell) instead of a new route group. A banner ("Draft — preview only, not public" vs.
  "Published — this is live") is the only thing that changes between the two.
- **New `admin/lib/wordCount.ts`** — content-agnostic word count (prefers `excerpt`, else
  walks the canvas tree's text-bearing props, else strips tags from an html/markdown string).
  Replaces the old excerpt-only version that returned 0 for any canvas-authored item with no
  excerpt set.
- **Consolidated `pages/page.tsx` + `posts/page.tsx`** (near-identical duplicated code,
  flagged during the 1.9.44 inventory pass) into one shared `ContentTypeListPage.tsx`,
  parameterized by type.
- **Closed a real exposure gap**: `/content/page.tsx`'s type tabs and create-dropdown still
  let you browse/create `case_study` directly by URL even though the Portfolio nav item (and
  the addon) stays off. Removed `case_study` from both; left everything else on that page
  working, since it's the actual future home for the Studio addon (`nav.ts` already points
  Portfolio's href there).
- **Found and fixed a live instance of the Server Action staleness bug this file already
  documented once** (see the workstream-2 entry below): the pre-existing `createContent`
  action — untouched by this work, reused from `pages`/`posts`/`content` — started throwing
  `createContent is not defined` mid-session after enough Fast Refresh cycles while this exact
  workstream was being built. Converted just this call site to a Route Handler + client fetch
  (`POST /api/content`, new `NewContentButton.tsx`), the same fix pattern as before. Left every
  other pre-existing Server Action alone — not reported broken, not touched.
- **Verified live end-to-end**, including a clean dev-server restart specifically to rule out
  stale HMR state after the fix above: create → duplicate → preview (draft banner) → publish
  (via the still-working `/content` table) → View Live (published banner) → delete, on both
  Pages and Posts. `tsc --noEmit` clean on both the backend and admin.

## [2.0.0-beta.1] — 1.9.44 admin-parity build, workstream 2: Settings hub shell

- **Settings hub** (`admin/app/(app)/settings/`) — left-rail-of-sections
  container + content pane, matching 1.9.44's settings shell shape but with a
  static section registry (`admin/lib/settingsSections.ts`) instead of WP's
  dynamic `Therum_Settings::register()` — 2.0 has no plugin ecosystem
  contributing sections at runtime, so a plain ordered array is the whole
  mechanism needed. One section registered so far: **Appearance**. More land
  as later workstreams build them (Login/Security/Permissions with auth
  hardening, etc.) rather than being stubbed in ahead of having anything
  real to show.
- **Appearance settings, fully wired end-to-end** — density (compact/
  comfortable/breathing), sidebar style (default/pills/minimal), card style
  (flat/shadow/glass), color mode (light/dark/system — 'system' actually
  follows `prefers-color-scheme`, not just declared-and-ignored), contrast
  (normal/high, extending the token layer that already existed from the
  original design-system pass). Every one of these has a real, distinct CSS
  effect — none is a declared-but-unenforced toggle (the exact gap 1.9.44's
  own Performance tab had for `lazy_images`/`defer_js`/emoji-disable/etc.,
  found during the earlier research pass). Applies across the authenticated
  app shell only — the sign-in screen keeps its own independent branding.
- **Found and fixed a real, reproduced bug**: the first click-test of the new
  Appearance form hit the exact "Invalid Server Actions request" error this
  session already diagnosed once for login — same root cause (Server Action
  ids are a content hash baked into the page bundle; this dev server gets
  restarted often during active work, and an already-loaded page's action
  reference goes stale the moment that happens). Converted the 3 new
  mutations (`saveAppearance`, dashboard card move/resize) from Server
  Actions to plain Route Handlers (`admin/app/api/settings/appearance`,
  `admin/app/api/dashboard-layout/{move,resize}`) — same fix pattern as
  auth, not reapplied to the ~11 pre-existing Server Actions elsewhere in
  the app (createProduct, toggleExtension, etc.), which aren't reported
  broken; flagged as a background task rather than rewritten speculatively.
- **Found and fixed a second real bug surfaced by the above**: the Route
  Handlers' redirect-back-to-the-page logic (`NextResponse.redirect(new
  URL(path, req.url))`) resolved to `http://localhost:3100/...` — this
  app's own internal dev-server port, not the public, nginx-proxied
  `:10004` the browser is actually on — which would have silently kicked
  users off the "one door, not three ports" setup this session already
  consolidated. Root cause traced one level deeper: nginx's
  `proxy_set_header Host $host` strips the port from the Host header
  (`$host` is normalized without a port in nginx; `$http_host` is the raw,
  unmodified header) — so even reading the Host header directly for the
  redirect origin came back as `http://localhost` (implicit port 80) until
  the nginx config itself was fixed to forward `$http_host`. Fixed in both
  `conf/nginx/site.conf.hbs` and the live generated config, validated,
  reloaded. New shared helper `admin/lib/session.ts`'s `redirectUrl()`
  builds the correct origin from the (now-correct) forwarded headers.
  Verified live: resize/move/save all correctly stay on `:10004` through a
  real browser click, no dev-server-port leak.
- Verified live end-to-end in a real browser: resized a dashboard card
  (breakdown detail appeared correctly at the new size, no page-reload
  glitches), changed card style to glass and confirmed it persisted through
  a save → redirect → fresh page load cycle correctly.

**Still ahead**: auth/security hardening (2FA, roles, API tokens),
content/media/SEO, power-user tools, updates/backup, onboarding wizard.

All notable changes to Therum CMS 2.0 (Pure + Unlocked base) are tracked here.
This repo is **not yet git-tracked** — until the base is solid, work is tracked
via this file + `PROGRESS.md` instead of commits.

## [2.0.0-beta.1] — 1.9.44 admin-parity build, workstream 1: Dashboard + Sidebar + Design System

Following a full research pass over Therum OS 1.9.44's 18 mu-plugins (dashboard,
sidebar IA, theming engine, and every settings screen), the direction is to
rebuild everything real (dashboard/sidebar/settings/auth/content/media/SEO/
power-tools/updates/backup/wizard) against 2.0's own architecture — not a
literal port, and explicitly not commerce settings (WooCommerce-specific,
nothing there applies to Counter). This is workstream 1 of that build.

- **New `Setting` model** (`prisma/schema.prisma`) — a generic key/value store,
  the Node/Postgres analog of `wp_options` minus the autoload-cache baggage.
  Every settings domain from here on (Appearance now; Login/Notifications/
  Backup/etc. as later workstreams land) is a typed wrapper over it
  (`src/services/settings.service.ts`). Migration `20260706200154_admin_settings_dashboard_layout`.
- **Per-user `dashboardLayout` field on `AdminUser`** — card order + size tier
  (`xs`/`sm`/`md`/`lg`), not per-user sidebar reordering (that WP mechanism
  existed only to reconcile arbitrary 3rd-party-plugin nav items into
  sections; 2.0 has no plugin ecosystem generating unpredictable nav items,
  so the sidebar section structure is static/curated instead).
- **Real Site Health check** (`src/services/system.service.ts`,
  `GET /api/system/health`) — actually checks DB reachability, Redis
  reachability, whether `JWT_SECRET` is still the dev placeholder, CORS
  wildcard-in-production, `NODE_ENV`, and the payment webhook secret. Not a
  decorative "all green" — verified live against this exact environment, it
  correctly flagged `JWT_SECRET` as still being the dev placeholder here.
- **Found and fixed a real gap while wiring per-user dashboard state**: the
  admin app minted a synthetic `sub: 'admin-ui'` token for *every* backend
  call instead of forwarding the actual logged-in admin's own session token
  — harmless while nothing was per-user, but would have silently broken
  per-user dashboard layouts (and any future per-user feature) since the
  backend would never see the real user's id. `admin/lib/api.ts` now
  forwards the real `th_session` cookie when present, falling back to the
  synthetic token only in the rare context with no session (e.g. build time).
- **Sidebar restructured** from a flat 8-link list into sectioned IA —
  Content (Content, Media), Store (Products, Orders — only rendered when the
  `commerce` capability is actually active, fails closed if the capability
  service is unreachable), System (Studio, Extensions, Import). Active-link
  highlighting via a small client component (`Sidebar.tsx`, `usePathname`).
  This is 2.0's real current feature set, not a placeholder 1:1 copy of
  1.9.44's Content/Site/Workspace/Studio/System taxonomy — sections like
  "Site" (themes/menus/templates) and "Workspace" (appearance) will appear
  once the settings-hub and later workstreams actually build something to
  put in them, rather than shipping empty sections now.
- **Dashboard rebuilt** from 4 static cards into a real per-user
  customizable grid: Content (count + published/draft/archived breakdown +
  recent items at `lg`), Products/Orders (conditional on commerce), Media
  (count + image/other breakdown), Recent activity (real data — most
  recently updated Content rows), Site Health (real checks above). Reorder
  (move up/down) and resize (xs/sm/md/lg picker) are plain forms bound to
  Server Actions — same "no client-side fetch" pattern as the rest of this
  app (`toggleExtension` etc.), not a drag-and-drop library — persisted via
  `PATCH /api/me/dashboard-layout`.
- **Found and fixed a real test-infra bug while adding coverage for this**:
  the new `GET /api/system/health` check calls `redis.ping()`, which lazily
  opens a real persistent connection the first time anything touches it. No
  existing test file had ever exercised a redis-touching route, so nothing
  had needed `disconnectRedis()` in its `after()` hook before — without it,
  the test process's event loop never drains and `node --test` hangs
  forever after the last assertion with zero output, no failure, no exit.
  Fixed in `test/settings.test.mjs`; confirmed clean exit + `38/38` passing
  afterward (was 30/30 backend before this workstream).
- Verified live: full login → dashboard round trip through the real nginx
  path (`localhost:10004/tos-admin`), curl-verified against a real session
  (`/api/me`, `/api/settings/appearance`, `/api/system/health` all correct),
  and a full server-rendered page fetch with no errors and all expected
  content present.

**Still ahead in the 1.9.44-parity build**: Settings hub shell (the
left-rail-of-sections container everything else plugs into), auth/security
hardening (2FA, roles, API tokens), content/media/SEO, power-user tools
(redirects, 404 monitor, activity log, command palette, bulk actions, find
&amp; replace), updates/backup, and a consolidated one-phase onboarding
wizard. Commerce settings explicitly out of scope (1.9.44's only real
settings tab there — HPOS/Legacy REST API — is 100% WooCommerce-internals
with zero meaning for Counter's from-scratch Postgres schema).

## [2.0.0-beta.1] — Admin moved to its own URL (`/tos-admin`); found and fixed a real full-auth-bypass bug along the way

Requested directly: the dashboard shouldn't live at bare "/" — that's a
WordPress-shaped assumption (`/wp-admin` is fixed and every WP site has it;
this isn't WP and shouldn't inherit that convention). Went with
`/tos-admin` (short, matches the existing "ThOS"/"Th" brand shorthand
already in the login screen; trivial one-line rename to
`/therum-os-dashboard` later if preferred).

- `admin/next.config.mjs`: `basePath: '/tos-admin'`. This is the correct
  primitive for moving a whole Next.js app under a prefix — `next/link`,
  `useRouter()`, and middleware's `req.nextUrl` all become basePath-aware
  automatically. It does NOT auto-prefix plain `fetch()` calls to relative
  paths, so:
- `admin/lib/session.ts`: added `BASE_PATH = '/tos-admin'` as the one
  source of truth for the prefix.
- `LoginScreen.tsx` (login + setup) and `LogoutButton.tsx` (logout): their
  3 raw `fetch('/api/auth/...')` calls now use `` `${BASE_PATH}/api/auth/...` ``.
- nginx (`conf/nginx/site.conf.hbs` + the live generated config): the
  `location /` → :3100 block became `location /tos-admin { proxy_pass
  http://127.0.0.1:3100; ... }` (no trailing path on proxy_pass = forward
  the full URI unchanged, which is what a basePath'd Next.js app expects to
  see, including its own `/tos-admin/_next/*` assets and
  `/tos-admin/api/auth/*` Route Handlers). Bare root now `location = / {
  return 302 /tos-admin; }` — there's no public storefront built yet, so
  root redirecting straight to the dashboard is the reasonable default for
  now. The earlier special-cased `location /api/auth/` block (from the
  login-routing fix below) is gone — no longer needed, since
  `/tos-admin/api/auth/*` no longer collides with the raw backend's
  `/api/*` namespace at all. The `/wp-admin` redirect (above) now targets
  `/tos-admin` directly instead of `/` (one hop instead of two).
- Validated (`nginx -t`) and reloaded (`kill -HUP` on the master). The
  admin's Next.js dev server was fully restarted (not just hot-reloaded) —
  `basePath` is read once at boot, same as any other next.config.mjs change.

**Also fixed, found only by testing the actual `from`-redirect mechanism
directly:** `LoginScreen.tsx`'s post-login redirect trusted the `from`
query param with only a `.startsWith('/')` check — this is exactly the
mechanism that turned Local by Flywheel's stale wp-admin button into an
**in-app** 404 right after a successful login (see the entry below this
one for the full trace). Added `KNOWN_ROUTES` (the actual top-level routes
this app serves) and `safeRedirectTarget()` — `from` is now only honored
if it's one of them; anything else (a dead path, a typo, whatever) falls
back to the real dashboard instead of wherever the query string says.

**Found by testing the full logout cycle live (not just "does it show the
login page"), a second real bug, unrelated to the basePath move but
surfaced while re-verifying it:** `admin/app/api/auth/logout/route.ts`
called `response.cookies.delete(COOKIE_NAME)` with no `path` option.
Browsers key a cookie by (name, path, domain) together — login/setup set
`th_session` with an explicit `path: '/'`, but `delete()` with no path
defaults to the *request's own directory* (`/tos-admin/api/auth/`, or
`/api/auth/` before the basePath move — either way, never `/`). That
mismatch means the "clearing" Set-Cookie never actually overwrites the
real session cookie; the browser just silently keeps two cookies with the
same name at different paths, and the real one keeps working. Concretely:
logout appeared to work (fetch returned 200, the UI navigated to the login
page) while the session stayed fully valid underneath — confirmed by
hitting an authenticated route again afterward and getting the dashboard,
not a redirect. Fixed by matching the path exactly:
`response.cookies.delete({ name: COOKIE_NAME, path: '/' })`.

**Found by testing bare-root auth enforcement specifically, a third real
bug — the most serious one, a genuine full authentication bypass:**
`middleware.ts`'s `config.matcher` was
`['/((?!_next/static|_next/image|favicon.ico).*)']`. Next.js prepends
`basePath` to matcher patterns before evaluating them — the pattern above
requires a `/` immediately after `/tos-admin` to match anything at all, so
the bare basePath root (`/tos-admin`, nothing after it — i.e. **the
dashboard itself**) satisfied neither the exclusion nor the capture group.
Middleware silently never ran for that one specific path. Confirmed via a
temporary debug log: `curl http://localhost:3100/tos-admin` with zero
cookies returned **200** with real dashboard HTML, while
`/tos-admin/products` (any nested path) correctly redirected to login the
whole time — only the root was ever exposed. Fixed by adding an explicit
`'/'` entry: `matcher: ['/', '/((?!_next/static|_next/image|favicon.ico).*)']`.
Verified: bare `/tos-admin` with no cookie now correctly 307s to login;
the full login → dashboard(200) → logout → dashboard(307, not 200) cycle
now behaves correctly end-to-end through the real nginx path.

This is exactly the kind of bug the existing test suites structurally
cannot catch — `admin/test/*.test.mjs` only unit-tests `verifyJwt` as a
pure function; nothing spins up the real Next.js server and drives an
actual HTTP request through its middleware. Flagged as a follow-up (not
done here): add a real HTTP-level test for this. All existing suites still
pass unaffected (backend 30/30, admin 5/5) and `tsc --noEmit` is clean —
neither would have caught this regardless.

**Verified live end-to-end, real browser, real nginx path
(`localhost:10004`):** bare `/` → 302 → `/tos-admin` (real dashboard,
30/46/28/24 stat cards). Log out → correctly lands on
`/tos-admin/login`, and — now genuinely, not just visually — the session
is actually gone. Log back in with the real account → back on the real
dashboard. `/wp-admin` → 302 → `/tos-admin` directly.

## [2.0.0-beta.1] — Added a `/wp-admin` redirect shim; confirmed the link isn't coming from our own code

Reported: a 404 on a link pointing at `/wp-admin`. This site was WordPress
before the 2.0 rewrite, so something still expects that path to exist.

**Checked first, before assuming:** grepped all of `therum-cms-2` (every
`.ts`/`.tsx`/`.js`/`.json`) and both nginx configs for `wp-admin`/`wp-login`
— zero matches in our own code. Click-verified every page in the live admin
(Overview, Extensions, Studio, Content) with a real browser and searched
each page's rendered DOM for a wp-admin link — none exists anywhere in this
app. This app never generates that URL; nothing here needs to be "ported."
Most likely source: Local (by Flywheel)'s own per-site UI still assumes
this is a WordPress install and offers a `wp-admin` shortcut it constructs
itself, unaware we repointed the nginx behind it — or a stale browser
bookmark/history entry from the 1.9.44 era. Neither is fixable in our code.

**Fix — a redirect shim, source-agnostic:** whatever still points at
`/wp-admin` or `/wp-login.php` now lands on the real admin instead of a
dead end:
```
location ^~ /wp-admin { return 302 /; }
location = /wp-login.php { return 302 /; }
```
Added to both `conf/nginx/site.conf.hbs` and the live generated config;
validated (`nginx -t`) and reloaded (`kill -HUP` on the master, same
pattern as the auth-routing fix above). Verified live: `localhost:10004/wp-admin`
→ 302 → real Overview dashboard, no 404.

**Noticed in passing (not fixed, flagging only):** the Extensions and
Content admin pages are cluttered with dozens of `it-ext-*` /
`it-folio-*` / `it-render-*` rows — leftover integration-test fixtures
that never got cleaned up, unlike `test/auth.test.mjs`'s pattern of
seeding + deleting in `before`/`after`. Cosmetic only (doesn't affect this
fix), but worth a cleanup pass.

## [2.0.0-beta.1] — Fixed the REAL "same error on sign in" bug: nginx was routing auth straight past the Next.js app

The case-insensitive-login fix (below) was correct and fully verified — but
the user kept hitting "Incorrect username or password" on the real site
afterward regardless. Three rounds of server-side testing (direct backend,
direct admin, even a curl against the `:10004` proxy) all showed 200 OK, so
it looked server-side-clean every time. That was the trap: **those tests
only checked the HTTP status code, never the response body shape** — the
one thing this bug actually broke.

**Root cause, found by finally driving the real login form in a real
browser (Chrome, via `claude-in-chrome`) instead of reasoning from curl:**
`conf/nginx/site.conf.hbs` (and the live generated copy at
`.../Local/run/2wO0ceIsz/conf/nginx/site.conf`) had one `location /api/`
block proxying **all** `/api/*` paths straight to the raw Fastify backend
(`:4100`) — including `/api/auth/login`, `/api/auth/setup`, and
`/api/auth/logout`. Those three are special: they have a Next.js-side
wrapper (`admin/app/api/auth/*/route.ts`) whose entire job is to translate
the backend's `{token}` response into the `{ok, error}` shape
`LoginScreen.tsx` actually reads, and to set the `th_session` cookie the
rest of the admin app checks for. Routed straight to `:4100`, the browser
got back `{token: "..."}` with **no `ok` field** — so
`if (!body?.ok) setError(...)` fired unconditionally, every single time,
regardless of whether the credentials were right, and no session cookie
was ever set. The backend really was authenticating correctly the whole
time (hence the clean 200s); the proxy just never let the browser reach
the code that would translate that success into something the frontend or
the browser's cookie jar could use.

- Added a `location /api/auth/` block (longer prefix than `/api/`, so it
  wins on specificity regardless of file order) proxying to `:3100`
  (Next.js) instead of `:4100`, in both the `.hbs` source template and the
  live generated config Local is actually running.
- Validated with Local's bundled nginx 1.26.1 binary (`nginx -t`) before
  reloading; reloaded via `kill -HUP` on the running master (pid stayed
  the same, worker respawned) — no site restart needed.
- **Verified live, in an actual Chrome browser, through the real
  `localhost:10004` path**: typed `Therum` / `therumos` into the real
  form, submitted, landed on the real dashboard (Overview: 30 products, 46
  orders, 28 extensions). Confirmed the session is real (not just a
  client-side route change) by doing a full navigation reload of `/` —
  still authenticated, sidebar and data still render.
- This also silently fixes logout (`/api/auth/logout` had the identical
  problem — it could never actually clear `th_session` through the proxy)
  even though it hadn't been reported yet.

## [2.0.0-beta.1] — Fixed: login username lookup was case-sensitive (a real bug, not user error)

The account is `Therum` (capital T, as originally set up); typing `therum`
got rejected as "Incorrect username or password" even with the right
password — `db.adminUser.findUnique({where:{username}})` did an exact-case
match. Most real systems treat usernames case-insensitively at login for
exactly this reason (it's an identifier typed from memory, not a security
boundary).

- `src/services/auth.service.ts`: login now uses
  `findFirst({where:{username:{equals, mode:'insensitive'}}})` instead of
  `findUnique` (Prisma's case-insensitive mode needs a filter query, not an
  exact-index lookup).
- Password matching is untouched — still exact/case-sensitive, as it should
  be. Verified wrong-password still correctly 401s regardless of username case.
- New regression test: a mixed-case username logs in correctly via both its
  lowercase and uppercase forms.
- Verified directly against the real account: `therum`, `THERUM`, and
  `Therum` all now log in; a wrong password on any of them still fails.
- 30/30 backend tests (was 29), 40/40 across all three apps.

## [2.0.0-beta.1] — Login crash ("Objects are not valid as a React child") — hardened, root cause not conclusively pinned

Reported right after the Route Handler fix above. React's exact error names
the shape: `object with keys {code, message}` — that's this codebase's own
backend error shape (`{error:{code,message,field?}}`), so *something*
rendered an error object directly instead of extracting `.message`.

**What I could verify:** re-tested the full round trip fresh (clean restart,
no cache) — correct login, wrong password, duplicate setup, and a real Zod
validation error from the backend all correctly reduced to plain strings
through both Route Handlers right now. Could not reproduce the crash via
direct HTTP testing on either endpoint.

**Most likely explanation, not confirmed:** dev-mode staleness — the same
class of problem as the CSS 404 and the Server Actions error earlier in this
session (this dev server has been restarted many times). Not something I can
prove after the fact once the state that caused it is gone.

**Hardened regardless of root cause** (this prevents the *symptom* even if
the trigger was something I haven't pinned down):
- `LoginScreen.tsx`: added `asErrorString()` — an error value is only ever
  rendered if it's actually a non-empty string; anything else (including an
  object) falls back to a safe default message instead of reaching React's
  child renderer.
- Both `handleLogin`/`handleSetup` now wrap the fetch+parse in try/catch (a
  network failure or non-JSON response previously had no handler at all).
- Both `/api/auth/{login,setup}/route.ts` similarly wrapped — a backend
  outage now returns a clean `502` JSON error instead of Next's generic
  uncaught-exception response shape.
- Removed a redundant `router.refresh()` immediately after `router.push()` —
  App Router already re-fetches server data for the destination route; the
  extra call was unnecessary and added an ordering ambiguity.
- Fresh clean restart (`.next` wiped) done; 39/39 tests still pass.

**If this recurs after a hard-refresh on a freshly-loaded page**, it's not
dev-mode staleness and needs a real look — see the note to Bam.

## [2.0.0-beta.1] — Fixed "Invalid Server Actions request" on login: moved auth off Server Actions entirely

Hit while actually trying to log in: Next.js's `Error: Invalid Server Actions
request`. Root cause — a Server Action's id is a content hash baked into the
page bundle at compile time; this dev server has been restarted/cache-cleared
many times this session (most recently to fix the stale-CSS issue), and any
already-loaded page's Server Action references go stale the moment that
happens. This was never going to be a one-time fluke — it was going to
recur every time the dev server restarted, which has been often.

**Fix: moved login/setup/logout off the Server Action (RSC) protocol onto
plain Next.js Route Handlers** (`app/api/auth/{login,setup,logout}/route.ts`)
— ordinary HTTP endpoints with no bundle-hash coupling, so a dev-server
restart can't invalidate them.

- `LoginScreen.tsx` now does a plain `fetch()` + `router.push()`/`router.refresh()`
  instead of `<form action={login}>`; errors render inline via client state
  instead of a redirect-with-query-param round trip (also simpler and faster
  — no full-page reload just to show an error).
- New `LogoutButton.tsx` (small client component) replaces the sidebar's
  `<form action={logout}>`.
- `middleware.ts`: added `/api/auth` to the public-path exemption — those
  routes must be reachable without a session (that's how a session is
  created); without this the login request would itself get redirected to
  `/login` by the same gate it's trying to satisfy.
- `actions.ts`: removed `login`/`setupAdmin`/`logout` (now dead code) and
  their now-unused imports; the remaining Server Actions (`createProduct`,
  `toggleCapability`, etc.) are unchanged — those are lower-risk since
  they're only ever invoked from already-authenticated, freshly-loaded pages,
  not a public login screen that outlives dev-server restarts.
- **Real end-to-end verification this time — Route Handlers can be curl-tested
  properly, unlike Server Actions**: POST real credentials → 200 + a correct
  `Set-Cookie` (httpOnly, SameSite=lax, 12h) → that exact cookie against a
  protected page → 200 (not redirected). Wrong password → 401 with a clear
  message. Logout → cookie expiry set to epoch. Unauthenticated → still 307
  to `/login`. All independently confirmed, not assumed.
- 39/39 tests still pass across all three apps.

## [2.0.0-beta.1] — Default OS theme rebuilt: design system audit + new token layer

Ran the `design:design-system` skill's audit against the real token file +
both stylesheets (per Critique's embedded Design System / Design Tokens /
Color Theory / Typography frameworks). Sources consulted for direction:
`make.wordpress.org/design/2023/08/10/admin-design-kickoff` and
`make.wordpress.org/core/2023/07/12/admin-design` (fetched and read in full —
**both are strategic-direction posts with zero concrete hex/spacing/type
values specified**, confirmed directly rather than assumed; their actual
stated principles — accessible themeable color scales with a high-contrast
option, spacing/shadow variables, primitives that work in both dense and
spacious contexts — are what's applied below). The referenced Figma Community
file could not be accessed: it's a `/community/file/` listing URL with no
`node-id`, and the Figma MCP tools explicitly require a real node-specific
`/design/` URL rather than a guessed one — plain fetch also 403'd. Not
guessed, not faked; flagging honestly rather than inventing "extracted"
tokens from a file that was never actually read.

### Audit — before

| Category | Defined | Hardcoded instances found |
|---|---|---|
| Colors | 6 tokens | ~35 hex literals across globals.css + styles.css, +6 more in TSX (Studio page, Canvas.tsx, element-registry.ts) |
| Shadows | 0 tokens | same `rgba(16,24,40,0.05)` literal repeated in 2 places |
| Status semantics | 0 tokens | 3 color pairs in ad hoc use, one of them (warning) with **two different, near-identical hex pairs** for the same meaning |
| Border radius | 2 tokens (8/12) | a **3rd, undocumented** value (10px) in active use on tables/cards |
| Type scale | 5 steps | the single most-used size in the codebase, 11px (7 inline occurrences), **wasn't in the scale at all** |
| Cross-app consistency | — | admin and builder used **two different hex values** for the same "app background" role |
| High contrast | none | not present, despite being explicitly named in the WP direction posts |

**Real bugs this caught**, not just style: the admin/builder background mismatch, a muted-text color hardcoded instead of tokenized in one spot (while every other instance correctly used the token), and the duplicate warning-color pair.

### What changed

- **Accent moved off `#4f46e5`** (Tailwind indigo-600) — that exact hue is a named anti-pattern in this same md (Impeccable's "AI default blue," vibecoded-design-tells' "purple-blue monotone"). New: `#1d4e89`, a deeper, desaturated, less-purple blue — same trust/stability semantics (color psychology section), reads considered rather than templated. Added `-hover`, `-tint`, `-border`, and `-on-dark` variants (fixing the sidebar wordmark's own stale indigo tint in the process).
- **Every color pairing WCAG 2.1 AA-verified by computing the actual ratio**, not eyeballed: white-on-accent 8.39:1, accent-as-text-on-white 8.39:1, accent-on-tint 7.38:1, success/warning/danger text-on-bg 4.57–6.38:1, the new high-contrast variants hit AAA (14.33–21:1).
- **Semantic status tokens** (`--th-success/-warning/-danger-*`) — replacing 3 ad hoc pairs and unifying the duplicate warning colors onto one canonical pair.
- **`--th-shadow-sm`** — the repeated literal, named.
- **`--th-fs-2xs: 11px`** — closes the real gap (the most-used untokenized size).
- **Radius consolidated** to 2 steps (controls @ 8px, surfaces @ 12px) — the stray 10px absorbed into 12px.
- **High-contrast mode** — `[data-contrast='high']` token overrides (ink→black, accent→`#0a2a52`, etc.), all AAA-verified. Token-layer only; a user-facing toggle is a follow-up, not built here.
- Background drift fixed (builder now consumes `var(--th-bg)` instead of its own hardcoded hex); every other found hardcode fixed at its source, including the two TSX instances the CSS-file grep wouldn't have caught (Studio's edition banner, Canvas's price color, element-registry's default Button color — the last one deliberately kept as a **resolved hex, not a `var()`**, since it's a content-authoring default that can be exported as standalone HTML with no token stylesheet attached).
- Left as-is, not drift: 3 one-off light-neutral grays (`#f8fafc`, `#cbd5e1`, `#1e293b`) used consistently within their own contexts — not inconsistent with each other, so not forced into new tokens just for the sake of it.
- 39/39 tests still pass across all three apps; all three rebuild clean.

### Explicitly not done here (flagged, not silent)

- A full sweep of every inline style across every admin page (only the ones the audit's grep actually surfaced were fixed).
- A user-facing high-contrast *toggle* (the CSS capability exists; wiring a switch into Studio/settings is separate work).
- Any literal token extraction from the Figma community file (inaccessible — see above).
- A from-scratch component-by-component audit (buttons/inputs states, per the skill's fuller "Component Completeness" table) — this pass was token-layer only, which is where the actual drift was.

## [2.0.0-beta.1] — Login screen redesigned as a persistent Sign in / Create account tab pair

The previous version picked ONE form to show based on server state (setup vs
login), which was confusing to hit blind — you couldn't tell why you were
seeing one or the other, and a stale page load could leave you stuck looking
at the wrong one.

- `admin/app/login/LoginScreen.tsx` (new client component) — both **Sign in**
  and **Create account** are always visible as a two-segment tab bar; which
  one opens by default just follows real account state (or an explicit
  `?mode=` set by a failed submit, so an error redirect lands you back on the
  tab you were using — `actions.ts`'s `login`/`setupAdmin` now include `mode`
  in their redirects).
- The one-time setup guard on the backend is unchanged (`setup()` still
  refuses once any account exists) — trying "Create account" after the fact
  now surfaces the real 409 message inline rather than silently doing
  nothing, instead of hiding the option entirely.
- New brand mark: a rounded-square "Th" element-tile icon (big T, small h —
  the periodic-table-tile look), inline SVG using the shared `--th-accent`
  token, centered above the wordmark.
- `admin/app/login/page.tsx` is now a thin server wrapper (checks
  `/api/auth/status` + reads `mode`/`error`/`from`) rendering the client
  component — same pattern as the rest of the app.
- Verified structurally (curl): both tab labels present, icon SVG present,
  and the server-rendered default form correctly matches real account state
  (fields for login only — no leaked `confirmPassword` — once an account
  exists). **Not pixel-verified** — no Chrome browser was selected this pass,
  so the icon's exact glyph spacing hasn't been visually confirmed, only
  reasoned through the SVG coordinates.
- 39/39 tests still pass across all three apps.

## [2.0.0-beta.1] — Real username+password login, replacing the password-only stub

The earlier login gate (a single shared `ADMIN_PASSWORD` env var, no username,
no real account) was wrong — a parallel, disconnected auth hack instead of
matching how the rest of the system already works (and how 1.9.44 always had
a real WordPress admin user). Rebuilt properly:

- **`AdminUser` model** (Prisma) — real accounts: `username` (unique),
  `passwordHash`. Migration `20260706144228_admin_users`.
- **Password hashing**: `src/lib/password.ts` — Node's built-in `scrypt`
  (salted, `timingSafeEqual` verify), no new dependency.
- **`src/services/auth.service.ts`**: `needsSetup()` (true iff zero accounts
  exist), `setup()` (one-time — refuses once any account exists, regardless
  of who calls it), `login()` (constant-shape failure on bad username OR bad
  password — doesn't reveal which). Mints the SAME JWT shape
  (`header.payload.sig`, HS256, `{sub,role,iat,exp}`) every other route
  already trusts via `@fastify/jwt` — one real auth system, not two.
- **Routes**: `GET /api/auth/status`, `POST /api/auth/setup`,
  `POST /api/auth/login` (all public — by definition there's no session yet;
  safety is `setup()`'s internal one-time refusal, not a route guard).
- **Admin**: `/login` now server-checks `/api/auth/status` and renders a
  **setup form** (username + password + confirm) when no account exists yet,
  or a real **username+password login form** otherwise — matching 1.9.44's
  actual UX (login → dashboard), not a bare password field.
  `admin/lib/session.ts` rewritten to verify the REAL JWT (Web Crypto HMAC
  over the standard 3-segment structure) instead of a custom 2-segment
  format; `ADMIN_PASSWORD`/`ADMIN_SESSION_SECRET` retired (JWT_SECRET, already
  shared with the backend, is the only secret needed now).
- Test coverage: backend +6 (29 total), admin session tests rewritten for the
  real JWT (5 total) — **39/39 across all three apps.**
- **Verified against the real dev DB without consuming the real setup**:
  confirmed `needsSetup: true` (zero accounts exist), confirmed `/login`
  correctly server-renders the setup form for that real state — but did NOT
  submit it. That's the one deliberate step left for a human to do with
  credentials they actually choose, not a test fixture.

## [2.0.0-beta.1] — 2.0 now lives at localhost:10004 (the Local site), replacing 1.9.44

Direction: one URL, not three ports — the Local "Therum OS" site (`localhost:10004`)
now fronts 2.0 entirely, replacing the WordPress/Bricks install that used to
run there.

- **Backed up first** (as instructed): `_backup-1.9.44-<timestamp>/` at the
  Therum OS root — full `mysqldump` of the `local` DB (via the site's actual
  MySQL socket, since root@127.0.0.1 TCP is disabled by default and
  `local-site.json`'s cached port numbers are stale/wrong — found the real
  live ports via `lsof`), a full copy of `app/` (the WP files), and a copy of
  the old `conf/` templates + `local-site.json`, all before touching anything.
- **Rewrote `conf/nginx/site.conf.hbs`** (Local's own officially-editable
  per-site nginx template — regenerated from this file on every site
  start/restart, so the change persists). Removed all WordPress/PHP-FPM
  config (upstream php, wordpress-single/multi includes, the 404→index.php
  rewrite, and the legacy asset-cache regex locations — the last of these
  would otherwise have silently intercepted requests before they ever reached
  the new proxy blocks, since nginx checks regex locations before falling
  back to prefix matches). Replaced with three reverse-proxy locations, all
  to local Node processes on the same machine:
  - `/` → the Next.js admin (`:3100`) — the app itself, proxied at the root so
    no basePath config is needed.
  - `/builder/` → the Vite builder (`:5174`) — a subpath, so
    `builder/vite.config.ts` now sets `base: '/builder/'` to match (confirmed
    live: the served HTML now references `/builder/@vite/client` etc.).
  - `/api/` → the Fastify backend (`:4100`).
  - Syntax-validated the rendered config against Local's own bundled nginx
    1.26.1 binary (`nginx -t` → "test is successful") before asking for a
    restart — did not just assume it was correct.
- Updated `NEXT_PUBLIC_BUILDER_URL` (admin) to `http://localhost:10004/builder`
  and `CORS_ORIGINS` (backend) to include `http://localhost:10004`.
- All three services restarted with the new config; 32/32 tests still pass.
- **The only step I can't do myself:** Local only regenerates its live nginx
  process from the `.hbs` template on the site's own start/restart — I
  shouldn't reach in and signal Local's internally-managed nginx/mysqld
  processes directly, that's Local's job. Restarting the "Therum OS" site
  from the Local app applies it.

## [2.0.0-beta.1] — Bricks restructured as a builder extension

Bricks compatibility was hardcoded directly into the core `Toolbar.tsx`
component (inline `bricksOn` state, direct adapter imports, hand-rolled
import/export buttons woven into core JSX). Restructured to match how the
ecosystem plugins (Counter/Nexus/Cluster/Milieus) already work — self-contained
and pluggable, not woven into core files:

- New `builder/src/extensions/` — a `BuilderExtension` interface
  (`{id, foundationId, label, ToolbarExtra?}`), an `EXTENSIONS` registry, and
  `useEnabledExtensions()` (resolves against `/api/foundations`, the same
  source of truth Studio uses — no new/duplicate toggle introduced).
- Bricks is now one self-contained module: `extensions/bricks/{adapter.ts
  (moved, unchanged logic), ToolbarExtra.tsx (extracted buttons+handlers),
  index.ts (the manifest)}`.
- `Toolbar.tsx` no longer imports anything Bricks-specific — it renders
  `useEnabledExtensions().map(ext => ext.ToolbarExtra)` generically. Adding a
  second extension later (e.g. once the WordPress foundation lands) means
  writing one new module; zero core changes.
- Verified: builder typecheck clean, build clean, all 5 Bricks tests still
  pass (moved test import to the new path, no logic touched), backend 23/23
  unaffected (this was a builder-only change).

## [2.0.0-beta.1] — "Solid base" hardening pass

Focus: make the Pure + Unlocked base actually solid — not new capabilities
(Nexus/Cluster/Milieus native engines and the WordPress-plugin ecosystem are
explicitly out of scope for this pass; see "Known gaps" below).

### Fixed (real bugs, not cosmetic)
- **Capability enable/disable was cosmetic only.** Disabling e.g. "Commerce" in
  Studio never actually gated `/api/products` or `/api/orders` — the toggle
  only changed what Studio displayed. Added `requireCapability()` middleware
  (`src/middleware/capability.ts`), applied as a plugin-scoped `preHandler` to
  products/orders/customers (→ `commerce`) and content/media (→ `content`)
  routes. Disabling a capability now genuinely 403s its entire API surface
  (`{error:{code:'capability_disabled', ...}}`), public or authenticated
  routes alike. Test-covered (`test/studio.test.mjs`).
- **Fresh-install capability defaults were wrong.** Every capability defaulted
  to "disabled" — including Commerce and Content, whose native providers
  (Counter, Folio) are already built and genuinely running. A brand-new Pure
  install would have shown its own working engine as "off." Now: a capability
  whose native provider is `stable` defaults ON; one whose native provider is
  still `planned` (Connections/Merged Products/Memberships) defaults OFF.
  Test-covered.
- **MediaAsset was schema-only.** A Prisma model existed with zero service,
  routes, or admin UI — despite Content's own description promising "media."
  Built the full slice and gated it under the `content` capability.

### Added
- **Real admin login gate.** Previously the Next.js admin app self-minted an
  admin JWT on *every* request with no credential check at all — anyone who
  could reach the admin server was automatically treated as admin.
  - `admin/middleware.ts` now gates every route behind a signed session
    cookie; unauthenticated requests 307-redirect to `/login` (verified live
    via curl: `/` → `307` → `/login?from=%2F`, `/products` → `307` →
    `/login?from=%2Fproducts`, `/login` itself → `200`, no redirect loop).
  - `/login` checks the submitted password against `ADMIN_PASSWORD`
    (env-configured — single shared operator credential; there is no user
    table, see "Known gaps").
  - Session tokens are HMAC-signed via Web Crypto (`admin/lib/session.ts`) —
    one implementation that works unmodified in both the Edge middleware
    runtime and the Node server-action runtime. 12h TTL. Password comparison
    uses a digest-based constant-time compare (`safeEqual`), not a naive `===`.
  - Test-covered (`admin/test/session.test.mjs`, 4 tests): valid token
    accepted, tampered/malformed/absent token rejected, an
    expired-but-validly-signed token rejected, `safeEqual` correctness.
- **MediaAsset slice**: `src/schemas/media.schema.ts`,
  `src/services/media.service.ts`, `src/api/routes/media.ts`,
  `admin/app/(app)/media/page.tsx`. URL-referenced assets only for now — a
  binary upload pipeline (local disk / S3) is a follow-up, explicitly out of
  scope here.
- **Bricks adapter test coverage** (`builder/test/bricks.test.mjs`, 5 tests) —
  `fromBricks`/`toBricks` had zero tests despite being load-bearing for the
  Unlocked "OS + Bricks" foundation: known-element mapping, unknown-element
  fallback (container-if-has-children / text-if-leaf, never dropped),
  flatten-back parent/children correctness, a full round-trip with an edit
  preserved, and unmapped-native-type safety.
- **Builder ↔ Folio authoring loop**: the admin Content page hands off to the
  builder (`?content=<id>&token=<jwt>`) to visually edit a canvas body and
  save it back; Folio's `GET /content/slug/:slug/render` serializes the canvas
  tree to HTML at publish time (test-proven: section → heading renders
  `<h1>`).
- `.claude/launch.json` for preview tooling (`api` → :4100, `admin` → :3100).
- This file, plus the decision to track via changelog + `PROGRESS.md` instead
  of git commits until the base is solid.

### Changed
- **CORS tightened.** Was `origin: true` (reflects any request origin — i.e.
  open to the world). Now an explicit allowlist via the `CORS_ORIGINS` env var
  (defaults to the admin/builder dev ports: `:3100`, `:5174`). **Must** be set
  explicitly in production.
- **Admin restructured into a route group** (`admin/app/(app)/`) so the
  authenticated shell/sidebar layout doesn't wrap the public `/login` page.
  All relative imports in the moved pages were updated for the new depth.

### Test coverage
32 tests total, all passing, across all three apps:
- Backend: **23/23** (was 18 — +5 for capability enforcement, fresh-install
  defaults, and media CRUD).
- Builder: **5/5** (new test runner — Bricks adapter had none before).
- Admin: **4/4** (new test runner — nothing existed before; covers the
  session-token crypto).

### Known gaps — flagged, not silently skipped
- **No user table / multi-operator auth.** The login gate is a single shared
  password. Correct for a single-operator internal admin; if Pure/Unlocked
  ever needs multiple named operators or an audit trail of *who* acted, this
  needs a real `User` model + per-user credentials.
- **No rate limiting** anywhere (API or `/login`). A brute-force attempt isn't
  throttled. Acceptable while this stays internal/non-public; add before any
  public exposure.
- **Media is URL-only** — no binary upload/storage pipeline yet.
- **Nexus / Cluster / Milieus native engines** — still `planned`. Out of scope
  for this pass per direction.
- **Ecosystem / WordPress-plugin ports** (Counter-wp, Nexus, Cluster, Milieus)
  — untouched. Provisions captured in `INTEGRATION-PROVISIONS.md` (Therum OS
  root) for whenever they're built.
- Login flow's redirect behavior was verified live via curl (real HTTP, not a
  Server Action). The actual login **form submission** (a Next.js Server
  Action) was not click-verified through a browser this pass — no Chrome
  browser was selected for the session. The session-token crypto it relies on
  is unit-tested; the standard `<form action={fn}>` mechanism itself is
  framework-provided, not custom protocol.

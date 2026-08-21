# Preview Gap Report — 1.x Design Previews vs 2.0 Admin (2026-07-24)

Source review of previews/connections-and-dashboard.html (3,086 ln),
previews/therum-os-experience.html (12,863 ln), dist/admin-preview.html
(byte-identical to #1), previews/captures/. Bam's own annotation prose
transcribed at bottom — treat as written specs.

## FEATURE GAPS (by impact)
1. **Connections-powered dashboard surfaces** — NO — L. Each connected provider
   adds a dashboard card: sticky Connections-status card (health rows, "4
   connected · 1 needs attention"), Stripe balance card w/ payout+trend, Notion
   recent pages, Mailchimp audiences, AI chat card. Spec: "the dashboard becomes
   the operations center for everything you've wired up."
2. **AI chat surface** (dashboard card + full-page, same component) — NO — L.
   Markdown bubbles, model switcher, "Save as snippet" (per-user library),
   "Insert into post" (drops into open editor).
3. **Theme store / presets / saved themes** — PARTIAL — L. Active-theme hero,
   store w/ filters, 60 preset cards (Mecha 18, Foundations 10, Familiar 10,
   Experimental 10, Surfaces 6, Glass Spatial 4, Therum 2), saved-themes grid w/
   token chips + export/import JSON. 2.0 has QuickControlsPanel + appearance
   subset only.
4. **NeoRename pattern engine** — PARTIAL — M. Media bulk rename: 4 modes
   (Pattern w/ tokens {name}{date}{seq}{ext}{type}{year} + seq start/pad,
   prefix, suffix, find&replace), LIVE PREVIEW table. 2.0: hand-typed list only.
5. **Vault/Webhooks/Audit management depth** — PARTIAL — M. 4-stat rows, filter
   pills, search; vault rotate/revoke/expiry lifecycle; webhook Inspect+Replay
   (replay any 4xx), success-rate/latency stats, CSV export; audit time-range +
   denied rows.
6. **Dashboard-layout defaults + per-role overrides** — NO — M. Default bento
   for new users, welcome templating {first_name}, per-role layout table.
7. **Branding + Site Identity settings** — NO — M. Admin display name, logos
   (admin/favicon/login fallback chain), custom admin CSS/JS; site title,
   tagline, timezone, language.
8. **Commerce back-office breadth** — PARTIAL — L. Customers, categories admin,
   coupons UI, analytics/reports surfaces (Counter has APIs; no admin pages).
9. **Editor preferences depth** — PARTIAL — S/M. Per-type default editor,
   autosave slider, EDITABLE keyboard-shortcuts panel.
10. **Login customization depth** — PARTIAL — S. Live login-card preview,
    video-loop bg, 2FA/SSO/Face ID surfaces.
11. **Connection PDP + CMS/Ecommerce buckets** — PARTIAL — M. Dedicated
    provider detail page (usage stats, scopes); Connect-CMS bucket
    (WordPress/Drupal/Ghost/Webflow/Contentful adapters).
12. **Updates local-channel UI** — PARTIAL — M. release-manifest.json reader,
    SHA-256 verified badge, bundle rows w/ re-apply.
13. **Extensions/Plugins PDP** — PARTIAL — M. Detail page w/ banner, status,
    update tag, screenshots.
14. **Pure native builder + Canvas (Templates/Parts/Patterns)** — NO — L.
    Block editor w/ scope toggle + "Create a block" AI modal. (Overlaps
    FUTURE-BUILDOUT native builder — architecture decision.)
15. **Menus/Widgets/Customizer/Themes surfaces** — NO — S each. Menus = only
    one with no 2.0 home at all (site nav is auto-built today).
16. **Plugin Compatibility settings section** — NO — S (maybe N/A native).

## VISUAL POLISH GAPS
V1. List-page toolbar suite: meta dot line ("9 files · 11.8 MB"), pill counts,
    sort menu w/ checkmarks, style menu (7 layouts × 5 image sources),
    grid-size slider 120–280px. M.
V2. Reusable 4-up stat strip (cx-stat: label/big number/colored delta). S.
V3. Status pills color-graded by class (2xx/3xx/4xx/5xx + action verbs). S.
V4. Inner settings rail w/ colored dots + counts ("AI Tools 2/4"). S.
V5. Page-header status strip ("4 connected · 1 action needed · 18 total"). S.
V6. Media card kebab (Edit/View/Copy URL/Delete). S.
V7. Sidebar chrome: version/engine badge, Updates `new` badge, purge-cache +
    date meta in topbar. S.
V8. Theme-card mini-preview idiom (rides gap 3). S.
V9. Masked-credential mono typography (sk-ant-•••a9F2, red when expired). S.

## VERBATIM SPECS (Bam's own prose, from the previews)
- (01 sub, ln546) "One canonical surface for everything external — AI tools,
  APIs, payment gateways, and external apps. Each card connects via the
  provider's own OAuth flow or API-key pattern; once linked, Therum embeds the
  relevant account data or full account dashboard inside the chrome."
- (ln1215) "Cards behavior: click any card → opens a slide-over panel with the
  connection form … Once connected, the same panel becomes the management
  surface for that provider — keys, scopes, account details, usage stats. The
  '+ Add custom' button in every section opens a blank-card form … The inner
  settings sidebar … jumps you between sub-sections — click any item to
  scroll-to + highlight." [IMPLEMENTED 2026-07-24 except usage stats + inner rail]
- (ln1501) "One surface for visual customization — active theme, theme store,
  saved looks, and a sticky right-rail with the design-system controls …
  Every change live-previews against the chrome behind the panel."
- (ln2776) "the right-rail panel is sticky — changes apply to the active theme
  in real time. Click a theme in the store to switch instantly (no save
  needed). Click + Save current as theme to lock the current combo as a custom
  saved theme … Each saved theme can be exported to JSON."
- (ln2788) "Each connected provider adds a dashboard surface — a status row in
  the Connections card, a live chat box for connected AI tools, a balance card
  for payment gateways, a data view for productivity apps. The dashboard
  becomes the operations center for everything you've wired up."
- (ln3001) "the Connections status card is sticky (always shown when any
  connector is active). AI chat box is full-width by default but can collapse
  to a quarter card via the bento resize handles … All cards inherit the
  existing bento sizing system (xs/sm/md/lg/sm-square/md-tall/lg-tall/xl-hero)."
- (ln3081) "the dashboard chat card and the full-page chat share the exact same
  component — only the container size + max-height changes. Messages support
  markdown … 'Save as snippet' stores the response in a per-user library;
  'Insert into post' drops the message into the currently-open editor."
- (experience ln~2180) "AI providers, API tokens, payment gateways, and
  external apps register through one extensible API. Four typed buckets, one
  shared Vault, one audit log. No plugin marketplace required."

## Notes
- checkout-experience.html already fully ported (method strip, C4.1).
- captures/studio-apps.json: 1.x "Milieus" = environment/audience targeting;
  2.0 Milieus = member groups. Same name, different concept — mind when reading.
- Gaps 14–16 describe WP-era surfaces; flag-not-prescribe.

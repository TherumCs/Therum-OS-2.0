# Dashboard Redesign — Spec

Status: **approved direction, ready to build.** Mockup: the "Therum Dashboard"
artifact (detailed/interactive version). This document is the source of truth
for the implementation.

---

## 1. Principles

1. **Functional over decorative.** Every pixel earns its place with data or a
   control. Gradient/color tiles are used *only* for the one hero metric a card
   is about — never as wallpaper. The rest of a card is clean surface, dense
   real data, and controls.
2. **Interactive and drillable.** Hover charts with tooltips, in-card sub-tabs,
   expandable rows, range toggles, clickable health checks, drill links to the
   full page. A card is something you *operate*, not just read.
3. **Merged on Overview, exploded on detail tabs.** Overview shows one merged
   card per domain (a consolidated glance). Each domain tab is that same
   domain's full detail view with the pieces broken into separate cards.
4. **Every screen is customizable** — add widgets from a shared palette, remove
   them, resize and rearrange them, per user (see §4). The fixed tabs ship with
   good defaults; you can bend any of them.
5. **Theme-aware** (light/dark via the admin's `data-color-mode`). **The
   sidebar is not touched** — this is a dashboard-content redesign only.
6. **Real data everywhere.** No lorem. Numbers come from the live endpoints
   (§6). Anything not yet measurable (source attribution before traffic) is
   labeled as such.

## 2. Visual language (the "less decorative" rule)

- **One hero tile per card, max.** The single headline number (revenue, orders,
  customers, uptime) may sit on a soft gradient tile. Everything else is a plain
  card surface (`--th-card-bg`), hairline borders (`--th-line`), and big tabular
  numbers.
- **Color is semantic, not ornamental.** Green = good, amber = watch, red =
  problem, blue = info. The **brand accent** is the single ornamental color —
  active sub-tab underline and primary CTA only.
- **Type:** heavy weights + tight negative tracking on numbers; `tabular-nums`
  everywhere digits align. Uppercase micro-labels for field names.
- Keep it calm: generous whitespace, hairline dividers, no drop-shadow soup.

## 3. Structure

Tabs (this is the whole switcher — sidebar stays as-is):

```
[ Overview ] [ Counter ] [ Content ] [ Growth ]   … [ + ]
```

- **Overview** — merged domain cards ONLY (one card per domain).
- **Counter / Content / Growth** — detail views; the domain's cards broken out
  separately, each independently resizable.
- **`+`** — add a custom dashboard (§7).

**Correspondence (Overview merged card ⇄ its detail tab):**

| Overview merged card | Detail tab |
|---|---|
| Commerce | **Counter** |
| Audience / sources | **Growth** |
| Website / pages | **Content** |
| Live activity | cross-cutting (appears on Overview) |

## 4. Widget system — add, remove, resize, rearrange (on ANY screen)

Every dashboard — the fixed ones (Overview / Counter / Content / Growth) **and**
custom ones — is a grid of **widgets** you can add, remove, resize and reorder.
This is the pre-redesign resize/rearrange capability, generalized into a full
widget system.

- 12-column bento grid. Each widget has a **size** (column span: xs/sm/md/lg →
  3/6/9/12) and an **order**.
- **Edit-layout toggle** reveals the affordances (so the normal read view stays
  clean): each widget gets a drag-resize handle (bottom-right) + move up/down +
  a **remove (×)**, and the screen shows an **"+ Add widget"** button.
- **"+ Add widget" opens the widget palette** — the shared registry of every
  widget in §5 (Revenue chart, Order status, Payments mix, Fulfillment, Website
  health, Audience, Live activity, Sources, Funnel, Issues, AI insights, Content
  stats, …). Pick one, it drops onto the grid. Add the same widget to *any*
  screen — put the revenue chart on Growth, the AI card on Overview, whatever.
- **Persist per admin user, per tab** (`{ overview: [...], counter: [...], … }`).
  Reuse `CardResizeHandle` + the Route Handlers under
  `admin/app/api/dashboard-layout/*` (`move`, `resize`, `preset`, `reset`) and
  extend them with `add` / `remove`, keyed by tab.
- Fixed tabs ship with sensible **default** widget sets (the ones in §5.1–5.4);
  custom tabs start empty and you build them from the palette. **"Reset"** on any
  tab restores its defaults.

### Widget registry

Each card in §5 is registered as a reusable widget with: an id, a display name,
a default size, and its data dependency (from §6). The palette lists them all;
the same widget id can appear on multiple screens. This is what makes "add more
widgets to any screen" work with one implementation.

## 5. Cards, in detail

### 5.1 Overview (merged)

**Commerce** (the flagship merged card)
- Header: title + range segment **7d / 30d / 90d / All** (redraws the chart).
- In-card sub-tabs: **Revenue · Orders · Products · Carts**.
  - *Revenue:* hero number + delta, **interactive area chart** (hover →
    crosshair + tooltip with the value at that point), 4-up stat grid
    (orders, AOV, abandoned, refunds).
  - *Orders:* status donut + status bars + recent orders (**click a row to
    expand** its line items).
  - *Products:* top sellers (bars) + stock stats (active, variants, out/low).
  - *Carts:* abandoned list with idle time + recoverable value.

**Website status**
- Uptime %; health checks list (API+DB, payments, SSL expiry, nightly backup,
  fulfillment queue) each with a status dot + one-line detail + a value, **click
  to expand**; content counts (pages, posts, media, last deploy).

**Audience**
- Customers + new-this-week; repeat rate; top order sources (bars). Drill link →
  Customers page.

**Live activity**
- Real-time event feed (order placed, cart abandoned, signup, order delivered,
  catalog sync) with relative timestamps and a colored rail.

### 5.2 Counter (Commerce detail — separate cards)

- **Revenue & orders** card — big chart + range + 4-up stats.
- **Payments** card — method mix bars (card/wallet/BNPL) + connected gateways.
- **Fulfillment** card — Printful / Printify / Tapstitch with status + SKU counts
  (surface the real issues: Printful card expired, Tapstitch unconnected).
- **Catalog & connectors** card — products, variants, connectors, feed items.

### 5.3 Content (separate cards)

- **Pages & journal** card — sub-tabs All / Pages / Journal; rows expand to
  path + view link; "+ New" action.
- **Content at a glance** card — pages, journal, published/draft, media, case
  studies.

### 5.4 Growth (separate cards)

- **Where orders come from** card — sub-tabs Sources / Funnel; sources bars +
  session/conversion stats; visit→cart→order funnel.
- **Issues to watch** card — pending orders, POD provider problems, nudge health.
- **Studio AI insights** card — the assistant surfaces suggestions ("Instagram
  converts better — push the drop"), watch items, and ask-chips.

## 6. Data sources

| Card / metric | Endpoint |
|---|---|
| Revenue, orders-by-status, abandoned carts, sources, launch list, attempted | `GET /api/counter/activity` |
| Recent orders + line items | `GET /api/orders?limit=…` |
| Products / variants / stock | `GET /api/products` |
| Customers, repeat rate | `GET /api/customers` |
| Pages / posts / media | `GET /api/content` |
| Health checks | `GET /api/system/health` |
| Saved layout | `GET /api/me` (`dashboardLayout`) + `api/dashboard-layout/*` |
| Studio AI | existing `StudioAgentCard` |

**New endpoint needed:** a lightweight **activity feed** (`GET /api/counter/feed`
or similar) that returns recent cross-domain events (order, cart, signup, sync,
review) for the Live-activity card. Until built, derive from recent orders +
signups.

## 7. Custom dashboards (`+`)

- `+` creates a named dashboard that starts **empty**. You build it from the same
  **widget palette** (§4) used on every other screen — no separate mechanism.
- Rename / delete the custom dashboard from its own tab.
- Persistence: v1 localStorage (works now); v2 move to the user's server-side
  layout so it follows them across devices (same store as the fixed-tab layouts).

## 8. Implementation notes

- `page.tsx` (server component) fetches all data in one `Promise.all`, derives a
  typed `DashData`, and renders `<DashboardTabs data={…} studioAgent={…} />`.
- `DashboardTabs.tsx` (client) owns tab state, in-card sub-tab state, the
  interactive chart, expandable rows, range toggles, and the edit-layout mode.
- Re-add resize/reorder via the existing `CardResizeHandle` + dashboard-layout
  Route Handlers, generalized to per-tab layouts.
- Charts are hand-authored inline SVG (no external chart lib) with a shared
  hover-tooltip helper.

## 9. Open questions for Bam

1. **Live activity feed** — real-time (poll every ~15s / SSE) or just
   "last 24h" on load? (Poll is cheap and looks live.)
2. **Custom dashboards** — fine to start local (this browser) and move
   server-side later, or server-side from day one?
3. **Section correspondence** — confirm Commerce→Counter, Audience→Growth,
   Website/pages→Content is the split you want.

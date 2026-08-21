# Milieus — 2.0 native engine (From the Studio)

Approved 2026-07-21. Source of truth for semantics: the real 1.x WP plugin at
`Therum OS/wordpress plugins/milieus/` (read in full: roles-engine.php, expiry.php,
members.php, wc-pricing.php, README.md). This is a port of *semantics* into the 2.0
architecture, not a literal code port — 1.x groups are WP roles; 2.0 members are Customers.

## Decisions (user-confirmed)
- Members = **Customers** (not admin users, not a standalone model).
- All 1.x features in scope, **milestoned**: M1 groups+member lists → M2 discounts →
  M3 expiry → M4 registration links.
- Discounts: **percent, largest single wins, no stacking/mixing** (matches 1.x
  wc-pricing.php exactly: max pct off subtotal, labeled with group name).

## Data model
```prisma
enum MembershipSource { manual link csv api }

model Milieu {
  id                 String   @id @default(cuid())
  name               String
  slug               String   @unique
  color              String   @default("#2563eb")
  discountPct        Float    @default(0)      // 0 = off; max-single-wins at checkout
  expiresAt          DateTime?                 // group lifetime; null = forever (1.x expires_at=0)
  memberDurationDays Int      @default(0)      // default member duration; 0 = permanent
  createdAt/updatedAt
  memberships        MilieuMembership[]
}

model MilieuMembership {
  id             String    @id @default(cuid())
  milieuId       String
  customerId     String
  assignedAt     DateTime  @default(now())
  expiresAt      DateTime?                     // null = permanent
  source         MembershipSource @default(manual)
  reminderSentAt DateTime?                     // 1.x once-only expiring-soon flag
  @@unique([milieuId, customerId])
}
```
Deliberate simplification: 1.x member_duration {value, unit days/weeks/months/years}
→ days-only int. UI presets 14/30/90/365. Loses calendar-month math.

## 1.x semantics carried verbatim
- assign idempotent: re-add resets assignedAt + recomputes expiresAt from group default.
- revoke deletes the membership row + its meta (here: the row is the meta).
- extend: permanent → no-op; else `max(current, now) + seconds`.
- bulk: revoke / extend-30d / reset-expiry-to-group-default.
- sweep, two independent timelines: expired group → revoke all members + delete group;
  expired membership → delete membership. Idempotent.
- expiring-soon reminders: fire once per (member, group), stamped via reminderSentAt.
- member row shows joined date / expiry tier (permanent|ok|soon|urgent|expired,
  thresholds 30d/7d) / source.

## Not ported, why
- Capability bundles / WP caps — WP-role machinery; Customers have no login/portal yet.
- Shortcodes, Gutenberg blocks, updates page — WP-only surfaces.
- Notifications, outbound webhooks, audit log, dashboard widget — 2.0 has its own
  notification/webhook/audit infra; hook Milieus events into those as follow-ups.
- WC auto-group-on-purchase + Subscriptions — Counter-side bridge (1.x MilieusBridge.php
  lives in Counter, not Milieus); own milestone after M4.
- CSV import/export — follow-up after M1, not v1.

## Backend
- `src/schemas/milieu.schema.ts` — zod: create/update (name 1..80, slug pattern
  `[a-z0-9-]`, discountPct 0..100, memberDurationDays >= 0), member add (customerId or
  email), extend (seconds > 0), bulk (action enum + customerIds).
- `src/services/milieu.service.ts` — CRUD (slug conflict 409), assign/revoke/extend/
  bulkAction/listMembers (paginated 25, search Customer name/email)/runSweep/
  discountFor(customerId) → { pct, milieuName } | null.
- `src/api/routes/milieus.ts` — CRUD + members subroutes + POST /sweep. All admin-JWT
  + `requireCapability('memberships')`.
- capability.service.ts: milieus native `planned` → `stable` (auto-defaults capability
  ON per existing defaultEnabled()).
- Studio Apps registry: add `milieus` entry (Nexus pattern) → nav + admin page.

## Milestones
- **M1 (now):** models+migration, service, routes, studio-app entry, admin page
  (groups table: color/name/members/discount/expiry; editor; members panel: typeahead
  add, list w/ tiers, bulk actions), tests.
- **M2:** discountFor() into order.service create path, labeled discount on order.
- **M3:** sweep as BullMQ repeatable job on existing worker + reminder hooks.
- **M4:** public registration links (tokenized signup → Customer + membership,
  approval gate, max signups, per-IP rate limit).

## Tests (M1)
assign idempotency · extend semantics (permanent no-op, past-expiry restarts from now)
· sweep both timelines · discount max-wins · slug conflict 409 · capability gate 403.

## Addendum — post-audit declared divergences from 1.x (2026-07-21)
A full security + fidelity audit ran after M1-M4 shipped. Fixes landed for every
confirmed defect (see CHANGELOG "Milieus audit remediation"). The following
1.x-vs-2.0 behavior differences are DELIBERATE and now declared:
- **Honeypot** returns a silent fake success shaped like the real response for that
  link type. 1.x shows a visible error; a silent lie leaks less to the bot.
- **Re-registration of an existing member is a no-op** (reports current status,
  changes nothing, burns no signup slot). 1.x hard-errors on an existing email;
  2.0's no-op avoids the enumeration oracle a distinct error would create while
  still preventing the renewal-abuse the audit found in the first implementation.
- **Benefits end at expiry in real time** — expired memberships/milieus grant no
  discount and expired-group links 404 immediately. 1.x keeps benefits until the
  next daily cron sweep (up to ~24h of grace). Improvement, kept.
- **Expiring-soon reminders re-arm on renewal** (extend/reset/re-assign clear the
  sent flag → one reminder per expiry cycle). 1.x fires literally once ever per
  (user, group) — arguably a bug, not ported.
- **Member list ordered by joined-the-group date** (assignedAt) not account
  registration date. More useful; cosmetic.
- **Admin assign() of a pending customer approves them implicitly** — an operator
  explicitly adding someone IS the approval.
- Sweep emits `onMembershipRevoked` per removal (1.x parity — its sweep fires
  milieus_member_revoked) so notification/webhook/audit follow-ups have a seam.

Follow-ups queued, not built: cross-group Approvals inbox with bulk approve/reject
(1.x approvals.php), group Duplicate action (1.x members.php), CSV import/export,
event wiring into 2.0 notifications/webhooks/audit, Counter auto-group bridge.

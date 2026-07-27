# Cluster — 2.0 native engine (From the Studio)

2026-07-22. Source of truth: the real 1.x plugin at `Therum OS/wordpress plugins/cluster/`
(group-engine.php read in full — 741 lines, dual Counter-SQLite/WC-postmeta backends with one
public API; cart-routing.php; frontend-product.php; GroupEngineTest.php = the semantic spec).
Port of semantics into 2.0's own model, not literal code.

## What Cluster is (1.x semantics, carried)
Symmetric product groups. A group is a flat set of products; the PRIMARY member is the
customer-facing one. Its page shows the UNION of every member's variant combos; picking a
combo routes the purchase to the member that owns it. Primary = explicit override if set
and still a member, else lowest-ID member. Groups under 2 members auto-dissolve. Editing a
group GCs members no longer listed; adding a product already in another group steals it
(donor dissolves if left with 1). Drift detection: per-member variant-dimension sets
compared against the group union (missing/extra). Merged variants: one entry per
attribute combo, first member wins ties unless out of stock and a later member has stock.

## 2.0 data model
```prisma
model ClusterGroup {
  id               String  @id @default(cuid())
  name             String
  // Explicit primary override (1.x mirrors this to every member's row; 2.0
  // stores it once on the group — same semantics, single source of truth).
  primaryProductId String?
  createdAt/updatedAt
  members ClusterMembership[]
}
model ClusterMembership {
  groupId   String
  productId String @unique   // 1.x invariant: a product is in at most one group
  addedAt   DateTime
  // both FKs cascade
}
```
No copy of variants. Merged view is resolved at READ time from live member variants —
exactly 1.x's approach; no sync drift possible, checkout uses REAL source variants so
order lines route to the right product/vendor by construction (variantId →
sourceVendorId already in the schema).

## Declared divergences from 1.x
- Primary fallback = earliest-created member (createdAt, then id) — 2.0 cuids have no
  numeric "lowest ID" order.
- setPrimary with a non-member 422s (1.x silently ignores).
- No request-level memo cache / cluster_group_changed flush event — 2.0 service is
  stateless per-request queries.
- Drift compares the two fixed variant dimensions (color/size: used vs unused, plus
  value-set unions per dimension) — 2.0 has fixed columns, not arbitrary WP taxonomies.
- Anti-tamper cart validation not needed: 2.0 checkout posts real variant ids, there is
  no form rewriting to validate. Resolution endpoint is read-only.
- 1.x admin order-column "Group source" display: order lines already know their source
  via variant → product → vendor; a dedicated admin column is a follow-up, not core.

## Backend (single milestone — build fully)
- `cluster.schema.ts` zod: CreateGroup {name 1..80, productIds min 2}, UpdateGroup
  {name?, productIds?}, SetPrimary {productId nullable}.
- `cluster.service.ts`: list (memberCount+drift flag), get (members w/ product+vendor),
  create/update via one `applyMembers` core implementing full 1.x set-group semantics
  (steal, GC, dissolve <2, override validate-or-clear), remove (delete group only —
  products untouched), setPrimary, resolveMerged (combo = normalized color|size; tie:
  first-by-member-order unless out-of-stock and later member in stock), detectDrift,
  candidates typeahead (products in no group).
- Routes `/api/clusters`: authenticate + requireCapability('merged-products') on all;
  requireBundle('storefront-manager') on every mutation (audit convention). Reads open.
- capability catalog: cluster native planned → stable.
- Studio Apps registry entry → nav 'Cluster' → `/clusters`.

## Admin
`/clusters` page + proxies: groups table (name, members, primary, drift badge), create/
edit form (name + product typeahead min-2, remove chips, primary picker), per-group
detail: merged-variant preview table (combo, price, stock, source product/vendor) +
drift findings. Audit lessons baked in: keyed panels, debounced+sequenced fetches,
error-banner-not-empty-state, integer coercion, snapshot-safe tests.

## Tests (ported 1.x cases + 2.0 additions)
ungrouped defaults · symmetric membership write · empty-list dissolve · shrink GCs
orphans · cross-group steal dissolves 1-member donor · primary default earliest ·
explicit override wins · clearing reverts · override auto-cleared when member removed ·
resolveMerged union + in-stock-wins-tie · drift missing/extra · create with <2 products
422 · capability 403 · bundle 403 · teardown closeQueues, zero rows left behind.

import { db } from '../lib/db.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';
import type { CreateClusterInput, UpdateClusterInput } from '../schemas/cluster.schema.js';

// Cluster — symmetric product groups, ported from the 1.x group-engine
// (docs/superpowers/specs/2026-07-22-cluster-native-design.md):
//   - a product belongs to at most one group (schema-enforced unique)
//   - adding a product already grouped elsewhere STEALS it; a donor group
//     left with <2 members dissolves
//   - editing a group's member list GCs members no longer listed; the group
//     itself dissolves if it ends up with <2
//   - primary = explicit override if still a member, else earliest-created
//     member (2.0 analog of 1.x's lowest-ID rule); an override whose product
//     leaves the group is cleared, not left dangling
//   - the merged variant view is resolved at READ time from live member
//     variants: one entry per (color,size) combo, first member in primary-
//     first order wins unless out of stock and a later member has stock
//     (1.x cluster_get_merged_variations rule)

const memberInclude = {
  product: {
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      vendor: { select: { id: true, name: true } },
      _count: { select: { variants: true } },
    },
  },
} as const;

function comboKey(color: string | null, size: string | null): string {
  return `${(color ?? '').trim().toLowerCase()}|${(size ?? '').trim().toLowerCase()}`;
}

// Primary-first, then the 1.x "lowest ID" analog: earliest product creation.
function orderMembers<T extends { productId: string; product: { id: string } }>(
  members: (T & { product: { createdAt?: Date } })[],
  primaryId: string,
): T[] {
  return [...members].sort((a, b) => {
    if (a.productId === primaryId) return -1;
    if (b.productId === primaryId) return 1;
    const ta = a.product.createdAt?.getTime() ?? 0;
    const tb = b.product.createdAt?.getTime() ?? 0;
    return ta !== tb ? ta - tb : a.productId.localeCompare(b.productId);
  });
}

// The one primary-resolution rule (1.x: explicit override if still a member,
// else the lowest-ID analog = earliest-created product, ties on id). Shared
// by resolvePrimaryId and list() so the rule can't drift between them
// (audit F4 — list() used to inline a copy).
function pickPrimary(members: { productId: string; product: { createdAt: Date } }[], override: string | null): string | null {
  if (override && members.some((m) => m.productId === override)) return override;
  const sorted = [...members].sort((a, b) => {
    const d = a.product.createdAt.getTime() - b.product.createdAt.getTime();
    return d !== 0 ? d : a.productId.localeCompare(b.productId);
  });
  return sorted[0]?.productId ?? null;
}

async function resolvePrimaryId(groupId: string): Promise<string> {
  const group = await db.clusterGroup.findUnique({
    where: { id: groupId },
    include: { members: { include: { product: { select: { id: true, createdAt: true } } } } },
  });
  if (!group) throw new NotFoundError('Cluster group not found', 'id');
  const primary = pickPrimary(group.members, group.primaryProductId);
  if (!primary) throw new ValidationError('Cluster group has no members', 'id');
  return primary;
}

// The 1.x set-group core: make `productIds` the exact member set of `groupId`,
// stealing from other groups as needed, GCing removals, dissolving any group
// (this one or a donor) that ends up under 2 members, and validating-or-
// clearing the primary override.
//
// ONE transaction, deliberately (audit finding F3): the steal step removes
// products from donor groups before they're added here — un-transactional,
// a crash between those two writes would strip products out of an existing
// group with nothing gained, and concurrent edits could interleave the
// delete/create steps into corrupted membership. Serializable isolation
// makes overlapping applyMembers calls conflict instead of interleave (the
// loser retries at the route layer as a plain error).
async function applyMembers(groupId: string, productIds: string[]): Promise<void> {
  const unique = [...new Set(productIds)];
  await db.$transaction(
    async (tx) => {
      const products = await tx.product.findMany({ where: { id: { in: unique } }, select: { id: true } });
      if (products.length !== unique.length) {
        const found = new Set(products.map((p) => p.id));
        const missing = unique.filter((id) => !found.has(id));
        throw new ValidationError(`Unknown product(s): ${missing.join(', ')}`, 'productIds');
      }

      // Steal: memberships of these products in OTHER groups.
      const existing = await tx.clusterMembership.findMany({ where: { productId: { in: unique } } });
      const donorGroupIds = new Set(existing.filter((m) => m.groupId !== groupId).map((m) => m.groupId));
      await tx.clusterMembership.deleteMany({ where: { productId: { in: unique }, groupId: { not: groupId } } });

      // GC: current members of this group not in the new set.
      await tx.clusterMembership.deleteMany({ where: { groupId, productId: { notIn: unique } } });

      // Add the missing ones.
      const current = new Set(
        (await tx.clusterMembership.findMany({ where: { groupId }, select: { productId: true } })).map((m) => m.productId),
      );
      const toAdd = unique.filter((id) => !current.has(id));
      if (toAdd.length > 0) {
        await tx.clusterMembership.createMany({ data: toAdd.map((productId) => ({ groupId, productId })) });
      }

      // Donor groups left under 2 members dissolve (1.x sibling-dissolution rule).
      for (const donorId of donorGroupIds) {
        const count = await tx.clusterMembership.count({ where: { groupId: donorId } });
        if (count < 2) await tx.clusterGroup.delete({ where: { id: donorId } });
      }

      // Validate-or-clear the primary override (1.x re-mirror-or-clear).
      const group = await tx.clusterGroup.findUnique({ where: { id: groupId }, select: { primaryProductId: true } });
      if (group?.primaryProductId && !unique.includes(group.primaryProductId)) {
        await tx.clusterGroup.update({ where: { id: groupId }, data: { primaryProductId: null } });
      }
    },
    { isolationLevel: 'Serializable' },
  );
}

export const clusterService = {
  async list() {
    const groups = await db.clusterGroup.findMany({
      orderBy: { createdAt: 'asc' },
      include: { members: { include: { product: { select: { id: true, name: true, createdAt: true } } } } },
    });
    const out = [];
    for (const g of groups) {
      const primaryId = pickPrimary(g.members, g.primaryProductId);
      const drift = await this.detectDrift(g.id);
      out.push({
        id: g.id,
        name: g.name,
        memberCount: g.members.length,
        primaryProductId: primaryId,
        primaryName: g.members.find((m) => m.productId === primaryId)?.product.name ?? null,
        hasDrift: drift.length > 0,
      });
    }
    return out;
  },

  async get(id: string) {
    const g = await db.clusterGroup.findUnique({
      where: { id },
      include: { members: { include: { ...memberInclude, product: { select: { ...memberInclude.product.select, createdAt: true } } } } },
    });
    if (!g) throw new NotFoundError('Cluster group not found', 'id');
    const primaryId = await resolvePrimaryId(id);
    return {
      id: g.id,
      name: g.name,
      primaryProductId: primaryId,
      primaryIsExplicit: g.primaryProductId !== null,
      members: orderMembers(g.members, primaryId).map((m) => ({
        productId: m.productId,
        name: m.product.name,
        slug: m.product.slug,
        status: m.product.status,
        vendor: m.product.vendor,
        variantCount: m.product._count.variants,
        isPrimary: m.productId === primaryId,
      })),
    };
  },

  async create(input: CreateClusterInput) {
    const group = await db.clusterGroup.create({ data: { name: input.name } });
    try {
      await applyMembers(group.id, input.productIds);
    } catch (err) {
      await db.clusterGroup.delete({ where: { id: group.id } }).catch(() => {});
      throw err;
    }
    return this.get(group.id);
  },

  async update(id: string, input: UpdateClusterInput) {
    const g = await db.clusterGroup.findUnique({ where: { id }, select: { id: true } });
    if (!g) throw new NotFoundError('Cluster group not found', 'id');
    if (input.name) await db.clusterGroup.update({ where: { id }, data: { name: input.name } });
    if (input.productIds) await applyMembers(id, input.productIds);
    return this.get(id);
  },

  async remove(id: string): Promise<void> {
    const g = await db.clusterGroup.findUnique({ where: { id }, select: { id: true } });
    if (!g) throw new NotFoundError('Cluster group not found', 'id');
    await db.clusterGroup.delete({ where: { id } }); // memberships cascade; products untouched
  },

  // 1.x cluster_set_explicit_primary — but a non-member 422s instead of being
  // silently ignored (declared divergence).
  async setPrimary(id: string, productId: string | null) {
    const g = await db.clusterGroup.findUnique({ where: { id }, include: { members: { select: { productId: true } } } });
    if (!g) throw new NotFoundError('Cluster group not found', 'id');
    if (productId !== null && !g.members.some((m) => m.productId === productId)) {
      throw new ValidationError('That product is not a member of this group', 'productId');
    }
    await db.clusterGroup.update({ where: { id }, data: { primaryProductId: productId } });
    return this.get(id);
  },

  // Merged variant table (1.x cluster_get_merged_variations): one entry per
  // combo; earlier member (primary-first order) wins the tie unless it's out
  // of stock and a later member has stock.
  async resolveMerged(id: string) {
    const g = await db.clusterGroup.findUnique({
      where: { id },
      include: {
        members: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                createdAt: true,
                vendor: { select: { id: true, name: true } },
                variants: {
                  select: { id: true, sku: true, price: true, color: true, size: true, inventory: true, reserved: true },
                },
              },
            },
          },
        },
      },
    });
    if (!g) throw new NotFoundError('Cluster group not found', 'id');
    const primaryId = await resolvePrimaryId(id);

    const byCombo = new Map<
      string,
      { variantId: string; sku: string | null; price: number; color: string | null; size: string | null; available: number; inStock: boolean; sourceProductId: string; sourceProductName: string; sourceVendor: { id: string; name: string } | null }
    >();
    for (const m of orderMembers(g.members, primaryId)) {
      for (const v of m.product.variants) {
        const key = comboKey(v.color, v.size);
        const available = v.inventory - v.reserved;
        const entry = {
          variantId: v.id,
          sku: v.sku,
          price: v.price,
          color: v.color,
          size: v.size,
          available,
          inStock: available > 0,
          sourceProductId: m.product.id,
          sourceProductName: m.product.name,
          sourceVendor: m.product.vendor,
        };
        const existing = byCombo.get(key);
        if (!existing) {
          byCombo.set(key, entry);
        } else if (!existing.inStock && entry.inStock) {
          byCombo.set(key, entry); // in-stock source wins the tie (1.x rule)
        }
      }
    }
    return { groupId: id, primaryProductId: primaryId, variants: [...byCombo.values()] };
  },

  // 1.x cluster_detect_drift, adapted to 2.0's two fixed dimensions: which of
  // color/size each member's variants actually use, compared to the union.
  async detectDrift(id: string) {
    const memberships = await db.clusterMembership.findMany({
      where: { groupId: id },
      include: { product: { select: { id: true, name: true, variants: { select: { color: true, size: true } } } } },
    });
    if (memberships.length < 2) return [];

    const dimsByMember = new Map<string, { name: string; dims: Set<string> }>();
    for (const m of memberships) {
      const dims = new Set<string>();
      for (const v of m.product.variants) {
        if (v.color !== null && v.color !== '') dims.add('color');
        if (v.size !== null && v.size !== '') dims.add('size');
      }
      if (dims.size > 0) dimsByMember.set(m.productId, { name: m.product.name, dims });
    }
    if (dimsByMember.size < 2) return [];

    const union = new Set<string>();
    for (const { dims } of dimsByMember.values()) for (const d of dims) union.add(d);

    const findings: { productId: string; productName: string; missing: string[]; extra: string[] }[] = [];
    for (const [pid, { name, dims }] of dimsByMember) {
      const missing = [...union].filter((d) => !dims.has(d));
      const othersUnion = new Set<string>();
      for (const [pid2, { dims: dims2 }] of dimsByMember) {
        if (pid2 === pid) continue;
        for (const d of dims2) othersUnion.add(d);
      }
      const extra = [...dims].filter((d) => !othersUnion.has(d));
      if (missing.length > 0 || extra.length > 0) {
        findings.push({ productId: pid, productName: name, missing, extra });
      }
    }
    return findings;
  },

  // Typeahead for the editor: products not currently in ANY group.
  async candidates(q: string) {
    if (q.length < 2) return [];
    return db.product.findMany({
      where: {
        clusterMembership: null,
        OR: [{ name: { contains: q, mode: 'insensitive' } }, { slug: { contains: q, mode: 'insensitive' } }],
      },
      select: { id: true, name: true, slug: true, vendor: { select: { name: true } } },
      take: 8,
    });
  },
};

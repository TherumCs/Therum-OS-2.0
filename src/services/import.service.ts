import { randomBytes } from 'node:crypto';
import { db } from '../lib/db.js';
import { hookBus } from '../lib/hooks.js';
import type { RunImportInput } from '../schemas/import.schema.js';

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200);
}

function toCents(v: string): number | null {
  const cleaned = String(v).replace(/[^0-9.\-]/g, '').trim();
  if (cleaned === '') return null; // empty must be invalid, not 0 (no free products)
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export interface ImportAudit {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  dryRun: boolean;
  errors: { index: number; reason: string }[];
}

// Importer discipline: partial imports are normal (log + skip + continue),
// re-running the same source is idempotent (vendorId + sourceId is the key),
// dry-run validates without persisting. Fires onImportStart/Row/End hooks.
export const importService = {
  async run(input: RunImportInput): Promise<ImportAudit> {
    const audit: ImportAudit = { total: input.rows.length, created: 0, updated: 0, skipped: 0, dryRun: input.dryRun, errors: [] };
    const m = input.mapping;
    await hookBus.run('onImportStart', { count: input.rows.length, dryRun: input.dryRun });

    for (let i = 0; i < input.rows.length; i++) {
      const row = input.rows[i] ?? {};
      const name = (row[m.name] ?? '').trim();
      const cents = toCents(row[m.price] ?? '');
      const sku = m.sku ? row[m.sku] : undefined;
      const sourceId = m.sourceId ? row[m.sourceId] : undefined;
      // Default 0 is deliberate for a hand-made CSV — better to under-sell
      // than to promise stock that is not there. A provider sync should map a
      // real column, and a POD sync a large one.
      const inventoryRaw = m.inventory ? Number(row[m.inventory]) : NaN;
      const inventory = Number.isFinite(inventoryRaw) && inventoryRaw >= 0 ? Math.floor(inventoryRaw) : 0;

      if (!name) {
        audit.skipped++;
        audit.errors.push({ index: i, reason: 'missing name' });
        continue;
      }
      if (cents === null || cents < 0) {
        audit.skipped++;
        audit.errors.push({ index: i, reason: 'invalid price' });
        continue;
      }

      await hookBus.run('onImportRow', { index: i, name, cents });

      if (input.dryRun) {
        audit.created++; // would-create
        continue;
      }

      try {
        if (input.vendorId && sourceId) {
          const existing = await db.product.findUnique({
            where: { vendor_source: { vendorId: input.vendorId, sourceId } },
            select: { id: true },
          });
          if (existing) {
            await db.product.update({ where: { id: existing.id }, data: { name } });
            audit.updated++;
          } else {
            await db.product.create({
              data: {
                name,
                slug: `${slugify(name)}-${sourceId.slice(0, 8)}`,
                status: 'active',
                vendorId: input.vendorId,
                sourceId,
                variants: { create: [{ price: cents, sku, sourceId, inventory }] },
              },
            });
            audit.created++;
          }
        } else if (sourceId) {
          // A source id with no vendor. The unique index is (vendorId,
          // sourceId), so this cannot use the upsert above — but it must still
          // be idempotent, because a store with ONE source (the common case:
          // a single provider sync) would otherwise duplicate its whole
          // catalog on every run. It previously fell through to the
          // create-always branch below, which also DISCARDED sourceId
          // entirely, so nothing even recorded where the product came from.
          const existing = await db.product.findFirst({
            where: { sourceId, vendorId: null },
            select: { id: true },
          });
          if (existing) {
            await db.product.update({ where: { id: existing.id }, data: { name } });
            audit.updated++;
          } else {
            await db.product.create({
              data: {
                name,
                slug: `${slugify(name)}-${sourceId.slice(0, 8)}`,
                status: 'active',
                sourceId,
                variants: { create: [{ price: cents, sku, sourceId, inventory }] },
              },
            });
            audit.created++;
          }
        } else {
          await db.product.create({
            data: {
              name,
              slug: `${slugify(name)}-${randomBytes(3).toString('hex')}`,
              status: 'active',
              variants: { create: [{ price: cents, sku, inventory }] },
            },
          });
          audit.created++;
        }
      } catch (err) {
        audit.skipped++;
        audit.errors.push({ index: i, reason: err instanceof Error ? err.message : 'db error' });
      }
    }

    await hookBus.run('onImportEnd', audit);
    return audit;
  },
};

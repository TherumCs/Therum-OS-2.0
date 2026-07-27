import { Prisma } from '@prisma/client';
import { db } from '../lib/db.js';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import { editionService } from './edition.service.js';

// A Foundation is a pluggable builder / CMS-compat layer "elevated" into the
// native core via Studio. Native is the Therum OS Pure base (always on).
// Foundations are persisted as extensions named "foundation:<id>".
export interface Foundation {
  id: string;
  name: string;
  kind: 'builder' | 'cms-compat';
  description: string;
  core: boolean;
  status: 'stable' | 'planned';
}

const CATALOG: Foundation[] = [
  { id: 'native', name: 'Therum Native', kind: 'builder', description: 'Pure React canvas — the Therum OS Pure base. Always on.', core: true, status: 'stable' },
  { id: 'bricks', name: 'Bricks Compatibility', kind: 'builder', description: 'Import, edit, and export Bricks pages alongside native.', core: false, status: 'stable' },
  { id: 'wordpress', name: 'WordPress Bridge', kind: 'cms-compat', description: 'Read and sync content from a WordPress install.', core: false, status: 'planned' },
];

const key = (id: string): string => `foundation:${id}`;

export const foundationService = {
  catalog(): Foundation[] {
    return CATALOG;
  },

  async list() {
    const [rows, edition] = await Promise.all([
      db.extension.findMany({ where: { name: { in: CATALOG.map((f) => key(f.id)) } }, select: { name: true, enabled: true } }),
      editionService.get(),
    ]);
    const enabled = new Set(rows.filter((r) => r.enabled).map((r) => r.name));
    return CATALOG.map((f) => ({ ...f, enabled: f.core || enabled.has(key(f.id)), locked: edition === 'pure' && !f.core }));
  },

  async setEnabled(id: string, enabled: boolean) {
    const f = CATALOG.find((x) => x.id === id);
    if (!f) throw new NotFoundError('Foundation not found', 'id');
    if (f.core && !enabled) throw new ConflictError('Therum Native is the Pure base and cannot be disabled.', 'id');
    if (f.status === 'planned' && enabled) throw new ConflictError('This foundation is planned, not yet available to enable.', 'id');
    const edition = await editionService.get();
    if (edition === 'pure' && !f.core && enabled) throw new ConflictError('This foundation requires Unlocked — Pure is native-only.', 'id');

    await db.extension.upsert({
      where: { name: key(id) },
      update: { enabled },
      create: {
        name: key(id),
        version: '1.0.0',
        manifest: { kind: 'foundation', foundationKind: f.kind } as unknown as Prisma.InputJsonValue,
        enabled,
        health: 'ok',
      },
    });
    return { ...f, enabled: f.core || enabled };
  },
};

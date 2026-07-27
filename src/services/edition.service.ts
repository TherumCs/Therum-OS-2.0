import { Prisma } from '@prisma/client';
import { db } from '../lib/db.js';

// Pure = our own ecosystem, self-contained, locked to native providers.
// Unlocked = that same ecosystem UNLOCKED to pair with others (Bricks,
// WordPress, ecosystem plugins, custom builds). It's an entitlement gate, not
// a different codebase.
export type Edition = 'pure' | 'unlocked';

const KEY = 'system:edition';

export const editionService = {
  async get(): Promise<Edition> {
    const row = await db.extension.findUnique({ where: { name: KEY }, select: { manifest: true } });
    const m = row?.manifest && typeof row.manifest === 'object' ? (row.manifest as Record<string, unknown>) : {};
    return m.edition === 'unlocked' ? 'unlocked' : 'pure';
  },

  async set(edition: Edition): Promise<{ edition: Edition }> {
    await db.extension.upsert({
      where: { name: KEY },
      update: { manifest: { kind: 'system', edition } as unknown as Prisma.InputJsonValue },
      create: { name: KEY, version: '1.0.0', enabled: true, manifest: { kind: 'system', edition } as unknown as Prisma.InputJsonValue, health: 'ok' },
    });
    return { edition };
  },
};

import { db } from '../lib/db.js';

// Called from server.ts's 404 handler, after redirectsService.findMatch()
// comes up empty — only genuinely unmatched paths land here, not every 404
// (a redirect-rule hit is a successful redirect, not a miss to monitor).
export const notFoundMonitorService = {
  async record(path: string, method: string, referer: string | null): Promise<void> {
    await db.notFoundHit.upsert({
      where: { path },
      create: { path, method, referer },
      update: { count: { increment: 1 }, method, referer },
    });
  },

  async list() {
    return db.notFoundHit.findMany({ orderBy: { count: 'desc' }, take: 200 });
  },

  async remove(id: string): Promise<void> {
    await db.notFoundHit.delete({ where: { id } });
  },

  async clear(): Promise<void> {
    await db.notFoundHit.deleteMany();
  },
};

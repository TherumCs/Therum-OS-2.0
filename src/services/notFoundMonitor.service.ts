import { db } from '../lib/db.js';

// Called from server.ts's 404 handler, after redirectsService.findMatch()
// comes up empty — only genuinely unmatched paths land here, not every 404
// (a redirect-rule hit is a successful redirect, not a miss to monitor).
export const notFoundMonitorService = {
  async record(path: string, method: string, referer: string | null): Promise<void> {
    const existing = await db.notFoundHit.findUnique({ where: { path }, select: { id: true } });
    if (existing) {
      await db.notFoundHit.update({ where: { path }, data: { count: { increment: 1 }, method, referer } });
      return;
    }
    // Cap NEW-path inserts: a scanner hitting thousands of distinct URLs would
    // otherwise grow this table without bound (one row per unique path, no
    // cleanup). Existing paths still increment above; only brand-new paths stop
    // once the table is full. prune() trims aged one-offs.
    if (await db.notFoundHit.count() >= 5000) return;
    await db.notFoundHit.create({ data: { path, method, referer } });
  },

  /** Trim aged one-off scanner hits (seen once, not in 30 days). */
  async prune(): Promise<void> {
    await db.notFoundHit.deleteMany({
      where: { count: 1, lastSeenAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
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

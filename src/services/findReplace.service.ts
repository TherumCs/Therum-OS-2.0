import { db } from '../lib/db.js';

export interface FindReplaceMatch {
  id: string;
  title: string;
  field: 'title' | 'excerpt';
}

// Scoped to title/excerpt (plain strings) — Content.body is a builder canvas
// JSON tree, not plain text, so a faithful "search inside it" needs a
// recursive tree-walker this pass didn't build. Real DB reads/writes either
// way, just a narrower field scope than 1.9.44's WP post_content search.
export const findReplaceService = {
  async preview(find: string, replace: string): Promise<{ count: number; samples: FindReplaceMatch[] }> {
    if (!find) return { count: 0, samples: [] };
    const titleMatches = await db.content.findMany({ where: { title: { contains: find, mode: 'insensitive' } }, select: { id: true, title: true } });
    const excerptMatches = await db.content.findMany({
      where: { excerpt: { contains: find, mode: 'insensitive' } },
      select: { id: true, title: true },
    });
    const samples: FindReplaceMatch[] = [
      ...titleMatches.map((m) => ({ id: m.id, title: m.title, field: 'title' as const })),
      ...excerptMatches.map((m) => ({ id: m.id, title: m.title, field: 'excerpt' as const })),
    ];
    return { count: samples.length, samples: samples.slice(0, 10) };
  },

  async execute(find: string, replace: string): Promise<{ updated: number }> {
    if (!find) return { updated: 0 };
    const titleMatches = await db.content.findMany({ where: { title: { contains: find, mode: 'insensitive' } }, select: { id: true, title: true } });
    const excerptMatches = await db.content.findMany({
      where: { excerpt: { contains: find, mode: 'insensitive' } },
      select: { id: true, excerpt: true },
    });
    const re = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    await Promise.all([
      ...titleMatches.map((m) => db.content.update({ where: { id: m.id }, data: { title: m.title.replace(re, replace) } })),
      ...excerptMatches.map((m) => db.content.update({ where: { id: m.id }, data: { excerpt: (m.excerpt ?? '').replace(re, replace) } })),
    ]);
    return { updated: titleMatches.length + excerptMatches.length };
  },
};

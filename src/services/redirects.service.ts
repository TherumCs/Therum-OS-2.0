import { db } from '../lib/db.js';

export interface RedirectRuleInput {
  from: string;
  to: string;
  code?: number;
  isRegex?: boolean;
}

export interface RedirectMatch {
  id: string;
  to: string;
  code: number;
}

// Rule CRUD + real request-time matching (findMatch, below — this used to
// be CRUD only, with `hits` sitting on the schema unincremented and nothing
// anywhere actually applying a saved rule to a real request; see
// server.ts's 404 handler for where this now gets called). JSON/CSV
// import/export is still a separate, smaller follow-up, not built here.
export const redirectsService = {
  async list() {
    return db.redirectRule.findMany({ orderBy: { createdAt: 'desc' } });
  },

  async create(input: RedirectRuleInput) {
    return db.redirectRule.create({
      data: { from: input.from, to: input.to, code: input.code ?? 301, isRegex: input.isRegex ?? false },
    });
  },

  async toggle(id: string) {
    const rule = await db.redirectRule.findUniqueOrThrow({ where: { id } });
    return db.redirectRule.update({ where: { id }, data: { enabled: !rule.enabled } });
  },

  async remove(id: string): Promise<void> {
    await db.redirectRule.delete({ where: { id } });
  },

  // Exact-match rules are checked first (cheap, indexed on `from`), then
  // regex rules in creation order (first match wins, matching how most
  // redirect-rule systems resolve ambiguity) — regex rules can't be indexed,
  // so they're the fallback pass, not the primary lookup.
  async findMatch(path: string): Promise<RedirectMatch | null> {
    const exact = await db.redirectRule.findFirst({ where: { from: path, enabled: true } });
    if (exact) {
      await db.redirectRule.update({ where: { id: exact.id }, data: { hits: { increment: 1 } } });
      return { id: exact.id, to: exact.to, code: exact.code };
    }
    const regexRules = await db.redirectRule.findMany({ where: { isRegex: true, enabled: true }, orderBy: { createdAt: 'asc' } });
    for (const rule of regexRules) {
      let re: RegExp;
      try {
        re = new RegExp(rule.from);
      } catch {
        continue; // a saved-but-invalid pattern shouldn't 500 every request; skip it
      }
      if (re.test(path)) {
        await db.redirectRule.update({ where: { id: rule.id }, data: { hits: { increment: 1 } } });
        return { id: rule.id, to: rule.to, code: rule.code };
      }
    }
    return null;
  },
};

import { db } from '../lib/db.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';

// Segments — saved audience rules, evaluated at send time (never a frozen
// list, so "bought a jersey" is true for whoever it is true for on the day).
//
// Rules read the subscriber row and, through the email address, the store's
// own order history — a subscriber who bought as a guest counts the same as
// one with an account. Money is in minor units, like everywhere else.

export type Rule =
  | { type: 'source'; op: 'is' | 'not'; value: string }
  | { type: 'tag'; op: 'has' | 'not'; value: string }
  | { type: 'list'; op: 'in' | 'not'; value: string }
  | { type: 'bought_product'; op: 'yes' | 'no'; value: string }
  | { type: 'bought_category'; op: 'yes' | 'no'; value: string }
  | { type: 'orders_count'; op: 'gte' | 'lte' | 'eq'; value: number }
  | { type: 'spent'; op: 'gte' | 'lte'; value: number }
  | { type: 'last_order_days'; op: 'within' | 'not_within'; value: number }
  | { type: 'subscribed_days'; op: 'within' | 'not_within'; value: number }
  | { type: 'has_phone'; op: 'yes' | 'no'; value?: unknown }
  | { type: 'engaged'; op: 'opened' | 'clicked' | 'not_opened'; value: number };

export interface RuleSet {
  match: 'all' | 'any';
  rules: Rule[];
}

export const RULE_TYPES: Rule['type'][] = ['source', 'tag', 'list', 'bought_product', 'bought_category', 'orders_count', 'spent', 'last_order_days', 'subscribed_days', 'has_phone', 'engaged'];

const DAY = 24 * 3600 * 1000;

function rulesOf(v: unknown): RuleSet {
  const o = (v && typeof v === 'object' && !Array.isArray(v) ? v : {}) as Partial<RuleSet>;
  return { match: o.match === 'any' ? 'any' : 'all', rules: Array.isArray(o.rules) ? (o.rules as Rule[]) : [] };
}

interface Facts {
  id: string;
  source: string;
  tags: string[];
  phone: string | null;
  subscribedAt: Date;
  listIds: Set<string>;
  orders: number;
  spent: number;
  lastOrderAt: Date | null;
  productIds: Set<string>;
  categoryIds: Set<string>;
  lastOpenAt: Date | null;
  lastClickAt: Date | null;
}

/** Every descendant of a category, itself included. */
async function categorySubtree(id: string): Promise<Set<string>> {
  const all = await db.productCategory.findMany({ select: { id: true, parentId: true } });
  const kids = new Map<string, string[]>();
  for (const c of all) if (c.parentId) kids.set(c.parentId, [...(kids.get(c.parentId) ?? []), c.id]);
  const out = new Set<string>([id]);
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const k of kids.get(cur) ?? []) if (!out.has(k)) { out.add(k); stack.push(k); }
  }
  return out;
}

/** Gather everything the rules can ask about, for the given subscribers. */
async function factsFor(ids?: string[]): Promise<Facts[]> {
  const subs = await db.subscriber.findMany({
    where: ids ? { id: { in: ids } } : {},
    select: { id: true, email: true, customerId: true, source: true, tags: true, phone: true, subscribedAt: true, lists: { select: { listId: true } } },
  });
  if (subs.length === 0) return [];
  const emails = subs.map((s) => s.email);
  const customerIds = subs.map((s) => s.customerId).filter((x): x is string => !!x);

  const orders = await db.order.findMany({
    where: {
      status: { notIn: ['cancelled', 'failed'] },
      OR: [{ customerId: { in: customerIds } }, { guestEmail: { in: emails } }, { customer: { email: { in: emails } } }],
    },
    select: {
      total: true,
      createdAt: true,
      customerId: true,
      guestEmail: true,
      customer: { select: { email: true } },
      items: { select: { variant: { select: { productId: true, product: { select: { categories: { select: { id: true } } } } } } } },
    },
  });
  const byEmail = new Map<string, typeof orders>();
  for (const o of orders) {
    const email = (o.customer?.email ?? o.guestEmail ?? '').toLowerCase();
    if (!email) continue;
    byEmail.set(email, [...(byEmail.get(email) ?? []), o]);
  }

  const engagement = await db.campaignSend.groupBy({ by: ['subscriberId'], where: { subscriberId: { in: subs.map((s) => s.id) } }, _max: { openedAt: true, clickedAt: true } });
  const eng = new Map(engagement.map((e) => [e.subscriberId, e._max]));

  return subs.map((s) => {
    const os = byEmail.get(s.email) ?? [];
    const productIds = new Set<string>();
    const categoryIds = new Set<string>();
    for (const o of os) for (const it of o.items) {
      productIds.add(it.variant.productId);
      for (const c of it.variant.product.categories) categoryIds.add(c.id);
    }
    const last = os.reduce<Date | null>((m, o) => (!m || o.createdAt > m ? o.createdAt : m), null);
    const e = eng.get(s.id);
    return {
      id: s.id,
      source: s.source,
      tags: s.tags,
      phone: s.phone,
      subscribedAt: s.subscribedAt,
      listIds: new Set(s.lists.map((l) => l.listId)),
      orders: os.length,
      spent: os.reduce((n, o) => n + o.total, 0),
      lastOrderAt: last,
      productIds,
      categoryIds,
      lastOpenAt: e?.openedAt ?? null,
      lastClickAt: e?.clickedAt ?? null,
    };
  });
}

async function test(rule: Rule, f: Facts, now: number, subtree: Map<string, Set<string>>, slugCache: Map<string, string | null>): Promise<boolean> {
  switch (rule.type) {
    case 'source': return rule.op === 'is' ? f.source === rule.value : f.source !== rule.value;
    case 'tag': return rule.op === 'has' ? f.tags.includes(rule.value) : !f.tags.includes(rule.value);
    case 'list': return rule.op === 'in' ? f.listIds.has(rule.value) : !f.listIds.has(rule.value);
    case 'bought_product': {
      // The builder picks by slug (`slug:<slug>`); resolve once per evaluation.
      let pid: string | null = rule.value;
      if (rule.value.startsWith('slug:')) {
        const key = rule.value;
        if (!slugCache.has(key)) slugCache.set(key, (await db.product.findFirst({ where: { slug: key.slice(5) }, select: { id: true } }))?.id ?? null);
        pid = slugCache.get(key) ?? null;
      }
      const hit = !!pid && f.productIds.has(pid);
      return rule.op === 'yes' ? hit : !hit;
    }
    case 'bought_category': {
      let tree = subtree.get(rule.value);
      if (!tree) { tree = await categorySubtree(rule.value); subtree.set(rule.value, tree); }
      const hit = [...f.categoryIds].some((c) => tree!.has(c));
      return rule.op === 'yes' ? hit : !hit;
    }
    case 'orders_count': {
      const n = Number(rule.value) || 0;
      return rule.op === 'gte' ? f.orders >= n : rule.op === 'lte' ? f.orders <= n : f.orders === n;
    }
    case 'spent': {
      const n = Number(rule.value) || 0;
      return rule.op === 'gte' ? f.spent >= n : f.spent <= n;
    }
    case 'last_order_days': {
      const days = Number(rule.value) || 0;
      const within = !!f.lastOrderAt && now - f.lastOrderAt.getTime() <= days * DAY;
      return rule.op === 'within' ? within : !within;
    }
    case 'subscribed_days': {
      const days = Number(rule.value) || 0;
      const within = now - f.subscribedAt.getTime() <= days * DAY;
      return rule.op === 'within' ? within : !within;
    }
    case 'has_phone': return rule.op === 'yes' ? !!f.phone : !f.phone;
    case 'engaged': {
      const days = Number(rule.value) || 30;
      const opened = !!f.lastOpenAt && now - f.lastOpenAt.getTime() <= days * DAY;
      const clicked = !!f.lastClickAt && now - f.lastClickAt.getTime() <= days * DAY;
      return rule.op === 'opened' ? opened : rule.op === 'clicked' ? clicked : !opened;
    }
    default: return false;
  }
}

export const segmentService = {
  async list() {
    const rows = await db.segment.findMany({ orderBy: { createdAt: 'asc' } });
    // Counts are live and cheap at this scale; a saved number would only lie.
    const out = [];
    for (const r of rows) out.push({ ...r, count: (await this.evaluate(rulesOf(r.rules))).size });
    return out;
  },

  async get(id: string) {
    const s = await db.segment.findUnique({ where: { id } });
    if (!s) throw new NotFoundError('Segment not found.');
    return s;
  },

  async create(input: { name: string; rules: RuleSet }) {
    if (!input.name.trim()) throw new ValidationError('A segment needs a name.', 'name');
    return db.segment.create({ data: { name: input.name.trim(), rules: input.rules as object } });
  },

  async update(id: string, input: { name?: string; rules?: RuleSet }) {
    await this.get(id);
    return db.segment.update({ where: { id }, data: { ...(input.name ? { name: input.name.trim() } : {}), ...(input.rules ? { rules: input.rules as object } : {}) } });
  },

  async remove(id: string) {
    await this.get(id);
    await db.segment.delete({ where: { id } });
    return { ok: true };
  },

  /** Subscriber ids (of `candidateIds`, or everyone) matching the rule set. */
  async evaluate(rules: RuleSet, candidateIds?: string[]): Promise<Set<string>> {
    const facts = await factsFor(candidateIds);
    const now = Date.now();
    const subtree = new Map<string, Set<string>>();
    const slugCache = new Map<string, string | null>();
    const out = new Set<string>();
    if (rules.rules.length === 0) {
      for (const f of facts) out.add(f.id);
      return out;
    }
    for (const f of facts) {
      let ok = rules.match === 'all';
      for (const r of rules.rules) {
        const hit = await test(r, f, now, subtree, slugCache);
        if (rules.match === 'all' && !hit) { ok = false; break; }
        if (rules.match === 'any' && hit) { ok = true; break; }
      }
      if (ok) out.add(f.id);
    }
    return out;
  },

  /** Preview an unsaved rule set: how many, and a few of who. */
  async preview(rules: RuleSet) {
    const ids = await this.evaluate(rules);
    const sample = ids.size ? await db.subscriber.findMany({ where: { id: { in: [...ids].slice(0, 8) } }, select: { email: true, firstName: true } }) : [];
    return { count: ids.size, sample };
  },

  /** Of `candidateIds`, which belong to ANY of the given segments (used at send time). */
  async membersOf(segmentIds: string[], candidateIds: string[]): Promise<Set<string>> {
    const segs = await db.segment.findMany({ where: { id: { in: segmentIds } }, select: { rules: true } });
    if (segs.length === 0) return new Set(candidateIds);
    const out = new Set<string>();
    for (const s of segs) for (const id of await this.evaluate(rulesOf(s.rules), candidateIds)) out.add(id);
    return out;
  },

  /** Pick-lists for the rule builder. */
  async options() {
    const [categories, lists, sources, tags] = await Promise.all([
      db.productCategory.findMany({ select: { id: true, name: true, parentId: true }, orderBy: { name: 'asc' } }),
      db.marketingList.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      db.subscriber.groupBy({ by: ['source'] }),
      db.subscriber.findMany({ select: { tags: true }, where: { tags: { isEmpty: false } }, take: 500 }),
    ]);
    return {
      categories,
      lists,
      sources: sources.map((s) => s.source),
      tags: [...new Set(tags.flatMap((t) => t.tags))].sort(),
    };
  },
};

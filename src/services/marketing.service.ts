import { db } from '../lib/db.js';
import { NotFoundError, ValidationError, ConflictError } from '../lib/errors.js';

// Marketing (Flow) — subscribers and lists.
//
// A subscriber is an ADDRESS THAT CONSENTED, which is a different thing from
// a customer (an address that bought). The two link up when both are true.
// Consent is decided here and only here: every marketing send in the module
// reads `subscriber.status`, and the legacy sweeps' `customer.meta.noMarketing`
// is kept in step on unsubscribe so nothing older mails an opted-out address.

// Synthetic addresses minted for phone-only / social-only accounts are not
// inboxes. Same rule lifecycle.service applies.
export const isRealEmail = (email: string | null | undefined): email is string =>
  !!email && email.includes('@') && !/\.local$/i.test(email);

const norm = (email: string): string => String(email ?? '').trim().toLowerCase();

const slugify = (s: string): string =>
  s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'list';

export interface ListSubscribersQuery {
  q?: string;
  status?: string;
  listId?: string;
  source?: string;
  tag?: string;
  limit?: number;
  cursor?: string;
}

export interface SubscribeInput {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  source: string;
  listIds?: string[];
  tags?: string[];
  customerId?: string | null;
  meta?: Record<string, unknown>;
  /** Only true when the person ticked an explicit SMS consent — sets smsStatus. */
  smsConsent?: boolean;
}

export const DEFAULT_LIST_SLUG = 'newsletter';

export const marketingService = {
  // ── Lists ────────────────────────────────────────────────────────────────
  async lists() {
    const rows = await db.marketingList.findMany({ orderBy: { createdAt: 'asc' }, include: { _count: { select: { members: true } } } });
    return rows.map((l) => ({ id: l.id, name: l.name, slug: l.slug, description: l.description, createdAt: l.createdAt, members: l._count.members }));
  },

  async createList(input: { name: string; description?: string | null }) {
    const name = input.name.trim();
    if (!name) throw new ValidationError('A list needs a name.', 'name');
    let slug = slugify(name);
    const taken = await db.marketingList.findUnique({ where: { slug } });
    if (taken) slug = `${slug}-${Date.now().toString(36)}`;
    return db.marketingList.create({ data: { name, slug, description: input.description ?? null } });
  },

  async updateList(id: string, input: { name?: string; description?: string | null }) {
    const list = await db.marketingList.findUnique({ where: { id } });
    if (!list) throw new NotFoundError('List not found.');
    return db.marketingList.update({ where: { id }, data: { ...(input.name ? { name: input.name.trim() } : {}), ...(input.description !== undefined ? { description: input.description } : {}) } });
  },

  async deleteList(id: string) {
    const list = await db.marketingList.findUnique({ where: { id } });
    if (!list) throw new NotFoundError('List not found.');
    if (list.slug === DEFAULT_LIST_SLUG) throw new ConflictError('The default Newsletter list cannot be deleted.');
    await db.marketingList.delete({ where: { id } });
    return { ok: true };
  },

  /** The list the storefront's own capture surfaces write to. Created on first use. */
  async defaultList() {
    const found = await db.marketingList.findUnique({ where: { slug: DEFAULT_LIST_SLUG } });
    if (found) return found;
    return db.marketingList.create({ data: { name: 'Newsletter', slug: DEFAULT_LIST_SLUG, description: 'Everyone who signed up on the site.' } });
  },

  // ── Subscribers ──────────────────────────────────────────────────────────
  async listSubscribers(q: ListSubscribersQuery) {
    const limit = Math.min(Math.max(q.limit ?? 100, 1), 500);
    const s = (q.q ?? '').trim().toLowerCase();
    const where = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.source ? { source: q.source } : {}),
      ...(q.tag ? { tags: { has: q.tag } } : {}),
      ...(q.listId ? { lists: { some: { listId: q.listId } } } : {}),
      ...(s
        ? { OR: [{ email: { contains: s } }, { firstName: { contains: s, mode: 'insensitive' as const } }, { lastName: { contains: s, mode: 'insensitive' as const } }] }
        : {}),
    };
    const rows = await db.subscriber.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      include: { lists: { select: { listId: true } } },
    });
    const items = rows.slice(0, limit).map((r) => ({ ...r, listIds: r.lists.map((l) => l.listId), lists: undefined }));
    return { items, nextCursor: rows.length > limit ? (rows[limit - 1]?.id ?? null) : null };
  },

  async stats() {
    const [total, subscribed, unsubscribed, pending, sms, lists, last30] = await Promise.all([
      db.subscriber.count(),
      db.subscriber.count({ where: { status: 'subscribed' } }),
      db.subscriber.count({ where: { status: 'unsubscribed' } }),
      db.subscriber.count({ where: { status: 'pending' } }),
      db.subscriber.count({ where: { smsStatus: 'subscribed' } }),
      db.marketingList.count(),
      // "New in 30 days" = when they actually signed up, not when the row was
      // made — an import of a 2025 list must not read as 300 new people.
      db.subscriber.count({ where: { subscribedAt: { gte: new Date(Date.now() - 30 * 24 * 3600 * 1000) } } }),
    ]);
    const bySource = await db.subscriber.groupBy({ by: ['source'], _count: { _all: true } });
    return { total, subscribed, unsubscribed, pending, sms, lists, last30, bySource: bySource.map((b) => ({ source: b.source, count: b._count._all })) };
  },

  /**
   * Add or refresh a subscriber. Idempotent: a repeat signup is a no-op that
   * still lands them on the requested lists. An address that UNSUBSCRIBED is
   * re-subscribed only when the signup is an explicit act by that person
   * (`resubscribe: true` — a form they filled in), never by a bulk mirror.
   */
  async subscribe(input: SubscribeInput & { resubscribe?: boolean }) {
    const email = norm(input.email);
    if (!isRealEmail(email)) throw new ValidationError('Enter a real email address.', 'email');
    const existing = await db.subscriber.findUnique({ where: { email } });
    let sub;
    if (existing) {
      const revive = existing.status === 'unsubscribed' && input.resubscribe;
      sub = await db.subscriber.update({
        where: { id: existing.id },
        data: {
          ...(input.firstName && !existing.firstName ? { firstName: input.firstName } : {}),
          ...(input.lastName && !existing.lastName ? { lastName: input.lastName } : {}),
          ...(input.phone && !existing.phone ? { phone: input.phone } : {}),
          ...(input.phone && input.smsConsent ? { phone: input.phone, smsStatus: 'subscribed' } : {}),
          ...(input.customerId && !existing.customerId ? { customerId: input.customerId } : {}),
          ...(input.tags?.length ? { tags: Array.from(new Set([...existing.tags, ...input.tags])) } : {}),
          ...(revive ? { status: 'subscribed', subscribedAt: new Date(), unsubscribedAt: null } : {}),
        },
      });
    } else {
      sub = await db.subscriber.create({
        data: {
          email,
          firstName: input.firstName ?? null,
          lastName: input.lastName ?? null,
          phone: input.phone ?? null,
          smsStatus: input.phone && input.smsConsent ? 'subscribed' : 'none',
          source: input.source,
          tags: input.tags ?? [],
          customerId: input.customerId ?? null,
          meta: (input.meta ?? {}) as object,
        },
      });
    }
    const listIds = input.listIds?.length ? input.listIds : [(await this.defaultList()).id];
    await db.listMembership.createMany({ data: listIds.map((listId) => ({ listId, subscriberId: sub.id })), skipDuplicates: true });
    // A brand-new signup from the site itself gets the welcome automation (and
    // its first-order code). Imports, mirrors and hand-adds do not — nobody
    // asked those people for anything yet. Dynamic import: automation.service
    // imports this file, and a static import would be a cycle at load time.
    if (!existing && ['footer', 'popup', 'embed', 'checkout'].includes(input.source)) {
      void import('./automation.service.js')
        .then(({ automationService }) => automationService.fire('welcome', { email, firstName: sub.firstName, subscriberId: sub.id }))
        .catch(() => {});
    }
    return { subscriber: sub, created: !existing };
  },

  async updateSubscriber(id: string, input: { firstName?: string | null; lastName?: string | null; phone?: string | null; tags?: string[]; status?: string; smsStatus?: string; listIds?: string[] }) {
    const sub = await db.subscriber.findUnique({ where: { id } });
    if (!sub) throw new NotFoundError('Subscriber not found.');
    const statusChange = input.status && input.status !== sub.status;
    const updated = await db.subscriber.update({
      where: { id },
      data: {
        ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
        ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.tags ? { tags: input.tags } : {}),
        ...(input.smsStatus ? { smsStatus: input.smsStatus } : {}),
        ...(statusChange
          ? input.status === 'unsubscribed'
            ? { status: 'unsubscribed', unsubscribedAt: new Date() }
            : { status: input.status, subscribedAt: new Date(), unsubscribedAt: null }
          : {}),
      },
    });
    if (input.listIds) {
      await db.listMembership.deleteMany({ where: { subscriberId: id, listId: { notIn: input.listIds } } });
      await db.listMembership.createMany({ data: input.listIds.map((listId) => ({ listId, subscriberId: id })), skipDuplicates: true });
    }
    if (statusChange && input.status === 'unsubscribed') await this.mirrorOptOutToCustomer(updated.email, true);
    if (statusChange && input.status === 'subscribed') await this.mirrorOptOutToCustomer(updated.email, false);
    return updated;
  },

  async deleteSubscriber(id: string) {
    const sub = await db.subscriber.findUnique({ where: { id } });
    if (!sub) throw new NotFoundError('Subscriber not found.');
    await db.subscriber.delete({ where: { id } });
    return { ok: true };
  },

  /** Opt an address out everywhere. Called by the signed unsubscribe link. */
  async unsubscribe(rawEmail: string, opts: { source?: string } = {}) {
    const email = norm(rawEmail);
    const sub = await db.subscriber.findUnique({ where: { email } });
    if (sub && sub.status !== 'unsubscribed') {
      await db.subscriber.update({ where: { id: sub.id }, data: { status: 'unsubscribed', unsubscribedAt: new Date(), meta: { ...(sub.meta as object), unsubscribeSource: opts.source ?? 'link' } } });
    } else if (!sub) {
      // Never mailed by the module but opted out anyway (an older sweep's mail).
      // Record it so a later import cannot quietly re-add them.
      await db.subscriber.create({ data: { email, status: 'unsubscribed', source: 'unsubscribe', unsubscribedAt: new Date(), meta: { unsubscribeSource: opts.source ?? 'link' } } });
    }
    await this.mirrorOptOutToCustomer(email, true);
    return { ok: true };
  },

  // Keep the legacy read in step: the abandoned-cart / review / broadcast
  // sweeps still check customer.meta.noMarketing.
  async mirrorOptOutToCustomer(email: string, optedOut: boolean) {
    const cust = await db.customer.findUnique({ where: { email }, select: { id: true, meta: true } });
    if (!cust) return;
    const meta = (cust.meta && typeof cust.meta === 'object' && !Array.isArray(cust.meta) ? cust.meta : {}) as Record<string, unknown>;
    if (Boolean(meta.noMarketing) === optedOut) return;
    await db.customer.update({ where: { id: cust.id }, data: { meta: { ...meta, noMarketing: optedOut } } });
  },

  /**
   * Mirror ENGAGED customers into the subscriber base. Same gate the drop
   * broadcast uses: a verified identity or a native order, no wp-import, no
   * noMarketing. Never revives an unsubscribed address. Safe to re-run.
   */
  async syncCustomers() {
    // The meta gate is applied in JS on purpose: a Prisma `NOT { meta: { path,
    // equals } }` is `NOT (meta->'source' = ...)` in SQL, which is NULL — and
    // therefore FALSE — for every customer whose meta has no such key. That
    // filter returned 0 of 57 eligible customers on the first nightly run.
    const candidates = await db.customer.findMany({
      where: { OR: [{ identities: { some: { verifiedAt: { not: null } } } }, { orders: { some: { sourceId: null } } }] },
      select: { id: true, email: true, firstName: true, lastName: true, name: true, meta: true },
    });
    const customers = candidates.filter((c) => {
      const m = (c.meta && typeof c.meta === 'object' && !Array.isArray(c.meta) ? c.meta : {}) as Record<string, unknown>;
      return m.source !== 'wp-import' && m.noMarketing !== true;
    });
    const list = await db.marketingList.findUnique({ where: { slug: 'customers' } })
      ?? await db.marketingList.create({ data: { name: 'Customers', slug: 'customers', description: 'Everyone who has bought here or verified an account. Mirrored automatically.' } });
    let added = 0;
    let linked = 0;
    for (const c of customers) {
      if (!isRealEmail(c.email)) continue;
      const first = c.firstName ?? (c.name ? c.name.split(/\s+/)[0] : null);
      const r = await this.subscribe({ email: c.email, firstName: first, lastName: c.lastName, source: 'customer', customerId: c.id, listIds: [list.id] });
      if (r.created) added += 1;
      else linked += 1;
    }
    return { scanned: customers.length, added, linked, listId: list.id };
  },

  /** CSV/paste import: `email, first, last, phone` per line; header optional. */
  async importRows(rows: { email: string; firstName?: string; lastName?: string; phone?: string }[], opts: { listIds?: string[]; tags?: string[]; source?: string }) {
    let added = 0;
    let existing = 0;
    let skipped = 0;
    for (const r of rows) {
      const email = norm(r.email);
      if (!isRealEmail(email)) { skipped += 1; continue; }
      try {
        const res = await this.subscribe({ email, firstName: r.firstName || null, lastName: r.lastName || null, phone: r.phone || null, source: opts.source ?? 'import', listIds: opts.listIds, tags: opts.tags });
        if (res.created) added += 1;
        else existing += 1;
      } catch {
        skipped += 1;
      }
    }
    return { added, existing, skipped, total: rows.length };
  },

  /** Recipients a campaign may actually mail: consented, real inbox, not bounced. */
  async mailableIn(listIds: string[], excludeListIds: string[] = []) {
    return db.subscriber.findMany({
      where: {
        status: 'subscribed',
        ...(listIds.length ? { lists: { some: { listId: { in: listIds } } } } : {}),
        ...(excludeListIds.length ? { NOT: { lists: { some: { listId: { in: excludeListIds } } } } } : {}),
      },
      select: { id: true, email: true, firstName: true, lastName: true, phone: true, smsStatus: true, customerId: true, tags: true },
    });
  },
};

export function parseCsv(text: string): { email: string; firstName?: string; lastName?: string; phone?: string }[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: { email: string; firstName?: string; lastName?: string; phone?: string }[] = [];
  let cols = { email: 0, first: 1, last: 2, phone: 3 };
  for (let i = 0; i < lines.length; i += 1) {
    const cells = (lines[i] ?? '').split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, ''));
    if (i === 0 && !cells.some((c) => c.includes('@'))) {
      // Header row: map by name so any column order works.
      const idx = (names: string[]) => cells.findIndex((c) => names.includes(c.toLowerCase()));
      cols = {
        email: Math.max(idx(['email', 'e-mail', 'email address']), 0),
        first: idx(['first', 'first name', 'firstname', 'name']),
        last: idx(['last', 'last name', 'lastname', 'surname']),
        phone: idx(['phone', 'mobile', 'sms', 'tel']),
      };
      continue;
    }
    const email = cells[cols.email] ?? cells.find((c) => c.includes('@')) ?? '';
    if (!email) continue;
    out.push({
      email,
      firstName: cols.first >= 0 ? cells[cols.first] : undefined,
      lastName: cols.last >= 0 ? cells[cols.last] : undefined,
      phone: cols.phone >= 0 ? cells[cols.phone] : undefined,
    });
  }
  return out;
}

// ─── Campaigns ─────────────────────────────────────────────────────────────
// Authoring + preview + test send. Queued sending and tracking are in
// campaignSend.service (slice 3); this half only ever writes drafts.

import { settingsService } from './settings.service.js';
import { notificationService, mailTransport } from './notification.service.js';
import { unsubscribeUrl as buildUnsubscribeUrl } from '../lib/unsubscribe.js';
import { renderEmail, renderText, starterBlocks, type Block } from './emailBlocks.js';

const ORIGIN = (): string => (process.env.PUBLIC_ORIGIN ?? '').replace(/\/+$/, '');

export interface CampaignPatch {
  name?: string;
  channel?: 'email' | 'sms';
  subject?: string;
  preheader?: string;
  fromName?: string | null;
  replyTo?: string | null;
  blocks?: Block[];
  text?: string;
  audience?: Record<string, unknown>;
}

/** Swap merge tags for one recipient. Safe on plain text and HTML alike. */
export function personalise(body: string, r: { firstName?: string | null; email: string; unsubscribeUrl: string }): string {
  const first = (r.firstName ?? '').trim() || 'there';
  return body
    .replace(/\{\{\s*first_name\s*\}\}/g, first)
    .replace(/\{\{\s*email\s*\}\}/g, r.email)
    .replace(/\{\{\s*unsubscribe_url\s*\}\}/g, r.unsubscribeUrl);
}

export const campaignService = {
  async list() {
    return db.campaign.findMany({
      orderBy: { updatedAt: 'desc' },
      select: { id: true, name: true, channel: true, subject: true, status: true, scheduledAt: true, sentAt: true, recipientCount: true, sentCount: true, failedCount: true, openCount: true, clickCount: true, unsubCount: true, createdAt: true, updatedAt: true },
    });
  },

  async get(id: string) {
    const c = await db.campaign.findUnique({ where: { id } });
    if (!c) throw new NotFoundError('Campaign not found.');
    return c;
  },

  async create(input: { name?: string; channel?: 'email' | 'sms' }) {
    const name = (input.name ?? '').trim() || `Untitled campaign`;
    return db.campaign.create({ data: { name, channel: input.channel ?? 'email', blocks: starterBlocks() as object[] } });
  },

  async update(id: string, patch: CampaignPatch) {
    const c = await this.get(id);
    if (c.status === 'sending' || c.status === 'sent') throw new ConflictError('A campaign that has gone out cannot be edited. Duplicate it instead.');
    const data: Record<string, unknown> = {};
    if (patch.name !== undefined) data.name = patch.name.trim() || c.name;
    if (patch.channel) data.channel = patch.channel;
    if (patch.subject !== undefined) data.subject = patch.subject;
    if (patch.preheader !== undefined) data.preheader = patch.preheader;
    if (patch.fromName !== undefined) data.fromName = patch.fromName;
    if (patch.replyTo !== undefined) data.replyTo = patch.replyTo;
    if (patch.text !== undefined) data.text = patch.text;
    if (patch.audience) data.audience = patch.audience;
    if (patch.blocks) {
      data.blocks = patch.blocks as object[];
      // Keep the compiled render on the row so the list/preview never re-renders
      // stale content and slice 3 can send exactly what was approved.
      const r = await this.render({ ...c, blocks: patch.blocks, preheader: patch.preheader ?? c.preheader });
      data.html = r.html;
      if (patch.text === undefined) data.text = r.text;
    }
    return db.campaign.update({ where: { id }, data });
  },

  async duplicate(id: string) {
    const c = await this.get(id);
    return db.campaign.create({ data: { name: `${c.name} (copy)`, channel: c.channel, subject: c.subject, preheader: c.preheader, fromName: c.fromName, replyTo: c.replyTo, blocks: c.blocks as object[], html: c.html, text: c.text, audience: c.audience as object } });
  },

  async remove(id: string) {
    const c = await this.get(id);
    if (c.status === 'sending') throw new ConflictError('Stop the send before deleting.');
    await db.campaign.delete({ where: { id } });
    return { ok: true };
  },

  /** Full HTML + text with merge tags still in place. */
  async render(c: { blocks: unknown; preheader: string; channel?: string }) {
    const blocks = (Array.isArray(c.blocks) ? c.blocks : []) as Block[];
    const site = await settingsService.getSite();
    const origin = ORIGIN();
    const html = await renderEmail({ blocks, preheader: c.preheader, siteName: site.siteName, origin });
    const text = renderText(blocks, origin);
    return { html, text };
  },

  /** Preview for the composer: whole email + each block's own HTML. */
  async preview(id: string, blocks?: Block[], preheader?: string) {
    const c = await this.get(id);
    const useBlocks = blocks ?? ((Array.isArray(c.blocks) ? c.blocks : []) as Block[]);
    const site = await settingsService.getSite();
    const origin = ORIGIN();
    const { renderBlock } = await import('./emailBlocks.js');
    const perBlock: Record<string, string> = {};
    for (const b of useBlocks) perBlock[b.id] = await renderBlock(b, origin);
    const html = await renderEmail({ blocks: useBlocks, preheader: preheader ?? c.preheader, siteName: site.siteName, origin });
    const sample = personalise(html, { firstName: 'Bam', email: 'you@example.com', unsubscribeUrl: `${origin}/api/shop/unsubscribe` });
    return { html: sample, raw: html, blocks: perBlock, text: renderText(useBlocks, origin) };
  },

  /** Send the current draft to one address, personalised as a real send would be. */
  async sendTest(id: string, to: string) {
    const c = await this.get(id);
    if (c.channel === 'sms') {
      const { smsService } = await import('./sms.service.js');
      const st = await smsService.status();
      if (!st.ready) throw new ConflictError(st.reason ?? 'SMS is not set up.');
      const body = personalise(c.text, { firstName: 'Bam', email: 'test', unsubscribeUrl: '' });
      const r = await smsService.send(to, `[TEST] ${body}`, { marketing: true });
      return { ok: true, to, subject: body.slice(0, 60), via: st.via, sid: r.sid };
    }
    const email = to.trim().toLowerCase();
    if (!isRealEmail(email)) throw new ValidationError('Enter a real email address.', 'to');
    // Say so when nothing can actually leave the box — a 200 that sent
    // nothing is the exact lie Bam's rule #1 is about.
    const n = await settingsService.getNotifications();
    const transport = await mailTransport();
    if (!n.emailEnabled) throw new ConflictError('Email sending is switched off in Settings › Notifications.');
    if (!transport.ready) throw new ConflictError('No mail transport is connected (Settings › Notifications / Nexus).');
    const { html, text } = await this.render(c);
    const sub = await db.subscriber.findUnique({ where: { email }, select: { firstName: true } });
    const unsub = buildUnsubscribeUrl(email);
    const r = { firstName: sub?.firstName, email, unsubscribeUrl: unsub };
    const subject = `[TEST] ${personalise(c.subject || c.name, r)}`;
    await notificationService.sendToAddress(email, subject, personalise(text, r), personalise(html, r), {
      'List-Unsubscribe': `<${unsub}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
    return { ok: true, to: email, subject, via: transport.via };
  },

  /** Product picker for the composer. */
  async products(q: string) {
    const s = q.trim();
    const rows = await db.product.findMany({
      where: { deletedAt: null, status: 'active', ...(s ? { name: { contains: s, mode: 'insensitive' } } : {}) },
      orderBy: { updatedAt: 'desc' },
      take: 25,
      select: { name: true, slug: true, image: true, variants: { select: { price: true }, orderBy: { price: 'asc' }, take: 1 } },
    });
    return rows.map((p) => ({ name: p.name, slug: p.slug, image: p.image, price: p.variants[0]?.price ?? null }));
  },
};

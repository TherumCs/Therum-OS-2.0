import { randomBytes } from 'node:crypto';
import { db } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { marketingQueue } from '../lib/queue.js';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors.js';
import { settingsService } from './settings.service.js';
import { sendEmailTo, mailTransport } from './notification.service.js';
import { couponService } from './coupon.service.js';
import { unsubscribeUrl as buildUnsubscribeUrl } from '../lib/unsubscribe.js';
import { renderEmail, renderText, renderBlock, type Block } from './emailBlocks.js';
import { isRealEmail, personalise } from './marketing.service.js';
import { instrument } from './campaignSend.service.js';

// Automations — triggered messages, authored in the same composer as a
// campaign, fired by events in the store.
//
//   welcome        someone subscribes (footer / popup / embed)     → optional single-use coupon
//   abandoned_cart the nightly cart sweep finds a stale cart       → replaces the hard-coded nudge when enabled
//   post_purchase  an order has been delivered a few days          → replaces the hard-coded review ask when enabled
//   winback        no order in N days                              → nightly sweep here
//
// The four rows are seeded on first read so the Automations tab is never
// empty; an automation that is switched OFF (or has no content) makes fire()
// return false, and the older hard-coded lifecycle mail still goes out for
// the two sweeps that had one. Every delivery is a CampaignSend row with an
// automationId, so opens/clicks/opt-outs report per automation exactly like a
// campaign.

const ORIGIN = (): string => (process.env.PUBLIC_ORIGIN ?? '').replace(/\/+$/, '');
const token = (): string => randomBytes(12).toString('base64url');
const DAY = 24 * 3600 * 1000;

export type AutomationKey = 'welcome' | 'abandoned_cart' | 'post_purchase' | 'winback';

export interface Trigger {
  event: 'signup' | 'cart_abandoned' | 'order_delivered' | 'no_order_days';
  delayMinutes?: number;
  /** winback: days since last order */
  days?: number;
  /** welcome: the first-order offer. `code` set = ONE shared code (e.g. WELCOME10) limited to once per person; empty = mint a random single-use code per recipient. */
  coupon?: { enabled: boolean; percent: number; expiresDays: number; prefix: string; code?: string } | null;
  /** how often the same person may get this one; 0 = once ever */
  repeatAfterDays?: number;
}

const id = () => Math.random().toString(36).slice(2, 10);

const SEED: { key: AutomationKey; name: string; subject: string; preheader: string; trigger: Trigger; blocks: Block[] }[] = [
  {
    key: 'welcome',
    name: 'Welcome + first-order offer',
    subject: 'Welcome in, {{first_name}} — here is 10% off',
    preheader: 'Your code is inside.',
    trigger: { event: 'signup', delayMinutes: 0, coupon: { enabled: true, percent: 10, expiresDays: 14, prefix: 'WELCOME', code: 'WELCOME10' }, repeatAfterDays: 0 },
    blocks: [
      { id: id(), type: 'eyebrow', text: 'Welcome' },
      { id: id(), type: 'heading', text: 'You are on the list, {{first_name}}.' },
      { id: id(), type: 'text', html: 'Drops, restocks, and the occasional thing we only tell email about. To start: <b>{{coupon_code}}</b> takes 10% off your first order.' },
      { id: id(), type: 'button', label: 'Shop now', url: '/shop' },
    ],
  },
  {
    key: 'abandoned_cart',
    name: 'Abandoned cart',
    subject: 'You left something in your cart',
    preheader: 'Your cart is still waiting.',
    trigger: { event: 'cart_abandoned', delayMinutes: 0, repeatAfterDays: 1 },
    blocks: [
      { id: id(), type: 'eyebrow', text: 'Your cart' },
      { id: id(), type: 'heading', text: 'You left something behind.' },
      { id: id(), type: 'text', html: 'Your cart is still here, holding what you picked out. Pick up right where you left off before it sells out.' },
      { id: id(), type: 'button', label: 'Return to your cart', url: '{{cart_url}}' },
    ],
  },
  {
    key: 'post_purchase',
    name: 'Post-purchase review ask',
    subject: 'How is your order?',
    preheader: 'A quick word helps the next person.',
    trigger: { event: 'order_delivered', delayMinutes: 0, repeatAfterDays: 30 },
    blocks: [
      { id: id(), type: 'eyebrow', text: 'Your order' },
      { id: id(), type: 'heading', text: 'How did we do?' },
      { id: id(), type: 'text', html: '{{first_name}}, your order landed a few days ago. We would love to hear how <b>{{product_name}}</b> is treating you. A quick review helps the next person shop with confidence.' },
      { id: id(), type: 'button', label: 'Write a review', url: '{{product_url}}' },
    ],
  },
  {
    key: 'winback',
    name: 'Win-back',
    subject: 'It has been a minute, {{first_name}}',
    preheader: 'New since you were last here.',
    trigger: { event: 'no_order_days', days: 90, delayMinutes: 0, repeatAfterDays: 180 },
    blocks: [
      { id: id(), type: 'eyebrow', text: 'Since you were gone' },
      { id: id(), type: 'heading', text: 'A lot has dropped.' },
      { id: id(), type: 'text', html: 'It has been a while since your last order. Here is what is new.' },
      { id: id(), type: 'button', label: 'See what is new', url: '/shop' },
    ],
  },
];

function triggerOf(v: unknown): Trigger {
  const t = (v && typeof v === 'object' && !Array.isArray(v) ? v : {}) as Partial<Trigger>;
  return { event: t.event ?? 'signup', delayMinutes: Number(t.delayMinutes ?? 0), days: t.days, coupon: t.coupon ?? null, repeatAfterDays: t.repeatAfterDays };
}

/** Extra merge tags beyond the campaign set. */
function fill(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k: string) => (k in vars ? vars[k]! : m));
}

const SAMPLE_VARS: Record<string, string> = {
  coupon_code: 'WELCOME-7K3P2Q',
  coupon_expires: new Date(Date.now() + 14 * DAY).toLocaleDateString('en-US', { month: 'long', day: 'numeric' }),
  cart_url: '/cart',
  product_name: 'Snakeskin Pin',
  product_url: '/shop',
  site_name: 'The Sidemoney Company',
};

export interface FireInput {
  email: string;
  firstName?: string | null;
  subscriberId?: string | null;
  vars?: Record<string, string>;
}

export const automationService = {
  async seed() {
    const have = new Set((await db.automation.findMany({ select: { key: true } })).map((a) => a.key));
    for (const s of SEED) {
      if (have.has(s.key)) continue;
      const site = await settingsService.getSite();
      const origin = ORIGIN();
      const html = await renderEmail({ blocks: s.blocks, preheader: s.preheader, siteName: site.siteName, origin });
      await db.automation.create({ data: { key: s.key, name: s.name, subject: s.subject, preheader: s.preheader, trigger: s.trigger as object, blocks: s.blocks as object[], html, text: renderText(s.blocks, origin), enabled: false } });
    }
  },

  async list() {
    await this.seed();
    return db.automation.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, key: true, name: true, enabled: true, channel: true, subject: true, trigger: true, sentCount: true, openCount: true, clickCount: true, updatedAt: true } });
  },

  async get(id: string) {
    const a = await db.automation.findUnique({ where: { id } });
    if (!a) throw new NotFoundError('Automation not found.');
    return a;
  },

  async byKey(key: string) {
    return db.automation.findUnique({ where: { key } });
  },

  async update(id: string, patch: { name?: string; enabled?: boolean; subject?: string; preheader?: string; blocks?: Block[]; trigger?: Partial<Trigger>; text?: string; audience?: unknown }) {
    const a = await this.get(id);
    const data: Record<string, unknown> = {};
    if (patch.name !== undefined) data.name = patch.name.trim() || a.name;
    if (patch.enabled !== undefined) data.enabled = patch.enabled;
    if (patch.subject !== undefined) data.subject = patch.subject;
    if (patch.preheader !== undefined) data.preheader = patch.preheader;
    if (patch.text !== undefined) data.text = patch.text;
    if (patch.trigger) data.trigger = { ...triggerOf(a.trigger), ...patch.trigger } as object;
    if (patch.blocks) {
      data.blocks = patch.blocks as object[];
      const r = await this.render({ blocks: patch.blocks, preheader: patch.preheader ?? a.preheader });
      data.html = r.html;
      if (patch.text === undefined) data.text = r.text;
    }
    if (data.enabled === true && !(data.html ?? a.html)) throw new ValidationError('Add content before switching this on.', 'blocks');
    return db.automation.update({ where: { id }, data });
  },

  async render(a: { blocks: unknown; preheader: string }) {
    const blocks = (Array.isArray(a.blocks) ? a.blocks : []) as Block[];
    const site = await settingsService.getSite();
    const origin = ORIGIN();
    return { html: await renderEmail({ blocks, preheader: a.preheader, siteName: site.siteName, origin }), text: renderText(blocks, origin) };
  },

  async preview(id: string, blocks?: Block[], preheader?: string) {
    const a = await this.get(id);
    const useBlocks = blocks ?? ((Array.isArray(a.blocks) ? a.blocks : []) as Block[]);
    const site = await settingsService.getSite();
    const origin = ORIGIN();
    const perBlock: Record<string, string> = {};
    for (const b of useBlocks) perBlock[b.id] = await renderBlock(b, origin);
    const raw = await renderEmail({ blocks: useBlocks, preheader: preheader ?? a.preheader, siteName: site.siteName, origin });
    const vars = { ...SAMPLE_VARS, site_name: site.siteName, cart_url: `${origin}/cart`, product_url: `${origin}/shop` };
    const html = fill(personalise(raw, { firstName: 'Bam', email: 'you@example.com', unsubscribeUrl: `${origin}/api/shop/unsubscribe` }), vars);
    return { html, raw, blocks: perBlock, text: fill(renderText(useBlocks, origin), vars) };
  },

  async sendTest(id: string, to: string) {
    const a = await this.get(id);
    const email = to.trim().toLowerCase();
    if (!isRealEmail(email)) throw new ValidationError('Enter a real email address.', 'to');
    const n = await settingsService.getNotifications();
    const transport = await mailTransport();
    if (!n.emailEnabled) throw new ConflictError('Email sending is switched off in Settings › Notifications.');
    if (!transport.ready) throw new ConflictError('No mail transport is connected.');
    const site = await settingsService.getSite();
    const origin = ORIGIN();
    const { html, text } = await this.render(a);
    const unsub = buildUnsubscribeUrl(email);
    const r = { firstName: 'Bam', email, unsubscribeUrl: unsub };
    const vars = { ...SAMPLE_VARS, site_name: site.siteName, cart_url: `${origin}/cart`, product_url: `${origin}/shop` };
    await sendEmailTo(email, `[TEST] ${fill(personalise(a.subject || a.name, r), vars)}`, fill(personalise(text, r), vars), undefined, fill(personalise(html, r), vars), { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });
    return { ok: true, to: email, via: transport.via };
  },

  /**
   * Queue one delivery. Returns false when the automation is off, the person
   * has opted out, or they already had this one within its repeat window —
   * so a caller can fall back to whatever it did before.
   */
  async fire(key: AutomationKey, input: FireInput): Promise<boolean> {
    const a = await this.byKey(key);
    if (!a || !a.enabled || !a.html.trim()) return false;
    const email = input.email.trim().toLowerCase();
    if (!isRealEmail(email)) return false;

    const sub = await db.subscriber.findUnique({ where: { email }, select: { id: true, status: true, firstName: true } });
    if (sub && sub.status !== 'subscribed') return false;
    const cust = await db.customer.findUnique({ where: { email }, select: { meta: true, firstName: true, name: true } });
    const cmeta = (cust?.meta && typeof cust.meta === 'object' && !Array.isArray(cust.meta) ? cust.meta : {}) as Record<string, unknown>;
    if (cmeta.noMarketing === true || cmeta.source === 'wp-import') return false;

    const t = triggerOf(a.trigger);
    const repeat = t.repeatAfterDays ?? 0;
    const prior = await db.campaignSend.findFirst({ where: { automationId: a.id, email, status: { in: ['queued', 'sent'] } }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
    if (prior && (repeat === 0 || Date.now() - prior.createdAt.getTime() < repeat * DAY)) return false;

    const firstName = input.firstName ?? sub?.firstName ?? cust?.firstName ?? (cust?.name ? cust.name.split(/\s+/)[0] : null) ?? null;
    const send = await db.campaignSend.create({
      data: { automationId: a.id, subscriberId: input.subscriberId ?? sub?.id ?? null, email, token: token(), channel: a.channel, meta: { vars: input.vars ?? {}, firstName } },
    });
    const delay = Math.max(0, (t.delayMinutes ?? 0) * 60_000);
    await marketingQueue.add('fire-automation', { sendId: send.id }, { delay, jobId: `auto-${send.id}`, removeOnComplete: true, removeOnFail: 50 }).catch((err) => {
      logger.warn({ err, sendId: send.id }, 'could not enqueue automation delivery');
    });
    return true;
  },

  /** Worker side: actually send one queued automation delivery. */
  async deliver(sendId: string): Promise<'sent' | 'skipped' | 'failed'> {
    const s = await db.campaignSend.findUnique({ where: { id: sendId }, include: { automation: true, subscriber: { select: { status: true } } } });
    if (!s || !s.automation || s.status !== 'queued') return 'skipped';
    const a = s.automation;
    const skip = async (why: string) => {
      await db.campaignSend.update({ where: { id: sendId }, data: { status: 'skipped', error: why } });
      return 'skipped' as const;
    };
    if (!a.enabled) return skip('automation switched off before delivery');
    if (s.subscriber && s.subscriber.status !== 'subscribed') return skip('opted out before delivery');

    const site = await settingsService.getSite();
    const origin = ORIGIN();
    const t = triggerOf(a.trigger);
    const meta = (s.meta && typeof s.meta === 'object' && !Array.isArray(s.meta) ? s.meta : {}) as { vars?: Record<string, string>; firstName?: string | null };
    const vars: Record<string, string> = { site_name: site.siteName, cart_url: `${origin}/cart`, product_url: `${origin}/shop`, product_name: '', ...(meta.vars ?? {}) };

    // Welcome offer. Shared code (Bam's call: one memorable WELCOME10, once
    // per person) or, when no code is set, a random single-use code each.
    if (a.key === 'welcome' && t.coupon?.enabled && t.coupon.code) {
      const code = t.coupon.code.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 40);
      try {
        let c = await db.coupon.findUnique({ where: { code } });
        if (!c) {
          c = await couponService.create({ code, type: 'percent', amount: Math.min(100, Math.max(1, Math.round(t.coupon.percent || 10))), minimumAmount: null, maximumAmount: null, usageLimit: null, usageLimitPerUser: 1, startsAt: null, expiresAt: null, status: 'active', description: 'Welcome offer — first order, once per person', milieuId: null });
        }
        vars.coupon_code = c.code;
        vars.coupon_expires = c.expiresAt ? c.expiresAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) : 'never';
        await db.campaignSend.update({ where: { id: sendId }, data: { meta: { ...meta, couponId: c.id, couponCode: c.code } } });
      } catch (err) {
        logger.warn({ err, sendId }, 'welcome shared coupon lookup failed — sending without a code');
        vars.coupon_code = '';
        vars.coupon_expires = '';
      }
    } else if (a.key === 'welcome' && t.coupon?.enabled) {
      const prefix = (t.coupon.prefix || 'WELCOME').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'WELCOME';
      const code = `${prefix}-${randomBytes(4).toString('hex').toUpperCase().slice(0, 6)}`;
      const expiresAt = new Date(Date.now() + Math.max(1, t.coupon.expiresDays || 14) * DAY);
      try {
        const c = await couponService.create({
          code,
          type: 'percent',
          amount: Math.min(100, Math.max(1, Math.round(t.coupon.percent || 10))),
          minimumAmount: null,
          maximumAmount: null,
          usageLimit: 1,
          usageLimitPerUser: 1,
          startsAt: null,
          expiresAt,
          status: 'active',
          description: `Welcome offer for ${s.email}`,
          milieuId: null,
        });
        vars.coupon_code = c.code;
        vars.coupon_expires = expiresAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
        await db.campaignSend.update({ where: { id: sendId }, data: { meta: { ...meta, couponId: c.id, couponCode: c.code } } });
      } catch (err) {
        logger.warn({ err, sendId }, 'welcome coupon mint failed — sending without a code');
        vars.coupon_code = '';
        vars.coupon_expires = '';
      }
    }

    const unsub = `${buildUnsubscribeUrl(s.email)}&s=${s.token}`;
    const r = { firstName: meta.firstName, email: s.email, unsubscribeUrl: unsub };
    const subject = fill(personalise(a.subject || a.name, r), vars);
    const html = instrument(fill(personalise(a.html, r), vars), s.token, origin);
    const text = fill(personalise(a.text, r), vars);
    try {
      await sendEmailTo(s.email, subject, text, undefined, html, { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });
      await db.campaignSend.update({ where: { id: sendId }, data: { status: 'sent', sentAt: new Date() } });
      await db.automation.update({ where: { id: a.id }, data: { sentCount: { increment: 1 } } });
      return 'sent';
    } catch (err) {
      await db.campaignSend.update({ where: { id: sendId }, data: { status: 'failed', error: String((err as Error)?.message ?? err).slice(0, 500) } });
      return 'failed';
    }
  },

  /** Nightly: subscribers whose last order is older than the win-back window. */
  async winbackSweep(): Promise<number> {
    const a = await this.byKey('winback');
    if (!a?.enabled) return 0;
    const days = Math.max(7, triggerOf(a.trigger).days ?? 90);
    const cutoff = new Date(Date.now() - days * DAY);
    const subs = await db.subscriber.findMany({ where: { status: 'subscribed' }, select: { id: true, email: true, firstName: true, customerId: true } });
    let fired = 0;
    for (const s of subs) {
      const last = await db.order.findFirst({
        where: { status: { notIn: ['cancelled', 'failed'] }, OR: [{ guestEmail: s.email }, { customer: { email: s.email } }] },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      if (!last || last.createdAt > cutoff) continue;
      if (await this.fire('winback', { email: s.email, firstName: s.firstName, subscriberId: s.id })) fired += 1;
    }
    return fired;
  },

  async report(id: string) {
    const a = await this.get(id);
    const [byStatus, links, recent] = await Promise.all([
      db.campaignSend.groupBy({ by: ['status'], where: { automationId: id }, _count: { _all: true } }),
      db.campaignEvent.groupBy({ by: ['url'], where: { kind: 'click', send: { automationId: id } }, _count: { _all: true }, orderBy: { _count: { url: 'desc' } }, take: 20 }),
      db.campaignSend.findMany({ where: { automationId: id }, orderBy: { createdAt: 'desc' }, take: 100, select: { email: true, status: true, error: true, sentAt: true, openedAt: true, clickedAt: true, unsubscribedAt: true, meta: true } }),
    ]);
    return {
      automation: { id: a.id, key: a.key, name: a.name, enabled: a.enabled, sentCount: a.sentCount, openCount: a.openCount, clickCount: a.clickCount },
      byStatus: byStatus.map((b) => ({ status: b.status, count: b._count._all })),
      links: links.map((l) => ({ url: l.url, clicks: l._count._all })),
      recent,
    };
  },
};

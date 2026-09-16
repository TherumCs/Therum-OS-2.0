import { randomBytes } from 'node:crypto';
import { db } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { marketingQueue } from '../lib/queue.js';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors.js';
import { settingsService } from './settings.service.js';
import { sendEmailTo, mailTransport } from './notification.service.js';
import { unsubscribeUrl as buildUnsubscribeUrl } from '../lib/unsubscribe.js';
import { marketingService, campaignService, personalise } from './marketing.service.js';
import { signupFormService } from './signupForm.service.js';
import { smsService } from './sms.service.js';

// Campaign delivery + tracking.
//
// SEND = (1) freeze the audience into CampaignSend rows (one per address, each
// with its own tracking token), (2) hand the campaign to the worker, (3) the
// worker drains the queued rows in small batches, personalising and
// instrumenting each message, marking each row sent/failed as the transport
// answers. Pause flips the campaign's status; the loop checks it every batch.
//
// TRACKING = an open pixel (`/api/m/o/<token>.gif`) and click redirects
// (`/api/m/c/<token>?u=<url>`), both resolved by the send's token, so a hit
// can never be attributed to the wrong person. Opens count once per send;
// every click is an event (a person clicking three links is three clicks).
//
// The unsubscribe link in each message also carries the token (`&s=`) so an
// opt-out is attributed to the campaign that caused it.

const ORIGIN = (): string => (process.env.PUBLIC_ORIGIN ?? '').replace(/\/+$/, '');
const BATCH = 40;
const GAP_MS = 300;
const PER_MESSAGE_MS = 900;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const token = (): string => randomBytes(12).toString('base64url');

export interface Audience {
  all?: boolean;
  listIds?: string[];
  excludeListIds?: string[];
  segmentIds?: string[];
}

function audienceOf(c: { audience: unknown }): Audience {
  const a = (c.audience && typeof c.audience === 'object' && !Array.isArray(c.audience) ? c.audience : {}) as Audience;
  return { all: !!a.all, listIds: Array.isArray(a.listIds) ? a.listIds : [], excludeListIds: Array.isArray(a.excludeListIds) ? a.excludeListIds : [], segmentIds: Array.isArray(a.segmentIds) ? a.segmentIds : [] };
}

/** Rewrite every http(s) href through the click redirect and add the open pixel. */
export function instrument(html: string, t: string, origin: string): string {
  const withClicks = html.replace(/href="(https?:\/\/[^"]+)"/g, (_m, url: string) => {
    // Never wrap the opt-out — a tracked unsubscribe that 302s through a
    // redirect is exactly what mail clients flag, and it must work even if
    // tracking is down.
    if (url.includes('/api/shop/unsubscribe')) return `href="${url}"`;
    return `href="${origin}/api/m/c/${t}?u=${encodeURIComponent(url)}"`;
  });
  const pixel = `<img src="${origin}/api/m/o/${t}.gif" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;">`;
  return withClicks.includes('</body>') ? withClicks.replace('</body>', `${pixel}</body>`) : withClicks + pixel;
}

export const campaignSendService = {
  /** Who this campaign would go to right now. */
  async resolveAudience(campaignId: string) {
    const c = await campaignService.get(campaignId);
    const a = audienceOf(c);
    if (!a.all && (a.listIds?.length ?? 0) === 0 && (a.segmentIds?.length ?? 0) === 0) return [];
    let subs = await marketingService.mailableIn(a.all ? [] : a.listIds ?? [], a.excludeListIds ?? []);
    if (a.segmentIds?.length) {
      // Segments narrow the audience further (slice 4 fills in the evaluator).
      const { segmentService } = await import('./segment.service.js').catch(() => ({ segmentService: null }));
      if (segmentService) {
        const keep = await segmentService.membersOf(a.segmentIds, subs.map((s) => s.id));
        subs = subs.filter((s) => keep.has(s.id));
      }
    }
    if (c.channel === 'sms') subs = subs.filter((s) => s.phone && s.smsStatus === 'subscribed');
    return subs;
  },

  async audienceCount(campaignId: string) {
    const subs = await this.resolveAudience(campaignId);
    return { count: subs.length };
  },

  /**
   * Freeze the audience and queue the send. `at` in the past or omitted = now.
   * Idempotent on the send rows (unique per campaign+email) so a re-schedule
   * after a cancel does not double anyone up.
   */
  async schedule(campaignId: string, at?: Date | null) {
    const c = await campaignService.get(campaignId);
    if (c.status === 'sending') throw new ConflictError('This campaign is already sending.');
    if (c.status === 'sent') throw new ConflictError('This campaign has already been sent. Duplicate it to send again.');
    if (c.channel === 'email' && !c.subject.trim()) throw new ValidationError('Add a subject line first.', 'subject');
    if (c.channel === 'email' && !c.html.trim()) throw new ValidationError('The email is empty — add at least one block and save.', 'blocks');
    if (c.channel === 'sms') {
      if (!c.text.trim()) throw new ValidationError('Write the text message first.', 'text');
      const st = await smsService.status();
      if (!st.ready) throw new ConflictError(st.reason ?? 'SMS is not set up.');
    } else {
      const n = await settingsService.getNotifications();
      const transport = await mailTransport();
      if (!n.emailEnabled) throw new ConflictError('Email sending is switched off in Settings › Notifications.');
      if (!transport.ready) throw new ConflictError('No mail transport is connected.');
    }

    const subs = await this.resolveAudience(campaignId);
    if (subs.length === 0) throw new ValidationError('Nobody to send to — pick a list with subscribed people in it.', 'audience');

    await db.campaignSend.createMany({
      data: subs.map((s) => ({ campaignId, subscriberId: s.id, email: s.email, token: token(), channel: c.channel })),
      skipDuplicates: true,
    });
    const when = at && at.getTime() > Date.now() ? at : new Date();
    const updated = await db.campaign.update({
      where: { id: campaignId },
      data: { status: 'scheduled', scheduledAt: when, recipientCount: subs.length },
    });
    // Fast path: a delayed job. The minute tick is the safety net if the
    // worker was down when the moment came.
    await marketingQueue.add('send-campaign', { campaignId }, { delay: Math.max(0, when.getTime() - Date.now()), jobId: `send-${campaignId}-${when.getTime()}`, removeOnComplete: true, removeOnFail: 50 }).catch((err) => {
      logger.warn({ err, campaignId }, 'could not enqueue campaign send — the minute tick will pick it up');
    });
    return updated;
  },

  /** Scheduled → back to draft (queued rows dropped). Sending → paused. */
  async cancel(campaignId: string) {
    const c = await campaignService.get(campaignId);
    if (c.status === 'scheduled') {
      await db.campaignSend.deleteMany({ where: { campaignId, status: 'queued' } });
      return db.campaign.update({ where: { id: campaignId }, data: { status: 'draft', scheduledAt: null, recipientCount: 0 } });
    }
    if (c.status === 'sending') return db.campaign.update({ where: { id: campaignId }, data: { status: 'paused' } });
    if (c.status === 'paused') {
      // Resume: re-queue immediately.
      await marketingQueue.add('send-campaign', { campaignId }, { jobId: `resume-${campaignId}-${Date.now()}`, removeOnComplete: true }).catch(() => {});
      return db.campaign.update({ where: { id: campaignId }, data: { status: 'scheduled', scheduledAt: new Date() } });
    }
    throw new ConflictError(`Nothing to cancel — the campaign is ${c.status}.`);
  },

  /** Worker tick: anything scheduled for a moment that has passed. */
  async due(): Promise<string[]> {
    const rows = await db.campaign.findMany({ where: { status: 'scheduled', scheduledAt: { lte: new Date() } }, select: { id: true } });
    return rows.map((r) => r.id);
  },

  /** Drain one campaign's queued sends. Safe to call twice; the row status is the lock. */
  async run(campaignId: string): Promise<{ sent: number; failed: number; stopped: boolean }> {
    const c = await db.campaign.findUnique({ where: { id: campaignId } });
    if (!c) throw new NotFoundError('Campaign not found.');
    if (c.status !== 'scheduled' && c.status !== 'sending') return { sent: 0, failed: 0, stopped: true };
    await db.campaign.update({ where: { id: campaignId }, data: { status: 'sending', startedAt: c.startedAt ?? new Date() } });

    const site = await settingsService.getSite();
    const origin = ORIGIN();
    // Frequency cap (Marketing settings): campaign mail only — automations are
    // things the person caused and never count. Checked per row at send time.
    const cap = (await signupFormService.settings()).capPerWeek;
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    let sent = 0;
    let failed = 0;
    let stopped = false;

    for (;;) {
      const state = await db.campaign.findUnique({ where: { id: campaignId }, select: { status: true } });
      if (state?.status !== 'sending') { stopped = true; break; }
      const batch = await db.campaignSend.findMany({
        where: { campaignId, status: 'queued' },
        take: BATCH,
        orderBy: { createdAt: 'asc' },
        include: { subscriber: { select: { firstName: true, status: true, phone: true, smsStatus: true } } },
      });
      if (batch.length === 0) break;

      for (const s of batch) {
        // Consent is re-checked at the moment of sending, not just when queued.
        if (s.subscriber && s.subscriber.status !== 'subscribed') {
          await db.campaignSend.update({ where: { id: s.id }, data: { status: 'skipped', error: 'opted out before send' } });
          continue;
        }
        if (c.channel === 'sms' && (!s.subscriber?.phone || s.subscriber.smsStatus !== 'subscribed')) {
          await db.campaignSend.update({ where: { id: s.id }, data: { status: 'skipped', error: 'no SMS consent' } });
          continue;
        }
        if (cap > 0) {
          const recent = await db.campaignSend.count({ where: { email: s.email, status: 'sent', campaignId: { not: null }, sentAt: { gte: weekAgo } } });
          if (recent >= cap) {
            await db.campaignSend.update({ where: { id: s.id }, data: { status: 'skipped', error: `frequency cap: already got ${recent} this week` } });
            continue;
          }
        }
        const unsub = `${buildUnsubscribeUrl(s.email)}&s=${s.token}`;
        const r = { firstName: s.subscriber?.firstName, email: s.email, unsubscribeUrl: unsub };
        if (c.channel === 'sms') {
          // Links in a text go through the click redirect too, so a tap counts.
          const body = personalise(c.text, r).replace(/https?:\/\/[^\s]+/g, (u) => (u.includes('/api/shop/unsubscribe') ? u : `${origin}/api/m/c/${s.token}?u=${encodeURIComponent(u)}`));
          try {
            const phone = s.subscriber?.phone ?? '';
            const { sid } = await smsService.send(phone, body, { marketing: true });
            await db.campaignSend.update({ where: { id: s.id }, data: { status: 'sent', sentAt: new Date(), meta: { sid } } });
            sent += 1;
          } catch (err) {
            await db.campaignSend.update({ where: { id: s.id }, data: { status: 'failed', error: String((err as Error)?.message ?? err).slice(0, 500) } });
            failed += 1;
          }
          continue;
        }
        const subject = personalise(c.subject, r);
        const html = instrument(personalise(c.html, r), s.token, origin);
        const text = personalise(c.text, r);
        const headers: Record<string, string> = {
          'List-Unsubscribe': `<${unsub}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          ...(c.replyTo ? { 'Reply-To': c.replyTo } : {}),
        };
        try {
          try {
            await sendEmailTo(s.email, subject, text, undefined, html, headers);
          } catch (first) {
            // One retry after a pause: the store's transport is Gmail SMTP with a
            // fresh login per message, and a 4xx "try again later" mid-run is a
            // throttle, not a dead address.
            await sleep(8_000);
            await sendEmailTo(s.email, subject, text, undefined, html, headers);
            logger.info({ campaignId, email: s.email, first: String((first as Error)?.message ?? first).slice(0, 120) }, 'campaign send succeeded on retry');
          }
          await db.campaignSend.update({ where: { id: s.id }, data: { status: 'sent', sentAt: new Date() } });
          sent += 1;
        } catch (err) {
          await db.campaignSend.update({ where: { id: s.id }, data: { status: 'failed', error: String((err as Error)?.message ?? err).slice(0, 500) } });
          failed += 1;
        }
        // Pace real sends: ~1 message a second keeps a per-message SMTP login
        // under any relay's burst limits. 300 recipients ≈ 5 minutes.
        await sleep(PER_MESSAGE_MS);
      }
      await db.campaign.update({ where: { id: campaignId }, data: { sentCount: { increment: sent }, failedCount: { increment: failed } } });
      sent = 0;
      failed = 0;
      await sleep(GAP_MS);
    }

    if (!stopped) {
      await db.campaign.update({ where: { id: campaignId }, data: { status: 'sent', sentAt: new Date() } });
    }
    const totals = await db.campaign.findUnique({ where: { id: campaignId }, select: { sentCount: true, failedCount: true } });
    logger.info({ campaignId, ...totals, stopped, siteName: site.siteName }, 'campaign send finished');
    return { sent: totals?.sentCount ?? 0, failed: totals?.failedCount ?? 0, stopped };
  },

  // ── Tracking ──
  async open(t: string, ua?: string, ip?: string): Promise<void> {
    const s = await db.campaignSend.findUnique({ where: { token: t }, select: { id: true, campaignId: true, automationId: true, openedAt: true } });
    if (!s) return;
    await db.campaignEvent.create({ data: { sendId: s.id, kind: 'open', ua: ua?.slice(0, 300), ip } });
    if (!s.openedAt) {
      await db.campaignSend.update({ where: { id: s.id }, data: { openedAt: new Date() } });
      if (s.campaignId) await db.campaign.update({ where: { id: s.campaignId }, data: { openCount: { increment: 1 } } });
      if (s.automationId) await db.automation.update({ where: { id: s.automationId }, data: { openCount: { increment: 1 } } });
    }
  },

  async click(t: string, url: string, ua?: string, ip?: string): Promise<void> {
    const s = await db.campaignSend.findUnique({ where: { token: t }, select: { id: true, campaignId: true, automationId: true, clickedAt: true, openedAt: true } });
    if (!s) return;
    await db.campaignEvent.create({ data: { sendId: s.id, kind: 'click', url: url.slice(0, 1000), ua: ua?.slice(0, 300), ip } });
    const data: Record<string, unknown> = {};
    if (!s.clickedAt) data.clickedAt = new Date();
    // A click proves an open even when images were blocked.
    if (!s.openedAt) data.openedAt = new Date();
    if (Object.keys(data).length) {
      await db.campaignSend.update({ where: { id: s.id }, data });
      const inc = { ...(!s.clickedAt ? { clickCount: { increment: 1 } } : {}), ...(!s.openedAt ? { openCount: { increment: 1 } } : {}) };
      if (s.campaignId) await db.campaign.update({ where: { id: s.campaignId }, data: inc });
      if (s.automationId) await db.automation.update({ where: { id: s.automationId }, data: inc });
    }
  },

  async unsubscribed(t: string): Promise<void> {
    const s = await db.campaignSend.findUnique({ where: { token: t }, select: { id: true, campaignId: true, unsubscribedAt: true } });
    if (!s || s.unsubscribedAt) return;
    await db.campaignSend.update({ where: { id: s.id }, data: { unsubscribedAt: new Date() } });
    await db.campaignEvent.create({ data: { sendId: s.id, kind: 'unsubscribe' } });
    if (s.campaignId) await db.campaign.update({ where: { id: s.campaignId }, data: { unsubCount: { increment: 1 } } });
  },

  async report(campaignId: string) {
    const c = await campaignService.get(campaignId);
    const [byStatus, links, recent] = await Promise.all([
      db.campaignSend.groupBy({ by: ['status'], where: { campaignId }, _count: { _all: true } }),
      db.campaignEvent.groupBy({ by: ['url'], where: { kind: 'click', send: { campaignId } }, _count: { _all: true }, orderBy: { _count: { url: 'desc' } }, take: 20 }),
      db.campaignSend.findMany({ where: { campaignId }, orderBy: { sentAt: 'desc' }, take: 200, select: { email: true, status: true, error: true, sentAt: true, openedAt: true, clickedAt: true, unsubscribedAt: true } }),
    ]);
    return {
      campaign: { id: c.id, name: c.name, status: c.status, scheduledAt: c.scheduledAt, startedAt: c.startedAt, sentAt: c.sentAt, recipientCount: c.recipientCount, sentCount: c.sentCount, failedCount: c.failedCount, openCount: c.openCount, clickCount: c.clickCount, unsubCount: c.unsubCount },
      byStatus: byStatus.map((b) => ({ status: b.status, count: b._count._all })),
      links: links.map((l) => ({ url: l.url, clicks: l._count._all })),
      recent,
    };
  },
};

/** 1×1 transparent GIF for the open pixel. */
export const PIXEL_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireBundle } from '../../middleware/bundle.js';
import { marketingService, campaignService, parseCsv } from '../../services/marketing.service.js';
import { ValidationError } from '../../lib/errors.js';
import { verifyClick } from '../../lib/clickSign.js';
import { campaignSendService, PIXEL_GIF } from '../../services/campaignSend.service.js';
import { segmentService, type RuleSet } from '../../services/segment.service.js';
import { automationService } from '../../services/automation.service.js';
import { signupFormService, nextWeeklySlot, type PopupSettings } from '../../services/signupForm.service.js';
import { smsService } from '../../services/sms.service.js';

// Marketing (Flow) — admin HTTP surface.
//
// Reads are open to any admin session (same rule as every other Counter list);
// anything that changes who gets mailed needs the storefront-manager bundle.
// The public capture surfaces (footer signup, popups) live in contact.ts and
// counter.ts beside the other unauthenticated writes, with their throttles.

const idOf = (req: FastifyRequest): string => (req.params as { id: string }).id;

const ListInput = z.object({ name: z.string().min(1).max(80), description: z.string().max(300).nullable().optional() });

const SubscriberInput = z.object({
  email: z.string().email().max(320),
  firstName: z.string().max(80).nullable().optional(),
  lastName: z.string().max(80).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  tags: z.array(z.string().max(40)).max(50).optional(),
  listIds: z.array(z.string()).max(50).optional(),
});

const SubscriberPatch = z.object({
  firstName: z.string().max(80).nullable().optional(),
  lastName: z.string().max(80).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  tags: z.array(z.string().max(40)).max(50).optional(),
  listIds: z.array(z.string()).max(50).optional(),
  status: z.enum(['subscribed', 'unsubscribed', 'pending', 'bounced']).optional(),
  smsStatus: z.enum(['none', 'subscribed', 'unsubscribed']).optional(),
});

const ListQuery = z.object({
  q: z.string().max(200).optional(),
  status: z.string().max(20).optional(),
  listId: z.string().optional(),
  source: z.string().max(40).optional(),
  tag: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  cursor: z.string().optional(),
});

const ImportInput = z.object({
  csv: z.string().min(1).max(2_000_000),
  listIds: z.array(z.string()).max(50).optional(),
  tags: z.array(z.string().max(40)).max(50).optional(),
});

export async function marketingRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);
  const write = { preHandler: [requireBundle('storefront-manager')] };

  app.get('/marketing/stats', async (_req, reply) => {
    reply.send(await marketingService.stats());
  });

  // ── Lists ──
  app.get('/marketing/lists', async (_req, reply) => {
    reply.send(await marketingService.lists());
  });
  app.post('/marketing/lists', write, async (req, reply) => {
    reply.status(201).send(await marketingService.createList(ListInput.parse(req.body)));
  });
  app.patch('/marketing/lists/:id', write, async (req, reply) => {
    reply.send(await marketingService.updateList(idOf(req), ListInput.partial().parse(req.body)));
  });
  app.delete('/marketing/lists/:id', write, async (req, reply) => {
    reply.send(await marketingService.deleteList(idOf(req)));
  });

  // ── Subscribers ──
  app.get('/marketing/subscribers', async (req, reply) => {
    reply.send(await marketingService.listSubscribers(ListQuery.parse(req.query)));
  });
  app.post('/marketing/subscribers', write, async (req, reply) => {
    const input = SubscriberInput.parse(req.body);
    const r = await marketingService.subscribe({ ...input, source: 'manual', resubscribe: true });
    reply.status(r.created ? 201 : 200).send(r.subscriber);
  });
  app.patch('/marketing/subscribers/:id', write, async (req, reply) => {
    reply.send(await marketingService.updateSubscriber(idOf(req), SubscriberPatch.parse(req.body)));
  });
  app.delete('/marketing/subscribers/:id', write, async (req, reply) => {
    reply.send(await marketingService.deleteSubscriber(idOf(req)));
  });

  // Paste-a-CSV import. Header row optional; any column order.
  app.post('/marketing/subscribers/import', write, async (req, reply) => {
    const input = ImportInput.parse(req.body);
    const rows = parseCsv(input.csv);
    if (rows.length === 0) throw new ValidationError('No email addresses found in that text.', 'csv');
    reply.send(await marketingService.importRows(rows, { listIds: input.listIds, tags: input.tags, source: 'import' }));
  });

  // Mirror engaged customers into the base (also runs nightly from the worker).
  app.post('/marketing/sync-customers', write, async (_req, reply) => {
    reply.send(await marketingService.syncCustomers());
  });
}

// ─── Campaigns ─────────────────────────────────────────────────────────────
const BlockSchema = z.object({ id: z.string().min(1).max(40), type: z.enum(['eyebrow', 'heading', 'text', 'image', 'button', 'divider', 'spacer', 'product', 'html']), custom: z.string().max(20000).optional() }).passthrough();

const CampaignPatchInput = z.object({
  name: z.string().max(120).optional(),
  channel: z.enum(['email', 'sms']).optional(),
  subject: z.string().max(200).optional(),
  preheader: z.string().max(200).optional(),
  fromName: z.string().max(80).nullable().optional(),
  replyTo: z.string().email().max(200).nullable().optional(),
  blocks: z.array(BlockSchema).max(60).optional(),
  text: z.string().max(20000).optional(),
  audience: z.record(z.string(), z.unknown()).optional(),
});

export async function campaignRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);
  const write = { preHandler: [requireBundle('storefront-manager')] };

  app.get('/marketing/campaigns', async (_req, reply) => {
    reply.send(await campaignService.list());
  });
  app.post('/marketing/campaigns', write, async (req, reply) => {
    const input = z.object({ name: z.string().max(120).optional(), channel: z.enum(['email', 'sms']).optional() }).parse(req.body ?? {});
    reply.status(201).send(await campaignService.create(input));
  });
  app.get('/marketing/campaigns/:id', async (req, reply) => {
    reply.send(await campaignService.get(idOf(req)));
  });
  app.patch('/marketing/campaigns/:id', write, async (req, reply) => {
    reply.send(await campaignService.update(idOf(req), CampaignPatchInput.parse(req.body) as Parameters<typeof campaignService.update>[1]));
  });
  app.delete('/marketing/campaigns/:id', write, async (req, reply) => {
    reply.send(await campaignService.remove(idOf(req)));
  });
  app.post('/marketing/campaigns/:id/duplicate', write, async (req, reply) => {
    reply.status(201).send(await campaignService.duplicate(idOf(req)));
  });
  // Preview the blocks as they are in the editor (unsaved), not the stored row.
  app.post('/marketing/campaigns/:id/preview', async (req, reply) => {
    const input = z.object({ blocks: z.array(BlockSchema).max(60).optional(), preheader: z.string().max(200).optional() }).parse(req.body ?? {});
    reply.send(await campaignService.preview(idOf(req), input.blocks as Parameters<typeof campaignService.preview>[1], input.preheader));
  });
  app.post('/marketing/campaigns/:id/test', write, async (req, reply) => {
    // Email campaigns take an address; SMS campaigns take a phone number.
    const { to } = z.object({ to: z.string().min(3).max(320) }).parse(req.body);
    reply.send(await campaignService.sendTest(idOf(req), to));
  });
  app.get('/marketing/products', async (req, reply) => {
    const { q } = z.object({ q: z.string().max(100).optional() }).parse(req.query);
    reply.send(await campaignService.products(q ?? ''));
  });
}

// ─── Sending + tracking ───────────────────────────────────────────────────
export async function campaignSendRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);
  const write = { preHandler: [requireBundle('storefront-manager')] };

  app.get('/marketing/campaigns/:id/audience', async (req, reply) => {
    reply.send(await campaignSendService.audienceCount(idOf(req)));
  });
  // Send now (no `at`) or schedule.
  app.post('/marketing/campaigns/:id/schedule', write, async (req, reply) => {
    const { at } = z.object({ at: z.coerce.date().optional().nullable() }).parse(req.body ?? {});
    reply.send(await campaignSendService.schedule(idOf(req), at ?? null));
  });
  // Scheduled → draft; sending → paused; paused → resumes.
  app.post('/marketing/campaigns/:id/cancel', write, async (req, reply) => {
    reply.send(await campaignSendService.cancel(idOf(req)));
  });
  app.get('/marketing/campaigns/:id/report', async (req, reply) => {
    reply.send(await campaignSendService.report(idOf(req)));
  });
}

// Public: the open pixel and click redirect. No auth by nature; the token is
// the only key and it is unguessable (96 random bits).
export async function marketingPublicRoutes(app: FastifyInstance): Promise<void> {
  // The live popup config for the storefront runtime. Cached a minute so a
  // busy page does not turn into a DB query per visitor.
  app.get('/shop/forms', async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=60').send(await signupFormService.publicConfig());
  });
  app.post('/shop/forms/:id/view', async (req, reply) => {
    void signupFormService.countView(idOf(req)).catch(() => {});
    reply.status(204).send();
  });

  // Twilio posts inbound texts here (form-encoded). Signature-checked, so a
  // stranger cannot opt a number out — or in — by hitting this URL.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    try {
      done(null, Object.fromEntries(new URLSearchParams(body as string)));
    } catch (err) {
      done(err as Error, undefined);
    }
  });
  app.post('/shop/sms/inbound', async (req, reply) => {
    const params = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, string>;
    const origin = (process.env.PUBLIC_ORIGIN ?? '').replace(/\/+$/, '');
    const ok = await smsService.verifySignature(`${origin}${req.url}`, params, req.headers['x-twilio-signature'] as string | undefined);
    if (!ok) return reply.status(403).send({ error: { code: 'bad_signature', message: 'Not from Twilio.' } });
    const r = await smsService.inbound(params.From ?? '', params.Body ?? '');
    // TwiML: an empty response means "no auto-reply" (Twilio sends its own STOP confirmation).
    reply.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?><Response>${r === 'stopped' ? '' : ''}</Response>`);
  });

  app.get('/m/o/:token.gif', async (req, reply) => {
    const { token } = req.params as { token: string };
    void campaignSendService.open(token, req.headers['user-agent'], req.ip).catch(() => {});
    reply
      .header('Cache-Control', 'no-store, no-cache, must-revalidate, private')
      .header('Pragma', 'no-cache')
      .header('Expires', '0')
      .type('image/gif')
      .send(PIXEL_GIF);
  });

  app.get('/m/c/:token', async (req, reply) => {
    const { token } = req.params as { token: string };
    const q = req.query as { u?: string; h?: string };
    const u = String(q.u ?? '');
    const home = (process.env.PUBLIC_ORIGIN ?? '/').replace(/\/+$/, '') || '/';
    reply.header('Cache-Control', 'no-store');

    // This used to 302 to any http(s) `u` for any token, real or not — an open
    // redirect on the store's own domain, dressed in the exact URL shape every
    // campaign email teaches people to trust. Now: the token must belong to a
    // real send, AND `u` must either carry the signature `instrument()` minted
    // for it or point back at the store itself. Anything else goes home.
    if (!(await campaignSendService.sendExists(token))) return reply.redirect(home, 302);

    let parsed: URL | null = null;
    try {
      parsed = new URL(u);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') parsed = null;
    } catch {
      parsed = null;
    }
    if (!parsed) return reply.redirect(home, 302);

    const target = parsed.toString();
    const signed = !!q.h && verifyClick(token, u, String(q.h));
    // Unsigned links exist only in mail sent before signing shipped
    // (2026-09-19); for those, same-origin targets are still honoured.
    const sameSite = (() => {
      try { return new URL(home).host === parsed!.host; } catch { return false; }
    })();
    if (!signed && !sameSite) return reply.redirect(home, 302);

    void campaignSendService.click(token, target, req.headers['user-agent'], req.ip).catch(() => {});
    return reply.redirect(target, 302);
  });
}

// ─── Segments ─────────────────────────────────────────────────────────────
const RuleSetInput = z.object({
  match: z.enum(['all', 'any']).default('all'),
  rules: z.array(z.object({ type: z.string().max(40), op: z.string().max(20), value: z.unknown().optional() }).passthrough()).max(30).default([]),
});

export async function segmentRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);
  const write = { preHandler: [requireBundle('storefront-manager')] };

  app.get('/marketing/segments', async (_req, reply) => {
    reply.send(await segmentService.list());
  });
  app.get('/marketing/segments/options', async (_req, reply) => {
    reply.send(await segmentService.options());
  });
  app.post('/marketing/segments/preview', async (req, reply) => {
    reply.send(await segmentService.preview(RuleSetInput.parse(req.body ?? {}) as RuleSet));
  });
  app.post('/marketing/segments', write, async (req, reply) => {
    const input = z.object({ name: z.string().min(1).max(80), rules: RuleSetInput }).parse(req.body);
    reply.status(201).send(await segmentService.create({ name: input.name, rules: input.rules as RuleSet }));
  });
  app.patch('/marketing/segments/:id', write, async (req, reply) => {
    const input = z.object({ name: z.string().min(1).max(80).optional(), rules: RuleSetInput.optional() }).parse(req.body);
    reply.send(await segmentService.update(idOf(req), { name: input.name, rules: input.rules as RuleSet | undefined }));
  });
  app.delete('/marketing/segments/:id', write, async (req, reply) => {
    reply.send(await segmentService.remove(idOf(req)));
  });
}

// ─── Automations ──────────────────────────────────────────────────────────
const TriggerInput = z.object({
  event: z.enum(['signup', 'cart_abandoned', 'order_delivered', 'no_order_days']).optional(),
  delayMinutes: z.number().int().min(0).max(60 * 24 * 30).optional(),
  days: z.number().int().min(1).max(3650).optional(),
  repeatAfterDays: z.number().int().min(0).max(3650).optional(),
  coupon: z.object({ enabled: z.boolean(), percent: z.number().int().min(1).max(100), expiresDays: z.number().int().min(1).max(365), prefix: z.string().max(12), code: z.string().max(40).regex(/^[A-Za-z0-9_-]*$/).optional() }).nullable().optional(),
});
const AutomationPatchInput = z.object({
  name: z.string().max(120).optional(),
  enabled: z.boolean().optional(),
  subject: z.string().max(200).optional(),
  preheader: z.string().max(200).optional(),
  blocks: z.array(BlockSchema).max(60).optional(),
  text: z.string().max(20000).optional(),
  trigger: TriggerInput.optional(),
});

export async function automationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);
  const write = { preHandler: [requireBundle('storefront-manager')] };

  app.get('/marketing/automations', async (_req, reply) => {
    reply.send(await automationService.list());
  });
  app.get('/marketing/automations/:id', async (req, reply) => {
    reply.send(await automationService.get(idOf(req)));
  });
  app.patch('/marketing/automations/:id', write, async (req, reply) => {
    reply.send(await automationService.update(idOf(req), AutomationPatchInput.parse(req.body) as Parameters<typeof automationService.update>[1]));
  });
  app.post('/marketing/automations/:id/preview', async (req, reply) => {
    const input = z.object({ blocks: z.array(BlockSchema).max(60).optional(), preheader: z.string().max(200).optional() }).parse(req.body ?? {});
    reply.send(await automationService.preview(idOf(req), input.blocks as Parameters<typeof automationService.preview>[1], input.preheader));
  });
  app.post('/marketing/automations/:id/test', write, async (req, reply) => {
    const { to } = z.object({ to: z.string().email().max(320) }).parse(req.body);
    reply.send(await automationService.sendTest(idOf(req), to));
  });
  app.get('/marketing/automations/:id/report', async (req, reply) => {
    reply.send(await automationService.report(idOf(req)));
  });
}

// ─── Forms + module settings ──────────────────────────────────────────────
const PopupSettingsInput = z.object({
  logo: z.string().max(400).optional(),
  eyebrow: z.string().max(80).optional(),
  headline: z.string().max(120).optional(),
  body: z.string().max(400).optional(),
  placeholder: z.string().max(60).optional(),
  buttonLabel: z.string().max(40).optional(),
  footnote: z.string().max(160).optional(),
  successHeadline: z.string().max(80).optional(),
  successBody: z.string().max(200).optional(),
  askName: z.boolean().optional(),
  askPhone: z.boolean().optional(),
  smsConsentText: z.string().max(200).optional(),
  trigger: z.enum(['delay', 'scroll', 'exit']).optional(),
  delaySeconds: z.number().int().min(0).max(600).optional(),
  scrollPercent: z.number().int().min(5).max(95).optional(),
  dismissDays: z.number().int().min(1).max(365).optional(),
  pages: z.enum(['all', 'home']).optional(),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});
const MarketingSettingsInput = z.object({
  weeklyDay: z.number().int().min(0).max(6).optional(),
  weeklyHour: z.number().int().min(0).max(23).optional(),
  weeklyMinute: z.number().int().min(0).max(59).optional(),
  timezone: z.string().max(64).optional(),
  capPerWeek: z.number().int().min(0).max(30).optional(),
  smsFrom: z.string().max(20).regex(/^(\+[1-9]\d{6,14})?$/, 'Use E.164, e.g. +12155550100').optional(),
});

export async function formRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', app.authenticate);
  const write = { preHandler: [requireBundle('storefront-manager')] };

  app.get('/marketing/forms', async (_req, reply) => {
    reply.send(await signupFormService.list());
  });
  app.post('/marketing/forms', write, async (req, reply) => {
    const input = z.object({ name: z.string().max(80).optional(), kind: z.enum(['popup']).optional(), listId: z.string().nullable().optional() }).parse(req.body ?? {});
    reply.status(201).send(await signupFormService.create(input));
  });
  app.patch('/marketing/forms/:id', write, async (req, reply) => {
    const input = z.object({ name: z.string().max(80).optional(), enabled: z.boolean().optional(), listId: z.string().nullable().optional(), settings: PopupSettingsInput.optional() }).parse(req.body);
    reply.send(await signupFormService.update(idOf(req), input as { settings?: Partial<PopupSettings> }));
  });
  app.delete('/marketing/forms/:id', write, async (req, reply) => {
    reply.send(await signupFormService.remove(idOf(req)));
  });
  // Exact live markup, forced open, for the admin preview iframe. Unsaved
  // settings may be passed so the preview follows the editor as you type.
  app.post('/marketing/forms/:id/preview', async (req, reply) => {
    const input = z.object({ settings: PopupSettingsInput.optional() }).parse(req.body ?? {});
    reply.type('text/html').send(await signupFormService.previewHtml(idOf(req), input.settings as Partial<PopupSettings> | undefined));
  });

  app.get('/marketing/sms/status', async (_req, reply) => {
    reply.send(await smsService.status());
  });

  app.get('/marketing/settings', async (_req, reply) => {
    const s = await signupFormService.settings();
    reply.send({ ...s, nextSlot: nextWeeklySlot(s).toISOString() });
  });
  app.put('/marketing/settings', write, async (req, reply) => {
    const s = await signupFormService.setSettings(MarketingSettingsInput.parse(req.body));
    reply.send({ ...s, nextSlot: nextWeeklySlot(s).toISOString() });
  });
}

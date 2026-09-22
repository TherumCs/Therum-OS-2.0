import { createHash, randomUUID } from 'node:crypto';
import { db } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { connectionService } from './connection.service.js';

// Signal — the store's side of Meta advertising.
//
// Meta's ad system optimises toward whoever it can SEE buying. Without a pixel
// and the Conversions API it spends blind: it can show ads, it cannot learn
// which people become customers. This module is the eyes:
//
//   browser  — the Meta Pixel (src/site/signalRuntime.ts): PageView,
//              ViewContent, AddToCart, InitiateCheckout, and a browser copy of
//              Purchase on the order-received page.
//   server   — the Conversions API: Purchase sent from the paid edge (the
//              `onOrderPaid` hook, which fires exactly once per order after the
//              settle claim). It counts when the browser pixel does not — ad
//              blockers, iOS, a shopper who closes the tab before the thank-you
//              page loads.
//
// The two copies of Purchase share an event_id (`purchase-<order number>`), so
// Meta keeps one. Customer identifiers are SHA-256 hashed before they leave the
// box, as Meta requires; the raw values never do.
//
// Off until a pixel ID is saved. The access token lives in Nexus (provider
// `meta-capi`), encrypted like every other credential.

const SETTINGS_KEY = 'signal';
const GRAPH = 'https://graph.facebook.com/v21.0';

export interface SignalSettings {
  enabled: boolean;
  pixelId: string;
  /** Events Manager › Test Events code. Set while verifying; empty in normal running. */
  testEventCode: string;
}
const DEFAULTS: SignalSettings = { enabled: false, pixelId: '', testEventCode: '' };

/** Browser context captured at checkout so the server event can be matched to the person. */
export interface SignalContext {
  fbp?: string | null;
  fbc?: string | null;
  ip?: string | null;
  ua?: string | null;
  url?: string | null;
}

const sha = (v: string | null | undefined): string | undefined => {
  const s = String(v ?? '').trim().toLowerCase();
  return s ? createHash('sha256').update(s).digest('hex') : undefined;
};
const digits = (v: string | null | undefined): string => String(v ?? '').replace(/\D/g, '');

/** Recent deliveries, kept in memory for the admin screen (per process; resets on restart). */
const recent: { at: string; event: string; eventId: string; ok: boolean; detail: string }[] = [];
const remember = (row: (typeof recent)[number]): void => {
  recent.unshift(row);
  if (recent.length > 25) recent.length = 25;
};

export const signalService = {
  async settings(): Promise<SignalSettings> {
    const row = await db.setting.findUnique({ where: { key: SETTINGS_KEY } });
    const v = (row?.value && typeof row.value === 'object' && !Array.isArray(row.value) ? row.value : {}) as Partial<SignalSettings>;
    return { ...DEFAULTS, ...v };
  },

  async setSettings(patch: Partial<SignalSettings>): Promise<SignalSettings> {
    const next = { ...(await this.settings()), ...patch };
    next.pixelId = String(next.pixelId ?? '').replace(/\D/g, '');
    next.testEventCode = String(next.testEventCode ?? '').trim().slice(0, 40);
    await db.setting.upsert({ where: { key: SETTINGS_KEY }, update: { value: next as object }, create: { key: SETTINGS_KEY, value: next as object } });
    return next;
  },

  /** What the storefront runtime needs: the pixel ID when live, nothing otherwise. */
  async publicConfig(): Promise<{ pixelId: string | null }> {
    const s = await this.settings();
    return { pixelId: s.enabled && s.pixelId ? s.pixelId : null };
  },

  async status() {
    const s = await this.settings();
    const token = await connectionService.credentialFor('meta-capi').catch(() => null);
    return {
      enabled: s.enabled,
      pixelId: s.pixelId,
      testEventCode: s.testEventCode,
      pixel: !!(s.enabled && s.pixelId),
      conversionsApi: !!(s.enabled && s.pixelId && token),
      reason: !s.pixelId ? 'Add your pixel ID.' : !s.enabled ? 'Switched off.' : !token ? 'Connect the Meta Conversions API token in Nexus to send server events.' : null,
      recent,
    };
  },

  /**
   * One server event to the Conversions API. Returns true only when Meta
   * accepted it (events_received ≥ 1) — a 200 with an error body is a failure.
   */
  async send(eventName: string, eventId: string, user: Record<string, string | string[] | undefined>, custom: Record<string, unknown>, sourceUrl: string | null): Promise<boolean> {
    const s = await this.settings();
    if (!s.enabled || !s.pixelId) return false;
    const token = await connectionService.credentialFor('meta-capi').catch(() => null);
    if (!token) return false;
    const body = {
      data: [
        {
          event_name: eventName,
          event_time: Math.floor(Date.now() / 1000),
          event_id: eventId,
          action_source: 'website',
          ...(sourceUrl ? { event_source_url: sourceUrl } : {}),
          user_data: Object.fromEntries(Object.entries(user).filter(([, v]) => v !== undefined && v !== '' && !(Array.isArray(v) && !v.length))),
          custom_data: custom,
        },
      ],
      ...(s.testEventCode ? { test_event_code: s.testEventCode } : {}),
    };
    try {
      const res = await fetch(`${GRAPH}/${s.pixelId}/events?access_token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      const j = (await res.json().catch(() => ({}))) as { events_received?: number; error?: { message?: string; code?: number } };
      const ok = res.ok && (j.events_received ?? 0) >= 1;
      remember({ at: new Date().toISOString(), event: eventName, eventId, ok, detail: ok ? `received${s.testEventCode ? ' (test)' : ''}` : (j.error?.message ?? `HTTP ${res.status}`).slice(0, 160) });
      if (!ok) logger.warn({ eventName, eventId, status: res.status, error: j.error?.message }, 'meta conversions api rejected event');
      return ok;
    } catch (err) {
      remember({ at: new Date().toISOString(), event: eventName, eventId, ok: false, detail: String((err as Error)?.message ?? err).slice(0, 160) });
      logger.warn({ err, eventName, eventId }, 'meta conversions api unreachable');
      return false;
    }
  },

  /** Server-side Purchase for a paid order. Idempotent on Meta's side via event_id. */
  async purchase(orderId: string): Promise<boolean> {
    const o = await db.order.findUnique({
      where: { id: orderId },
      select: {
        number: true, total: true, currency: true, guestEmail: true, meta: true, shipAddress: true, customerId: true,
        customer: { select: { email: true, name: true } },
        items: { select: { quantity: true, priceAtTime: true, variantId: true } },
      },
    });
    if (!o) return false;
    const meta = (o.meta && typeof o.meta === 'object' && !Array.isArray(o.meta) ? o.meta : {}) as { signal?: SignalContext };
    const ctx = meta.signal ?? {};
    const a = (o.shipAddress && typeof o.shipAddress === 'object' && !Array.isArray(o.shipAddress) ? o.shipAddress : {}) as Record<string, string | undefined>;
    const email = o.customer?.email || o.guestEmail || a.email;
    const nameParts = String(a.name || o.customer?.name || '').trim().split(/\s+/);
    const user = {
      em: sha(email),
      ph: sha(digits(a.phone)),
      fn: sha(a.firstName || nameParts[0]),
      ln: sha(a.lastName || (nameParts.length > 1 ? nameParts[nameParts.length - 1] : '')),
      ct: sha(String(a.city ?? '').replace(/\s+/g, '')),
      st: sha(a.region || a.state),
      zp: sha(String(a.postalCode || a.zip || '').slice(0, 5)),
      country: sha(a.country),
      external_id: sha(o.customerId ?? email),
      client_ip_address: ctx.ip ?? undefined,
      client_user_agent: ctx.ua ?? undefined,
      fbp: ctx.fbp ?? undefined,
      fbc: ctx.fbc ?? undefined,
    };
    const custom = {
      currency: (o.currency || 'USD').toUpperCase(),
      value: Math.round(o.total) / 100,
      order_id: o.number,
      content_type: 'product',
      content_ids: o.items.map((i) => i.variantId).filter(Boolean),
      contents: o.items.filter((i) => i.variantId).map((i) => ({ id: i.variantId, quantity: i.quantity, item_price: i.priceAtTime / 100 })),
      num_items: o.items.reduce((n, i) => n + i.quantity, 0),
    };
    return this.send('Purchase', `purchase-${o.number}`, user, custom, ctx.url ?? null);
  },

  /** Read the browser identifiers off a checkout request; stored on the order so the paid edge can use them later. */
  contextFrom(req: { headers: Record<string, string | string[] | undefined>; ip?: string }): SignalContext {
    const cookie = String(req.headers.cookie ?? '');
    const pick = (k: string) => (new RegExp(`(?:^|;\\s*)${k}=([^;]+)`).exec(cookie)?.[1] ?? null);
    const ref = String(req.headers.referer ?? req.headers.referrer ?? '') || null;
    return { fbp: pick('_fbp'), fbc: pick('_fbc'), ip: req.ip ?? null, ua: String(req.headers['user-agent'] ?? '').slice(0, 400) || null, url: ref };
  },

  /** A fresh id for events the browser does not also send. */
  eventId(prefix: string): string {
    return `${prefix}-${randomUUID()}`;
  },
};

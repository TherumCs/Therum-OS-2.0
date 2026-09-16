import { db } from '../lib/db.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';
import { POPUP_RUNTIME, POPUP_STYLES } from '../site/popupRuntime.js';

// Signup forms (Marketing › Forms) + the module's own settings.
//
// A form is a capture surface on the storefront. Today: the popup (rendered by
// popupRuntime.ts from this row's `settings`) and the footer form (always on,
// listed here only so its numbers show). At most ONE popup is live at a time —
// two popups fighting over the same visitor is the intrusive thing Bam said no
// to — so enabling one switches the others off.

export interface PopupSettings {
  /** Logo shown above the headline; when set it replaces the eyebrow text (which becomes its alt). */
  logo: string;
  eyebrow: string;
  headline: string;
  body: string;
  placeholder: string;
  buttonLabel: string;
  footnote: string;
  successHeadline: string;
  successBody: string;
  askName: boolean;
  /** Also ask for a mobile number with an explicit SMS consent tick. */
  askPhone: boolean;
  smsConsentText: string;
  trigger: 'delay' | 'scroll' | 'exit';
  delaySeconds: number;
  scrollPercent: number;
  dismissDays: number;
  pages: 'all' | 'home';
  accent: string;
}

export const POPUP_DEFAULTS: PopupSettings = {
  logo: '/wp-content/uploads/2026/03/full-sig-black.png',
  eyebrow: 'The Sidemoney Company',
  headline: '10% off your first order.',
  body: 'Drops, restocks, and the occasional thing we only tell email about. Your code lands in your inbox.',
  placeholder: 'name@email.com',
  buttonLabel: 'Get 10% off',
  footnote: 'No spam. Unsubscribe any time. One code per person.',
  successHeadline: 'You are on the list.',
  successBody: 'Check your inbox for your code.',
  askName: false,
  askPhone: false,
  smsConsentText: 'Text me too. Msg & data rates may apply. Reply STOP to opt out.',
  trigger: 'delay',
  delaySeconds: 6,
  scrollPercent: 40,
  dismissDays: 30,
  pages: 'all',
  accent: '#e83b3b',
};

function settingsOf(v: unknown): PopupSettings {
  const o = (v && typeof v === 'object' && !Array.isArray(v) ? v : {}) as Partial<PopupSettings>;
  return { ...POPUP_DEFAULTS, ...o };
}

// ── Module settings (one JSON row in `settings`) ──
export interface MarketingSettings {
  /** 0 = Sunday … 6 = Saturday */
  weeklyDay: number;
  weeklyHour: number;
  weeklyMinute: number;
  timezone: string;
  /** max campaign emails per person per rolling 7 days; 0 = no cap. Automations never count. */
  capPerWeek: number;
  /** Twilio sending number (E.164). Empty = SMS off. */
  smsFrom: string;
}
const SETTINGS_KEY = 'marketing';
export const MARKETING_DEFAULTS: MarketingSettings = { weeklyDay: 1, weeklyHour: 10, weeklyMinute: 0, timezone: 'America/New_York', capPerWeek: 2, smsFrom: '' };

/** Next occurrence of the weekly slot, in the store's timezone, as an instant. */
export function nextWeeklySlot(s: MarketingSettings, from = new Date()): Date {
  // Walk day by day (max 8) and find the first date whose local weekday matches
  // and whose local slot time is still ahead. Timezone math via Intl so DST is
  // handled by the platform, not by hand.
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: s.timezone, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  for (let i = 0; i < 9; i += 1) {
    const day = new Date(from.getTime() + i * 86400000);
    const parts = Object.fromEntries(fmt.formatToParts(day).map((p) => [p.type, p.value]));
    if (WD.indexOf(parts.weekday!) !== s.weeklyDay) continue;
    // Build the local slot on that date and convert to an instant by probing
    // the offset for that zone at that moment.
    const local = `${parts.year}-${parts.month}-${parts.day}T${String(s.weeklyHour).padStart(2, '0')}:${String(s.weeklyMinute).padStart(2, '0')}:00`;
    const guess = new Date(`${local}Z`);
    const off = tzOffsetMinutes(s.timezone, guess);
    const instant = new Date(guess.getTime() - off * 60000);
    if (instant.getTime() > from.getTime() + 60000) return instant;
  }
  return new Date(from.getTime() + 7 * 86400000);
}

function tzOffsetMinutes(tz: string, at: Date): number {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
  return Math.round((asUtc - at.getTime()) / 60000);
}

export const signupFormService = {
  async settings(): Promise<MarketingSettings> {
    const row = await db.setting.findUnique({ where: { key: SETTINGS_KEY } });
    const v = (row?.value && typeof row.value === 'object' && !Array.isArray(row.value) ? row.value : {}) as Partial<MarketingSettings>;
    return { ...MARKETING_DEFAULTS, ...v };
  },

  async setSettings(patch: Partial<MarketingSettings>): Promise<MarketingSettings> {
    const cur = await this.settings();
    const next = { ...cur, ...patch };
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: next.timezone });
    } catch {
      throw new ValidationError('That is not a valid time zone.', 'timezone');
    }
    await db.setting.upsert({ where: { key: SETTINGS_KEY }, update: { value: next as object }, create: { key: SETTINGS_KEY, value: next as object } });
    return next;
  },

  async list() {
    const rows = await db.signupForm.findMany({ orderBy: { createdAt: 'asc' }, include: { list: { select: { id: true, name: true } } } });
    // The footer form is not a row; surface its numbers from the subscribers it made.
    const footer = await db.subscriber.count({ where: { source: 'footer' } });
    return { forms: rows.map((r) => ({ ...r, settings: r.kind === 'popup' ? settingsOf(r.settings) : r.settings })), footer: { submits: footer } };
  },

  async get(id: string) {
    const f = await db.signupForm.findUnique({ where: { id } });
    if (!f) throw new NotFoundError('Form not found.');
    return { ...f, settings: f.kind === 'popup' ? settingsOf(f.settings) : f.settings };
  },

  async create(input: { name?: string; kind?: string; listId?: string | null }) {
    return db.signupForm.create({ data: { name: (input.name ?? '').trim() || 'Subscribe popup', kind: input.kind ?? 'popup', listId: input.listId ?? null, settings: POPUP_DEFAULTS as object, enabled: false } });
  },

  async update(id: string, patch: { name?: string; enabled?: boolean; listId?: string | null; settings?: Partial<PopupSettings> }) {
    const f = await this.get(id);
    const data: Record<string, unknown> = {};
    if (patch.name !== undefined) data.name = patch.name.trim() || f.name;
    if (patch.listId !== undefined) data.listId = patch.listId;
    if (patch.settings) data.settings = { ...settingsOf(f.settings), ...patch.settings } as object;
    if (patch.enabled !== undefined) data.enabled = patch.enabled;
    if (patch.enabled === true && f.kind === 'popup') {
      // One live popup at a time.
      await db.signupForm.updateMany({ where: { kind: 'popup', id: { not: id } }, data: { enabled: false } });
    }
    return db.signupForm.update({ where: { id }, data });
  },

  async remove(id: string) {
    await this.get(id);
    await db.signupForm.delete({ where: { id } });
    return { ok: true };
  },

  /** What the storefront runtime asks for: the one live popup, or nothing. */
  async publicConfig() {
    const f = await db.signupForm.findFirst({ where: { kind: 'popup', enabled: true }, orderBy: { updatedAt: 'desc' } });
    if (!f) return { popup: null };
    const s = settingsOf(f.settings);
    // Only what the browser needs — no list ids, no counts.
    return { popup: { id: f.id, settings: s } };
  },

  async countView(id: string) {
    await db.signupForm.updateMany({ where: { id }, data: { views: { increment: 1 } } }).catch(() => {});
  },

  async countSubmit(id: string) {
    await db.signupForm.updateMany({ where: { id }, data: { submits: { increment: 1 } } }).catch(() => {});
  },

  /** A full page that renders exactly the live popup (forced open) for the admin preview iframe. */
  async previewHtml(id: string, override?: Partial<PopupSettings>) {
    const f = await this.get(id);
    const s = { ...settingsOf(f.settings), ...(override ?? {}) };
    const cfg = JSON.stringify({ id: f.id, settings: s });
    // The runtime fetches /api/shop/forms; in the preview we hand it the config
    // directly by stubbing fetch for that one URL, so the exact same code runs.
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@200..800&display=swap">
<style>html,body{margin:0;height:100%;background:#f4f4f4;font-family:Manrope,-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif}
.fake{padding:28px;color:#bbb;font-size:13px}.fake i{display:block;height:14px;background:#e6e6e6;margin:10px 0;border-radius:4px}${POPUP_STYLES}</style></head>
<body><div class="fake">sidemoney.co<i style="width:60%"></i><i></i><i style="width:80%"></i><i style="width:40%"></i><i></i><i style="width:70%"></i></div>
<script>(function(){var cfg=${cfg};var of=window.fetch;window.fetch=function(u,o){if(String(u).indexOf('/api/shop/forms')===0&&!/\\/view$/.test(String(u)))return Promise.resolve({ok:true,json:function(){return Promise.resolve({popup:cfg})}});if(/\\/api\\/subscribe$/.test(String(u)))return Promise.resolve({ok:true,json:function(){return Promise.resolve({ok:true})}});return of.apply(this,arguments)};window.__thPopForce=true;})();</script>
<script>${POPUP_RUNTIME}</script></body></html>`;
  },
};

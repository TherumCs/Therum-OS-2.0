import { createHmac, timingSafeEqual } from 'node:crypto';
import { db } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { ConflictError } from '../lib/errors.js';
import { connectionService } from './connection.service.js';
import { signupFormService } from './signupForm.service.js';

// SMS — Twilio through Nexus.
//
// The credential is the Twilio entry in Nexus ("Account SID:Auth Token", the
// same row the connection test pings); the sending number lives in Marketing
// settings. Nothing here is reachable until both exist — `status()` says so
// plainly and every sender refuses rather than pretending.
//
// Consent is per channel: `subscriber.smsStatus` ('subscribed' only after a
// phone was given WITH consent), and Twilio's inbound webhook flips it on
// STOP / START so an opt-out by text is honoured without anyone touching
// the admin. Every marketing text carries "Reply STOP to opt out" once.

const TWILIO = 'https://api.twilio.com/2010-04-01';
const STOP_WORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']);
const START_WORDS = new Set(['START', 'YES', 'UNSTOP']);

function creds(c: string | null): { sid: string; token: string } | null {
  if (!c) return null;
  const i = c.indexOf(':');
  if (i < 1) return null;
  return { sid: c.slice(0, i).trim(), token: c.slice(i + 1).trim() };
}

/** E.164-ish normalisation: digits only, US default when 10 digits. */
export function normalisePhone(raw: string | null | undefined): string | null {
  const d = String(raw ?? '').replace(/[^\d+]/g, '');
  if (!d) return null;
  if (d.startsWith('+')) return d.length >= 8 ? d : null;
  const digits = d.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return digits.length >= 8 ? `+${digits}` : null;
}

export const smsService = {
  async status(): Promise<{ ready: boolean; via: string; from: string | null; reason?: string }> {
    const c = creds(await connectionService.credentialFor('twilio'));
    const s = await signupFormService.settings();
    const from = s.smsFrom || null;
    if (!c) return { ready: false, via: 'Twilio (not connected)', from, reason: 'Connect Twilio in Nexus (Account SID:Auth Token).' };
    if (!from) return { ready: false, via: 'Twilio', from, reason: 'Set the sending number in Marketing › Settings.' };
    return { ready: true, via: `Twilio · ${from}`, from };
  },

  /** One text. Throws on any failure so the caller can mark the send failed. */
  async send(to: string, body: string, opts: { marketing?: boolean } = {}): Promise<{ sid: string }> {
    const st = await this.status();
    if (!st.ready || !st.from) throw new ConflictError(st.reason ?? 'SMS is not set up.');
    const c = creds(await connectionService.credentialFor('twilio'))!;
    const dest = normalisePhone(to);
    if (!dest) throw new ConflictError('That is not a usable phone number.');
    const text = opts.marketing && !/\bSTOP\b/i.test(body) ? `${body.trim()}\nReply STOP to opt out` : body.trim();
    const form = new URLSearchParams({ To: dest, From: st.from, Body: text.slice(0, 1600) });
    const res = await fetch(`${TWILIO}/Accounts/${encodeURIComponent(c.sid)}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${c.sid}:${c.token}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const j = (await res.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };
    if (!res.ok || !j.sid) throw new Error(`Twilio ${res.status}: ${j.message ?? 'send failed'}${j.code ? ` (code ${j.code})` : ''}`);
    return { sid: j.sid };
  },

  /**
   * Twilio's request signature: HMAC-SHA1 over the full URL + the POST params
   * (keys sorted, values appended), keyed on the auth token, base64. Without
   * this anyone could POST "STOP" for any number.
   */
  async verifySignature(url: string, params: Record<string, string>, signature: string | undefined): Promise<boolean> {
    const c = creds(await connectionService.credentialFor('twilio'));
    if (!c || !signature) return false;
    const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
    const expected = createHmac('sha1', c.token).update(data).digest('base64');
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  },

  /** Inbound text: STOP-family opts out, START-family opts back in. */
  async inbound(from: string, body: string): Promise<'stopped' | 'started' | 'ignored'> {
    const phone = normalisePhone(from);
    const word = String(body ?? '').trim().toUpperCase().split(/\s+/)[0] ?? '';
    if (!phone) return 'ignored';
    if (STOP_WORDS.has(word)) {
      await db.subscriber.updateMany({ where: { phone }, data: { smsStatus: 'unsubscribed' } });
      logger.info({ phone: phone.slice(0, 5) + '…' }, 'sms opt-out by STOP');
      return 'stopped';
    }
    if (START_WORDS.has(word)) {
      await db.subscriber.updateMany({ where: { phone }, data: { smsStatus: 'subscribed' } });
      return 'started';
    }
    return 'ignored';
  },
};

import nodemailer from 'nodemailer';
import { resolveMx } from 'node:dns/promises';
import { logger } from '../lib/logger.js';
import { settingsService } from './settings.service.js';
import { connectionService } from './connection.service.js';
import { viaGmail, gmailStatus } from './gmailSend.js';

// Email goes out through whichever provider is CONNECTED IN NEXUS, falling
// back to raw SMTP settings. That order matters: on the domain every provider
// is connected through Nexus, so a mail layer that only knew about smtpHost
// would sit there silently sending nothing while the store looked configured.
//
// Each sender returns false when it cannot send, rather than throwing — the
// next one is tried, and a send that ultimately fails must never break the
// operation it was reporting on.

interface MailMessage {
  to: string;
  from: string;
  subject: string;
  body: string;
  /** Optional HTML part. Senders that support it deliver multipart/alternative
   *  (text + HTML); the text `body` stays as the fallback. */
  html?: string;
}

// One POST for every HTTP mail transport. A failed send used to collapse to a
// bare `false` (or `null` on a network error) with the provider's own reason —
// a 401 bad key, a 422 bad payload — thrown away, so "email just isn't arriving"
// was undiagnosable. Now the status and a snippet of the body are logged; the
// boolean return is unchanged so callers still fall through to the next sender.
async function mailPost(provider: string, url: string, init: RequestInit): Promise<boolean> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  } catch (err) {
    logger.warn({ provider, err: err instanceof Error ? err.message : String(err) }, 'mail transport error');
    return false;
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    logger.warn({ provider, status: res.status, body: body.slice(0, 200) }, 'mail transport rejected');
    return false;
  }
  return true;
}

async function viaResend(msg: MailMessage): Promise<boolean> {
  const key = await connectionService.credentialFor('resend');
  if (!key) return false;
  return mailPost('resend', 'https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: msg.from, to: [msg.to], subject: msg.subject, text: msg.body, ...(msg.html ? { html: msg.html } : {}) }),
  });
}

async function viaSendgrid(msg: MailMessage): Promise<boolean> {
  const key = await connectionService.credentialFor('sendgrid');
  if (!key) return false;
  return mailPost('sendgrid', 'https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: msg.to }] }],
      from: { email: msg.from },
      subject: msg.subject,
      // SendGrid requires text/plain before text/html.
      content: msg.html
        ? [{ type: 'text/plain', value: msg.body }, { type: 'text/html', value: msg.html }]
        : [{ type: 'text/plain', value: msg.body }],
    }),
  });
}

async function viaPostmark(msg: MailMessage): Promise<boolean> {
  const key = await connectionService.credentialFor('postmark');
  if (!key) return false;
  return mailPost('postmark', 'https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: { 'X-Postmark-Server-Token': key, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ From: msg.from, To: msg.to, Subject: msg.subject, TextBody: msg.body, ...(msg.html ? { HtmlBody: msg.html } : {}) }),
  });
}

const NEXUS_SENDERS = [viaGmail, viaResend, viaSendgrid, viaPostmark];

/** Which transport would actually be used, for the settings screen to show. */
export async function mailTransport(): Promise<{ ready: boolean; via: string }> {
  const gmail = await gmailStatus();
  if (gmail.ready) return { ready: true, via: `Gmail · ${gmail.email || 'connected'}` };
  for (const [id, has] of [
    ['Resend', await connectionService.credentialFor('resend')],
    ['SendGrid', await connectionService.credentialFor('sendgrid')],
    ['Postmark', await connectionService.credentialFor('postmark')],
  ] as [string, string | null][]) {
    if (has) return { ready: true, via: `${id} (Nexus)` };
  }
  const n = await settingsService.getNotifications();
  if (n.smtpHost && n.smtpPassword) return { ready: true, via: `SMTP · ${n.smtpHost}` };
  // Direct-to-MX needs no credential, so a store with a From address on its own
  // domain can already send — reporting "nothing connected" there is what made
  // the contact form tell people their message had not been delivered.
  const from = n.smtpFrom || n.adminEmail || '';
  if (from.includes('@')) return { ready: true, via: `direct to MX (as ${from})` };
  return { ready: false, via: 'nothing connected' };
}

async function sendEmail(subject: string, body: string): Promise<void> {
  const n = await settingsService.getNotifications();
  // No smtpHost check: sendEmailTo picks the transport (Nexus API / direct-MX /
  // SMTP) and no-ops if none is ready. Requiring smtpHost here made admin-login
  // and backup emails + the "send test" button silently DEAD on every non-SMTP
  // transport (Gmail/Nexus), while customer receipts on the same transport worked.
  if (!n.emailEnabled || !n.adminEmail) return;
  await sendEmailTo(n.adminEmail, subject, body);
}

// Customer-facing sends (Counter C6: receipts, refund notices) reuse the
// same per-call transport + timeouts, addressed to the given recipient
// instead of the admin. Silently a no-op until SMTP is configured.
export interface MailAttachment { filename: string; content: Buffer; contentType?: string }

export async function sendEmailTo(
  to: string,
  subject: string,
  body: string,
  attachments?: MailAttachment[],
  html?: string,
): Promise<void> {
  const n = await settingsService.getNotifications();
  if (!n.emailEnabled) return;

  // Nexus providers first — see the note at the top of this file.
  const from = n.smtpFrom || n.smtpUser || n.adminEmail || '';
  if (from) {
    // The Nexus API senders post JSON and carry no files. Mail WITH an
    // attachment skips them and falls through to SMTP / direct-MX below,
    // which do — otherwise a CV would vanish and the send would still report
    // success.
    if (!attachments?.length) {
      for (const send of NEXUS_SENDERS) {
        if (await send({ to, from, subject, body, html }).catch(() => false)) return;
      }
    }
  }

  // No relay credential? Deliver straight to the recipient's MX.
  //
  // Delivering TO a domain's mail exchanger has never required authentication —
  // that is how every mail server on the internet reaches every other one. It
  // was proven for this box before being relied on: aspmx.l.google.com:25
  // accepted MAIL FROM and RCPT TO for the store's own domain unauthenticated.
  //
  // This is deliberately the LAST resort, after every authenticated relay, and
  // it is honest about its limits. Mail to the store's own domain arrives.
  // Mail to a shopper elsewhere is sent from an IP that is not in the domain's
  // SPF record, so it will often be filtered — receipts want a real relay.
  // Returning false rather than pretending keeps sendEmailTo's contract, and
  // the contact route reports what actually happened.
  if (!n.smtpHost || !n.smtpPassword) {
    // The recipient's own mail exchangers, best priority first. nodemailer's
    // `direct: true` transport did this until it was REMOVED in nodemailer 7
    // (we run 9) — passing it now is silently ignored and the transport falls
    // back to localhost:587, which is the ECONNREFUSED ::1:587 this produced.
    const domain = to.split('@')[1];
    if (!domain) return;
    const hosts = (await resolveMx(domain).catch(() => []))
      .sort((a, b) => a.priority - b.priority)
      .map((r) => r.exchange);
    if (!hosts.length) return;

    const helo = (n.smtpFrom || n.adminEmail || '').split('@')[1] || 'localhost';
    for (const host of hosts) {
      const mx = nodemailer.createTransport({
        host,
        port: 25,
        secure: false,
        // Opportunistic TLS: an MX that offers STARTTLS gets it, one that does
        // not still receives the mail. Certificates are not verified because
        // MX hostnames routinely do not match their certs, and refusing on
        // that grounds would simply stop mail from being delivered at all.
        tls: { rejectUnauthorized: false },
        name: helo,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      });
      try {
        await mx.sendMail({ from: n.smtpFrom || n.adminEmail, to, subject, text: body, html, attachments });
        return;
      } catch {
        // Try the next exchanger — a single MX being down is routine.
      } finally {
        mx.close();
      }
    }
    return;
  }

  const transport = nodemailer.createTransport({
    host: n.smtpHost,
    port: n.smtpPort,
    secure: n.smtpPort === 465,
    auth: n.smtpUser ? { user: n.smtpUser, pass: n.smtpPassword } : undefined,
    // A dead/blackholed SMTP host must not hold a socket open indefinitely —
    // this transport is per-call, so an unbounded connect hangs the whole
    // send (and, unclosed, leaked one TCP socket PER LOGIN — found via a
    // test process that could never exit).
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  try {
    await transport.sendMail({ from: n.smtpFrom || n.smtpUser, to, subject, text: body, html, attachments });
  } finally {
    transport.close();
  }
}

async function sendSlack(text: string): Promise<void> {
  const n = await settingsService.getNotifications();
  if (!n.slackWebhook) return;
  const res = await fetch(n.slackWebhook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
  if (!res.ok) throw new Error(`Slack webhook responded ${res.status}`);
}

// Real dispatcher — replaces the old settings-only stub. Every trigger call
// is best-effort: a broken SMTP config or dead webhook must never fail (or
// even slow down) the real operation it's reporting on, so callers fire
// these without awaiting (see auth.service.ts/backup route) and every
// failure here is swallowed via allSettled, not surfaced upward.
export const notificationService = {
  // Direct customer send (Counter C6). Best-effort like everything here —
  // callers fire without awaiting; failures are logged by the caller.
  async sendToAddress(to: string, subject: string, body: string, html?: string): Promise<void> {
    await sendEmailTo(to, subject, body, undefined, html);
  },

  async notifyLogin(username: string, ip: string | null): Promise<void> {
    const n = await settingsService.getNotifications();
    if (!n.notifyOnLogin) return;
    const msg = `Therum CMS: admin login — ${username}${ip ? ` from ${ip}` : ''}`;
    await Promise.allSettled([sendEmail('Therum CMS — admin login', msg), sendSlack(msg)]);
  },

  async notifyBackupComplete(file: string, sizeBytes: number): Promise<void> {
    const n = await settingsService.getNotifications();
    if (!n.notifyOnBackup) return;
    const msg = `Therum CMS: backup completed — ${file} (${(sizeBytes / 1024 / 1024).toFixed(1)} MB)`;
    await Promise.allSettled([sendEmail('Therum CMS — backup completed', msg), sendSlack(msg)]);
  },

  // Unlike the trigger methods above, a manual test send should honestly
  // report failure per-channel — the whole point is finding out whether the
  // configured SMTP/Slack settings actually work, not hiding that from the
  // person testing them.
  async sendTest(): Promise<{ message: string }> {
    const n = await settingsService.getNotifications();
    const results: string[] = [];
    if (n.slackWebhook) {
      try {
        await sendSlack('Therum CMS — test notification. If you see this, your Slack webhook is working.');
        results.push('Slack: sent.');
      } catch (e) {
        results.push(`Slack failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (n.emailEnabled && n.adminEmail && n.smtpHost) {
      try {
        await sendEmail('Therum CMS — test notification', 'If you see this, your email notifications are working.');
        results.push('Email: sent.');
      } catch (e) {
        results.push(`Email failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (results.length === 0) return { message: 'No Slack webhook or SMTP server configured — nothing to test.' };
    return { message: results.join(' ') };
  },
};

import nodemailer from 'nodemailer';
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
}

async function viaResend(msg: MailMessage): Promise<boolean> {
  const key = await connectionService.credentialFor('resend');
  if (!key) return false;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: msg.from, to: [msg.to], subject: msg.subject, text: msg.body }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  return Boolean(res?.ok);
}

async function viaSendgrid(msg: MailMessage): Promise<boolean> {
  const key = await connectionService.credentialFor('sendgrid');
  if (!key) return false;
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: msg.to }] }],
      from: { email: msg.from },
      subject: msg.subject,
      content: [{ type: 'text/plain', value: msg.body }],
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  return Boolean(res?.ok);
}

async function viaPostmark(msg: MailMessage): Promise<boolean> {
  const key = await connectionService.credentialFor('postmark');
  if (!key) return false;
  const res = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: { 'X-Postmark-Server-Token': key, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ From: msg.from, To: msg.to, Subject: msg.subject, TextBody: msg.body }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  return Boolean(res?.ok);
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
  if (n.smtpHost) return { ready: true, via: `SMTP · ${n.smtpHost}` };
  return { ready: false, via: 'nothing connected' };
}

async function sendEmail(subject: string, body: string): Promise<void> {
  const n = await settingsService.getNotifications();
  if (!n.emailEnabled || !n.adminEmail || !n.smtpHost) return;
  await sendEmailTo(n.adminEmail, subject, body);
}

// Customer-facing sends (Counter C6: receipts, refund notices) reuse the
// same per-call transport + timeouts, addressed to the given recipient
// instead of the admin. Silently a no-op until SMTP is configured.
export async function sendEmailTo(to: string, subject: string, body: string): Promise<void> {
  const n = await settingsService.getNotifications();
  if (!n.emailEnabled) return;

  // Nexus providers first — see the note at the top of this file.
  const from = n.smtpFrom || n.smtpUser || n.adminEmail || '';
  if (from) {
    for (const send of NEXUS_SENDERS) {
      if (await send({ to, from, subject, body }).catch(() => false)) return;
    }
  }

  if (!n.smtpHost) return;
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
    await transport.sendMail({ from: n.smtpFrom || n.smtpUser, to, subject, text: body });
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
  async sendToAddress(to: string, subject: string, body: string): Promise<void> {
    await sendEmailTo(to, subject, body);
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

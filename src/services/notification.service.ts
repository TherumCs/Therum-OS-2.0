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
  /** Extra MIME headers (e.g. List-Unsubscribe / List-Unsubscribe-Post for
   *  one-click marketing opt-out, RFC 8058). Each transport maps them into its
   *  own shape; a transport that can't carry them just omits them. */
  headers?: Record<string, string>;
  /** Files to carry with the message. An attachment with a `cid` is an image
   *  the HTML points at with src="cid:…" rather than a download. */
  attachments?: MailAttachment[];
  /** 'broadcast' for campaign mail, 'transactional' for everything a person
   *  caused (receipts, password resets, welcome). Providers that separate the
   *  two — Postmark does — will throttle or suspend an account that sends a
   *  newsletter down the transactional pipe, because the whole point of the
   *  split is that a receipt must never be delayed behind a marketing blast. */
  stream?: 'broadcast' | 'transactional';
}

// One POST for every HTTP mail transport. A failed send used to collapse to a
// bare `false` (or `null` on a network error) with the provider's own reason —
// a 401 bad key, a 422 bad payload — thrown away, so "email just isn't arriving"
// was undiagnosable. Now the status and a snippet of the body are logged; the
// boolean return is unchanged so callers still fall through to the next sender.
/** Set by mailPost when Postmark refused only because the account is not yet approved for off-domain recipients (ErrorCode 412). */
let postmarkPendingApproval = false;

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
    // A verdict about the RECIPIENT is final. Postmark 422 ErrorCode 300 = the
    // address itself is invalid, 406 = it previously hard-bounced and is
    // inactive. Falling through to SMTP here just re-sends to a dead address
    // and lands the bounce in the merchant's inbox instead of the provider's
    // suppression list — which is what happened with the audit probes.
    if (provider === 'postmark' && res.status === 422 && /"ErrorCode":\s*(300|406)\b/.test(body)) return true;
    postmarkPendingApproval = provider === 'postmark' && res.status === 422 && /"ErrorCode":\s*412\b/.test(body);
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
    body: JSON.stringify({ from: msg.from, to: [msg.to], subject: msg.subject, text: msg.body, ...(msg.html ? { html: msg.html } : {}), ...(msg.headers ? { headers: msg.headers } : {}) }),
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
      ...(msg.headers ? { headers: msg.headers } : {}),
    }),
  });
}

// Postmark carries everything this system sends: attachments (including the
// inline `cid:` images a campaign embeds) and the stream split. The stream
// names are the ones created with a Postmark server: `outbound` for
// transactional, `broadcast` for marketing. A store that has only one of the
// two credentials still works — the same token serves both streams.
async function viaPostmark(msg: MailMessage): Promise<boolean> {
  // A separate broadcast token is optional: use it when one is connected AND
  // this is marketing mail, otherwise the single Postmark credential.
  const broadcastKey = msg.stream === 'broadcast' ? await connectionService.credentialFor('postmark-broadcast').catch(() => null) : null;
  const key = broadcastKey ?? (await connectionService.credentialFor('postmark'));
  if (!key) return false;
  // Postmark rejects the whole message (422, ErrorCode 300) if a header it owns
  // appears in `Headers` — Reply-To is a named field there, not a header. The
  // rejection is easy to miss because the send then falls through to the next
  // transport and still reports success.
  const RESERVED = new Set(['reply-to', 'from', 'to', 'cc', 'bcc', 'subject', 'date', 'message-id', 'content-type', 'mime-version']);
  const entries = Object.entries(msg.headers ?? {});
  const replyTo = entries.find(([k]) => k.toLowerCase() === 'reply-to')?.[1];
  const passHeaders = entries.filter(([k]) => !RESERVED.has(k.toLowerCase()));
  return mailPost('postmark', 'https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: { 'X-Postmark-Server-Token': key, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      From: msg.from,
      To: msg.to,
      Subject: msg.subject,
      TextBody: msg.body,
      MessageStream: msg.stream === 'broadcast' ? 'broadcast' : 'outbound',
      ...(msg.html ? { HtmlBody: msg.html } : {}),
      ...(replyTo ? { ReplyTo: replyTo } : {}),
      ...(passHeaders.length ? { Headers: passHeaders.map(([Name, Value]) => ({ Name, Value })) } : {}),
      ...(msg.attachments?.length
        ? {
            Attachments: msg.attachments.map((a) => ({
              Name: a.filename,
              Content: a.content.toString('base64'),
              ContentType: a.contentType ?? 'application/octet-stream',
              // Postmark treats a ContentID as "render this inline"; without it
              // the picture arrives as a paperclip instead of in the layout.
              ...(a.cid ? { ContentID: `cid:${a.cid}` } : {}),
            })),
          }
        : {}),
    }),
  });
}

const NEXUS_SENDERS = [viaGmail, viaResend, viaSendgrid, viaPostmark];
/** The subset that can carry files — see the note in sendEmailTo. */
const ATTACHMENT_CAPABLE_SENDERS = [viaPostmark];

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
// `cid` + `contentDisposition: 'inline'` make the part an embedded image the
// HTML can point at with src="cid:…" rather than a file the reader downloads.
export interface MailAttachment { filename: string; content: Buffer; contentType?: string; cid?: string; contentDisposition?: 'inline' | 'attachment' }

export async function sendEmailTo(
  to: string,
  subject: string,
  body: string,
  attachments?: MailAttachment[],
  html?: string,
  headers?: Record<string, string>,
  stream?: 'broadcast' | 'transactional',
): Promise<void> {
  const n = await settingsService.getNotifications();
  if (!n.emailEnabled) return;

  // Nexus providers first — see the note at the top of this file.
  const from = n.smtpFrom || n.smtpUser || n.adminEmail || '';

  // Postmark connected = Postmark ONLY (the merchant's call, 2026-09-19:
  // "everything should be through postmark"). No fall-through to SMTP or
  // direct-MX: a message Postmark refuses is a failed send the caller records,
  // not a message that leaves by another door — that second door is how dead
  // addresses got re-sent through Gmail and bounced into the owner's inbox
  // while the settings screen said Postmark.
  if (from && (await connectionService.credentialFor('postmark'))) {
    postmarkPendingApproval = false;
    const ok = await viaPostmark({ to, from, subject, body, html, headers, attachments, stream }).catch(() => false);
    if (ok) return;
    // ONE exception to "Postmark only": a new Postmark account cannot send
    // off-domain until Postmark approves it (ErrorCode 412). That is a state of
    // the account, not a verdict on the message, and an order receipt must not
    // be lost to it — so, loudly, the message goes out the old way. The day
    // approval lands this branch stops firing on its own.
    if (postmarkPendingApproval) {
      logger.error({ to: to.replace(/^(.).*@/, '$1***@'), subject }, 'POSTMARK PENDING APPROVAL — sent via fallback transport; request approval in the Postmark dashboard');
    } else {
      throw new Error('Postmark did not accept the message');
    }
  }

  if (from) {
    // Most Nexus senders post JSON and carry no files, so mail WITH an
    // attachment skips them and falls through to SMTP / direct-MX below, which
    // do — otherwise a CV would vanish and the send would still report success.
    // Postmark is the exception: it takes attachments, so it is tried for those
    // too. Without this, a campaign's embedded images would silently demote
    // every newsletter to SMTP while the settings screen still said Postmark.
    const senders = attachments?.length ? ATTACHMENT_CAPABLE_SENDERS : NEXUS_SENDERS;
    for (const send of senders) {
      if (await send({ to, from, subject, body, html, headers, attachments, stream }).catch(() => false)) return;
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
        await mx.sendMail({ from: n.smtpFrom || n.adminEmail, to, subject, text: body, html, attachments, ...(headers ? { headers } : {}) });
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
    await transport.sendMail({ from: n.smtpFrom || n.smtpUser, to, subject, text: body, html, attachments, ...(headers ? { headers } : {}) });
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
  async sendToAddress(to: string, subject: string, body: string, html?: string, headers?: Record<string, string>, attachments?: MailAttachment[], stream?: 'broadcast' | 'transactional'): Promise<void> {
    await sendEmailTo(to, subject, body, attachments, html, headers, stream);
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

  // A FAILED backup is the one you must hear about — only the success path
  // notified, so a silently-failing backup left no recent restore point and
  // nobody knew until they needed it. Always alerts (a backup failure is not
  // something to gate behind a preference).
  async notifyBackupFailed(reason: string): Promise<void> {
    const msg = `Therum CMS: SCHEDULED BACKUP FAILED — ${reason}. No fresh restore point was created; investigate now.`;
    await Promise.allSettled([sendEmail('Therum CMS — BACKUP FAILED', msg), sendSlack(msg)]);
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

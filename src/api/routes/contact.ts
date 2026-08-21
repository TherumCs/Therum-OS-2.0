import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { settingsService } from '../../services/settings.service.js';
import { mailTransport } from '../../services/notification.service.js';
import { sendEmailTo, type MailAttachment } from '../../services/notification.service.js';
import { roleBySlug, CAREERS_INBOX, CV_MAX_BYTES, CV_TYPES } from '../../site/careers.js';
import { checkRateLimit } from '../../lib/rateLimit.js';
import { TooManyRequestsError, ValidationError } from '../../lib/errors.js';

// The contact form's one endpoint.
//
// THE RECIPIENT IS NEVER IN THE REQUEST. The browser sends a topic id; this
// looks that id up in Settings > Counter and mails whichever address the
// merchant configured. A form that posts its own `to` address is an open relay
// with a nice font — spammers find those within days of a site going live.

const ContactInput = z.object({
  topic: z.string().min(1).max(40),
  name: z.string().min(1).max(120),
  email: z.string().email().max(320),
  message: z.string().min(1).max(5000),
  // The per-topic extras. All optional: which ones a topic asks for is the
  // merchant's choice, and a stale form should not hard-fail on the server.
  order: z.string().max(60).optional(),
  instagram: z.string().max(80).optional(),
  portfolio: z.string().max(300).optional(),
  company: z.string().max(120).optional(),
  budget: z.string().max(60).optional(),
  // Honeypot: a field no human sees, so anything in it is a bot. Named
  // innocuously because "honeypot" in the DOM is a hint.
  website: z.string().max(200).optional(),
});

const SubscribeInput = z.object({
  email: z.string().email().max(320),
  // Same honeypot contract as the contact form above.
  website: z.string().max(200).optional(),
});

const EXTRA_LABELS: Record<string, string> = {
  order: 'Order number',
  instagram: 'Instagram',
  portfolio: 'Portfolio',
  company: 'Company',
  budget: 'Budget',
};

export async function contactRoutes(app: FastifyInstance): Promise<void> {
  app.post('/contact', async (req, reply) => {
    const input = ContactInput.parse(req.body);

    // Answering 200 to a bot keeps it from learning the honeypot exists.
    if (input.website) return reply.send({ sent: true });

    // A contact form is a free outbound-email button, so it is throttled per
    // IP like every other unauthenticated write on this stack.
    const rl = await checkRateLimit(`contact:${req.ip}`, 5, 900);
    if (!rl.allowed) {
      throw new TooManyRequestsError('Too many messages from this address — try again shortly.', rl.retryAfterSeconds);
    }

    const counter = await settingsService.getCounter();
    const topic = counter.contactTopics.find((t) => t.id === input.topic);
    if (!topic) throw new ValidationError('Pick what your message is about.', 'topic');

    const extras = (['order', 'instagram', 'portfolio', 'company', 'budget'] as const)
      .filter((k) => input[k])
      .map((k) => `${EXTRA_LABELS[k]}: ${input[k]}`)
      .join('\n');

    const body = [
      `Topic: ${topic.label}`,
      `From: ${input.name} <${input.email}>`,
      extras,
      '',
      input.message,
    ].filter(Boolean).join('\n');

    // Ask the mail layer whether ANY transport can send, rather than checking
    // smtpHost. A store sending through Gmail or a Nexus provider has no
    // smtpHost at all, so the old check called a working setup unconfigured
    // and told the sender their message had not been delivered.
    const n = await settingsService.getNotifications();
    const transport = await mailTransport();
    const deliverable = Boolean(n.emailEnabled && transport.ready);
    if (deliverable) {
      await sendEmailTo(topic.email, `[${topic.label}] ${input.name}`, body);
    }

    reply.send({ sent: deliverable, topic: topic.label });
  });

  // Footer newsletter signup.
  //
  // Lives beside /contact because it is the same shape of problem: an
  // unauthenticated public write that sends mail, so it inherits the same
  // honeypot, the same per-IP throttle, and the same "never take the recipient
  // from the request" rule. The address is read from Settings > Notifications.
  app.post('/subscribe', async (req, reply) => {
    const input = SubscribeInput.parse(req.body);
    if (input.website) return reply.send({ ok: true });

    const rl = await checkRateLimit(`subscribe:${req.ip}`, 5, 900);
    if (!rl.allowed) {
      throw new TooManyRequestsError('Too many signups from this address — try again shortly.', rl.retryAfterSeconds);
    }

    const n = await settingsService.getNotifications();
    const to = n.adminEmail;
    const transport = await mailTransport();
    // Say so plainly rather than showing a success message that means nothing.
    // A signup form that silently drops addresses is worse than one that admits
    // it is not wired up.
    if (!to || !n.emailEnabled || !transport.ready) {
      return reply.send({ ok: false, error: 'Signups are not configured yet.' });
    }

    await sendEmailTo(to, 'New newsletter signup', `${input.email}\n\nFrom the site footer signup form.`);
    reply.send({ ok: true });
  });

  // The storefront reads this to build the tab bar. Public because the contact
  // page is public — and it deliberately omits the ADDRESSES, which are the
  // merchant's business and a spam magnet in page source.
  app.get('/contact/topics', async (_req, reply) => {
    const counter = await settingsService.getCounter();
    reply.send({
      topics: counter.contactTopics.map((t) => ({
        id: t.id,
        label: t.label,
        fields: t.fields,
        blurb: t.blurb ?? null,
      })),
    });
  });

  // ── Job applications ─────────────────────────────────────────────────
  //
  // multipart, because the whole point is that someone can attach a CV. The
  // recipient is a CONSTANT, never a form field — same rule as the contact
  // route: a form that carries its own destination is an open relay.
  app.post('/careers/apply', async (req, reply) => {
    if (!req.isMultipart()) throw new ValidationError('Send the application as a form.', 'body');

    const rl = await checkRateLimit(`careers:${req.ip}`, 4, 900);
    if (!rl.allowed) {
      throw new TooManyRequestsError('Too many applications from this address — try again shortly.', rl.retryAfterSeconds);
    }

    const fields: Record<string, string> = {};
    let cv: MailAttachment | null = null;

    for await (const part of req.parts()) {
      if (part.type === 'file') {
        if (part.fieldname !== 'cv') { await part.toBuffer(); continue; }
        const buf = await part.toBuffer();
        if (!buf.length) continue;
        // Checked AFTER reading, because the browser's own size check can be
        // bypassed — the ceiling has to be enforced here to mean anything.
        if (buf.length > CV_MAX_BYTES) {
          throw new ValidationError('That document is over 5MB. Send a link instead, or write a blurb.', 'cv');
        }
        if (part.mimetype && !CV_TYPES.includes(part.mimetype)) {
          throw new ValidationError('Attach a PDF, DOC, DOCX, TXT or RTF.', 'cv');
        }
        // The sender chooses the filename, so it is rebuilt rather than
        // trusted: a name with a path or a second extension in it has no
        // business reaching a mail client.
        const ext = (part.filename || '').toLowerCase().match(/\.(pdf|docx?|txt|rtf)$/)?.[0] ?? '.pdf';
        cv = { filename: `application${ext}`, content: buf, contentType: part.mimetype };
      } else {
        fields[part.fieldname] = String(part.value ?? '').slice(0, 5000);
      }
    }

    const name = (fields.name ?? '').trim();
    const email = (fields.email ?? '').trim();
    const phone = (fields.phone ?? '').trim();
    const link = (fields.link ?? '').trim();
    const about = (fields.about ?? '').trim();
    const role = roleBySlug((fields.roleSlug ?? '').trim());

    if (!name) throw new ValidationError('Add your name.', 'name');
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ValidationError('Add a valid email.', 'email');
    if (!phone) throw new ValidationError('Add a phone number.', 'phone');
    if (!cv && about.length < 20) {
      throw new ValidationError('Attach a document or write a few lines about yourself.', 'about');
    }

    const title = role?.title ?? (fields.role ?? 'General application');
    const body = [
      `Role: ${title}`,
      `Name: ${name}`,
      `Email: ${email}`,
      `Phone: ${phone}`,
      link ? `Work: ${link}` : '',
      '',
      about ? about : '(CV attached)',
    ].filter(Boolean).join('\n');

    const n = await settingsService.getNotifications();
    const transport = await mailTransport();
    const deliverable = Boolean(n.emailEnabled && transport.ready);
    if (!deliverable) {
      // Better to say so than to show a thank-you for something nobody got.
      throw new ValidationError('Applications are not reaching us right now — email ' + CAREERS_INBOX + ' directly.', 'email');
    }
    await sendEmailTo(CAREERS_INBOX, `[Careers] ${title} — ${name}`, body, cv ? [cv] : undefined);
    reply.send({ sent: true, role: title });
  });
}

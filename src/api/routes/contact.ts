import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { settingsService } from '../../services/settings.service.js';
import { mailTransport } from '../../services/notification.service.js';
import { sendEmailTo } from '../../services/notification.service.js';
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
}

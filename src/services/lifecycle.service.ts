import { createHash, randomInt } from 'node:crypto';
import { db } from '../lib/db.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { notificationService } from './notification.service.js';
import { settingsService } from './settings.service.js';
import { messageEmailHtml, offerEmailHtml, codeEmailHtml, welcomeFriendsFamilyHtml } from './emailTemplate.js';
import { esc } from '../site/html.js';

// Lifecycle emails — the TRIGGER LOGIC for the store's relationship touches:
// expiring memberships, post-delivery review requests, abandoned carts, back-
// in-stock alerts, a drop broadcast, the regular (non-member) welcome, and a
// password-reset code.
//
// Every send here is BEST-EFFORT and fire-and-forget: a dead mail transport
// must never fail or slow the operation reporting on it. That is the same
// contract commerceEmail.service and customerAccountService already keep —
// `void notificationService.sendToAddress(...).catch(() => {})` — and it is why
// the sweeps below return a COUNT of what they acted on, not a send result.
//
// Email HTML is composed from the existing branded builders in emailTemplate
// (messageEmailHtml / offerEmailHtml / codeEmailHtml). The shell, the no-widow
// helper and the design tokens all live there; nothing is rebuilt here.

const SITE = process.env.PUBLIC_ORIGIN || '';
const ACCOUNT_URL = `${SITE}/account`;
const CART_URL = `${SITE}/cart`;
const RED = '#e83b3b';
const DAY = 24 * 3600 * 1000;
const HOUR = 3600 * 1000;

// Cart keys are written by cart.service as `counter:cart:<token>`. Kept in sync
// with that prefix — the abandoned-cart sweep scans exactly the keys it writes.
const CART_PREFIX = 'counter:cart:';
const CART_TTL_SECONDS = 7 * 24 * 3600; // matches cart.service's sliding life

const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Local escape for the few raw values that land inside message HTML (names,
// product names). The email builders escape their own structural copy; this
// esc comes from the shared leaf util (full [&<>"']) — the previous local copy
// escaped only &<>, the exact drift the html.ts docstring warns against.

// A placeholder address (a phone-only or unverified-social account) is not a
// real inbox — Customer.email is UNIQUE and non-null, so those paths mint
// synthetic `@phone.local` / `@social.local` addresses. Broadcast and welcome
// mail must skip them rather than bounce into a void.
const isRealEmail = (email: string | null | undefined): email is string =>
  !!email && email.includes('@') && !/\.local$/i.test(email);

const firstName = (name: string | null | undefined): string => {
  const n = (name ?? '').trim().split(/\s+/)[0];
  return n || 'there';
};

const prettyDate = (d: Date | string | null | undefined): string | null => {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
};

// Fire-and-forget send. Never awaited by callers for its result — a failure is
// swallowed so the surrounding sweep/operation is never broken by mail.
function send(to: string, subject: string, text: string, html?: string): void {
  void notificationService.sendToAddress(to, subject, text, html).catch(() => {});
}

// meta is Prisma JSON; normalise the untyped value to a plain object we can read
// and merge without clobbering keys another writer owns.
function metaObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

// ── Payload of the milieu hook this service handles ──────────────────────────
export interface MembershipExpiringPayload {
  customer: { id: string; email: string | null; name: string | null };
  milieu: { name: string };
  expiresAt: Date | string | null;
}

// The cart shape as cart.service persists it, plus the one flag this service
// stamps on it. Declared locally (not imported) so this file owns the extra
// field without widening cart.service's own interface.
interface StoredCart {
  id: string;
  items: unknown[];
  customerEmail?: string | null;
  createdAt: string;
  abandonedNotifiedAt?: string;
}

export const lifecycleService = {
  // ── Membership expiring — hookBus('onMembershipExpiringSoon') handler ──────
  // milieuService.runReminders fires this once per membership (it stamps
  // reminderSentAt so it can't re-fire); all this does is turn the event into
  // a note to the member. Wired via hookBus.on() by the trigger-registration
  // piece — it is deliberately not self-registered on import.
  async onMembershipExpiringSoon(payload: MembershipExpiringPayload): Promise<void> {
    try {
      const to = payload.customer?.email;
      if (!isRealEmail(to)) return;
      const site = await settingsService.getSite();
      const when = prettyDate(payload.expiresAt);
      const milieuName = esc(payload.milieu?.name ?? 'membership');
      const html = messageEmailHtml({
        eyebrow: 'Membership', eyebrowColor: RED,
        heading: 'Your membership is expiring soon.',
        paragraphs: [
          `${esc(firstName(payload.customer.name))},`,
          `Your <strong>${milieuName}</strong> membership ${when ? `expires on <strong>${esc(when)}</strong>` : 'is ending soon'}. `
            + 'Renew to keep your member pricing and first look at every drop.',
          'You can manage it any time from your account.',
        ],
        cta: { label: 'Manage your account', url: ACCOUNT_URL },
        signoff: `<span style="color:#8a8a8a;">&mdash; ${esc(site.siteName)}</span>`,
        preheader: 'Your membership is expiring soon.',
        siteName: site.siteName,
      });
      send(
        to,
        `${site.siteName} - your membership is expiring soon`,
        `Your ${payload.milieu?.name ?? 'membership'} membership ${when ? `expires on ${when}` : 'is ending soon'}.\n`
          + `Renew from your account: ${ACCOUNT_URL}\n\n- ${site.siteName}`,
        html,
      );
    } catch (err) {
      logger.warn({ err }, 'membership-expiring email failed (non-fatal)');
    }
  },

  // ── Post-delivery review request ───────────────────────────────────────────
  // Orders delivered at least 3 days ago (order.status delivered, or a shipment
  // marked delivered) that we have not already asked about, whose buyer has not
  // already reviewed the product. Stamps meta.reviewRequestedAt so it never
  // re-sends. Returns the number of orders emailed.
  async reviewRequestSweep(): Promise<number> {
    const now = Date.now();
    const cutoff = new Date(now - 3 * DAY); // delivered at least this long ago
    const floor = new Date(now - 30 * DAY); // don't chase ancient history
    let count = 0;

    const orders = await db.order.findMany({
      where: {
        OR: [
          { status: 'delivered', updatedAt: { gte: floor, lte: cutoff } },
          { shipments: { some: { status: 'delivered', deliveredAt: { not: null, gte: floor, lte: cutoff } } } },
        ],
      },
      orderBy: { updatedAt: 'asc' },
      take: 200, // bound each sweep; the stamp guarantees forward progress
      include: {
        customer: { select: { id: true, email: true, name: true } },
        items: { include: { variant: { include: { product: { select: { id: true, name: true, slug: true } } } } } },
      },
    });

    for (const order of orders) {
      try {
        const meta = metaObject((order as { meta?: unknown }).meta);
        if (meta.reviewRequestedAt) continue; // already asked

        const to = order.guestEmail ?? order.customer?.email ?? null;
        if (!isRealEmail(to)) continue;

        // Distinct products in the order.
        const products = new Map<string, { id: string; name: string; slug: string }>();
        for (const it of order.items) {
          const p = it.variant?.product;
          if (p) products.set(p.id, { id: p.id, name: p.name, slug: p.slug });
        }
        if (products.size === 0) continue;

        // Which of them the buyer has already reviewed (by account or by the
        // email on the order) — matching reviewService's own verified-owner
        // logic of guest-email OR customer.
        const reviewed = await db.productReview.findMany({
          where: {
            productId: { in: [...products.keys()] },
            OR: [
              ...(order.customerId ? [{ customerId: order.customerId }] : []),
              { reviewerEmail: to.toLowerCase() },
            ],
          },
          select: { productId: true },
        });
        const reviewedSet = new Set(reviewed.map((r) => r.productId));
        const pending = [...products.values()].filter((p) => !reviewedSet.has(p.id));
        if (pending.length === 0) continue; // nothing left to ask about

        const site = await settingsService.getSite();
        const feature = pending[0]!; // guarded: pending.length checked above
        const more = pending.length > 1 ? ` and the rest of your order` : '';
        const html = messageEmailHtml({
          eyebrow: 'Your order', eyebrowColor: RED,
          heading: 'How did we do?',
          paragraphs: [
            `${esc(firstName(order.customer?.name))},`,
            `Your order landed a few days ago. We would love to hear how <strong>${esc(feature.name)}</strong>${more} is treating you.`,
            'A quick review helps the next person shop with confidence &mdash; and it means a lot to us.',
          ],
          cta: { label: 'Write a review', url: `${SITE}/product/${encodeURIComponent(feature.slug)}` },
          preheader: `How is your ${feature.name}?`,
          siteName: site.siteName,
        });
        send(
          to,
          `${site.siteName} - how is your order?`,
          `We'd love to hear how ${feature.name}${more} is treating you.\n`
            + `Leave a review: ${SITE}/product/${feature.slug}\n\n- ${site.siteName}`,
          html,
        );

        // Merge the stamp into whatever else lives on meta, so a concurrent
        // writer's keys survive.
        await db.order.update({
          where: { id: order.id },
          data: { meta: { ...meta, reviewRequestedAt: new Date().toISOString() } },
        });
        count += 1;
      } catch (err) {
        logger.warn({ err, orderId: order.id }, 'review-request email failed (non-fatal)');
      }
    }
    return count;
  },

  // ── Abandoned cart ─────────────────────────────────────────────────────────
  // Scans the Redis cart keyspace for carts that have items, a contact email,
  // are older than ~2h, and have not already been nudged — then sends a "you
  // left something" note and stamps the cart so it is nudged at most once.
  // Carts that already became an order are skipped. Returns the number nudged.
  async abandonedCartSweep(): Promise<number> {
    const now = Date.now();
    let count = 0;
    let cursor = '0';
    let guard = 0; // hard ceiling on SCAN iterations, so a churning keyspace can't loop us forever

    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${CART_PREFIX}*`, 'COUNT', 200);
      cursor = next;
      for (const cartKey of keys) {
        try {
          const raw = await redis.get(cartKey);
          if (!raw) continue;
          let cart: StoredCart;
          try {
            cart = JSON.parse(raw) as StoredCart;
          } catch {
            continue; // corrupt value — cart.service treats this as an expired cart
          }
          if (!cart || !Array.isArray(cart.items) || cart.items.length === 0) continue;
          if (!isRealEmail(cart.customerEmail)) continue;
          if (cart.abandonedNotifiedAt) continue; // already nudged
          const created = Date.parse(cart.createdAt);
          if (!Number.isFinite(created) || now - created < 2 * HOUR) continue; // too fresh

          // Skip if the cart already checked out. cart.service clears the key on
          // checkout, so a live key usually means "not ordered" — but confirm
          // against the order the cart token would have keyed, in case the clear
          // raced or was replayed.
          const ordered = await db.order.findFirst({
            where: { idempotencyKey: `cart_${cart.id}` },
            select: { id: true },
          });
          if (ordered) continue;

          const site = await settingsService.getSite();
          const html = messageEmailHtml({
            eyebrow: 'Your cart', eyebrowColor: RED,
            heading: 'You left something behind.',
            paragraphs: [
              'Your cart is still here, holding what you picked out.',
              'We saved it for you &mdash; pick up right where you left off before it sells out.',
            ],
            cta: { label: 'Return to your cart', url: CART_URL },
            ctaNote: `or visit ${SITE}/cart`,
            preheader: 'Your cart is still waiting.',
            siteName: site.siteName,
          });
          send(
            cart.customerEmail,
            `You left something in your cart`,
            `Your cart is still waiting for you.\nPick up where you left off: ${CART_URL}\n\n- ${site.siteName}`,
            html,
          );

          // Stamp the flag back onto the SAME cart JSON, preserving its remaining
          // TTL so nudging never resets a cart's sliding expiry.
          cart.abandonedNotifiedAt = new Date().toISOString();
          const pttl = await redis.pttl(cartKey);
          if (pttl > 0) {
            await redis.set(cartKey, JSON.stringify(cart), 'PX', pttl);
          } else {
            await redis.set(cartKey, JSON.stringify(cart), 'EX', CART_TTL_SECONDS);
          }
          count += 1;
        } catch (err) {
          logger.warn({ err, cartKey }, 'abandoned-cart email failed (non-fatal)');
        }
      }
      guard += 1;
    } while (cursor !== '0' && guard < 10_000);

    return count;
  },

  // ── Back in stock ──────────────────────────────────────────────────────────
  // A variant just came back into stock: notify everyone still subscribed and
  // mark them notified so the alert fires once. Returns the number notified.
  async notifyBackInStock(variantId: string): Promise<number> {
    const subs = await db.backInStockSubscription.findMany({
      where: { variantId, notifiedAt: null },
      select: { id: true, email: true },
    });
    if (subs.length === 0) return 0;

    const variant = await db.productVariant.findUnique({
      where: { id: variantId },
      include: { product: { select: { name: true, slug: true, image: true } } },
    });
    const product = variant?.product;
    if (!product) return 0;

    const site = await settingsService.getSite();
    const url = `${SITE}/product/${encodeURIComponent(product.slug)}`;
    const html = offerEmailHtml({
      heroImg: product.image ?? undefined,
      eyebrow: 'Back in stock',
      heading: `${esc(product.name)} is back.`,
      body: 'It sold out once already. These do not tend to hang around &mdash; grab yours before it goes again.',
      productName: product.name,
      badge: 'Restocked',
      cta: { label: 'Shop it now', url },
      siteName: site.siteName,
    });
    const subject = `${product.name} is back in stock`;
    const text = `${product.name} is back in stock.\nShop it: ${url}\n\n- ${site.siteName}`;

    // Mark notified BEFORE (well, immediately after queuing) so a second run
    // that overlaps this one cannot double-send. The send itself is fire-and-
    // forget, so the mark is the real idempotency guard, not the mail result.
    for (const sub of subs) {
      if (isRealEmail(sub.email)) send(sub.email, subject, text, html);
    }
    await db.backInStockSubscription.updateMany({
      where: { id: { in: subs.map((s) => s.id) }, notifiedAt: null },
      data: { notifiedAt: new Date() },
    });
    return subs.length;
  },

  // ── Drop broadcast ─────────────────────────────────────────────────────────
  // Announce a new drop to every customer with a real inbox. Batched with a
  // small gap between batches so a burst of sends does not hammer the transport.
  // Returns the number of recipients queued.
  async dropBroadcast(input: { title: string; blurb: string; productSlug: string; heroImg?: string }): Promise<number> {
    const customers = await db.customer.findMany({ select: { email: true } });
    const recipients = customers.map((c) => c.email).filter(isRealEmail);
    if (recipients.length === 0) return 0;

    const site = await settingsService.getSite();
    const url = `${SITE}/product/${encodeURIComponent(input.productSlug)}`;
    // Identical to every recipient, so build the HTML once and reuse it.
    const html = offerEmailHtml({
      heroImg: input.heroImg,
      eyebrow: 'New drop',
      heading: input.title,
      body: input.blurb,
      badge: 'Just dropped',
      cta: { label: 'Shop the drop', url },
      siteName: site.siteName,
    });
    const subject = input.title;
    const text = `${input.title}\n\n${input.blurb}\n\nShop it: ${url}\n\n- ${site.siteName}`;

    const BATCH = 40;
    for (let i = 0; i < recipients.length; i += BATCH) {
      for (const to of recipients.slice(i, i + BATCH)) send(to, subject, text, html);
      if (i + BATCH < recipients.length) await sleep(300);
    }
    return recipients.length;
  },

  // ── Regular (non-member) welcome ───────────────────────────────────────────
  // Welcomes a brand-new customer, UNLESS they are an active member of any
  // milieu — those get the Friends & Family welcome instead, so we must not
  // double-welcome them with the plain one.
  async sendRegularWelcome(customerId: string): Promise<void> {
    try {
      const customer = await db.customer.findUnique({
        where: { id: customerId },
        select: { email: true, name: true },
      });
      if (!customer || !isRealEmail(customer.email)) return;

      // Active membership = not pending, and either permanent or not yet
      // expired. Same predicate milieuService.discountFor uses for "benefits
      // apply now".
      const now = new Date();
      const member = await db.milieuMembership.findFirst({
        where: {
          customerId,
          pendingAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        select: { id: true },
      });
      if (member) return; // gets the F&F welcome instead

      const site = await settingsService.getSite();
      const html = messageEmailHtml({
        eyebrow: 'Welcome',
        heading: `Welcome to ${esc(site.siteName)}.`,
        paragraphs: [
          `${esc(firstName(customer.name))},`,
          'Thanks for joining us. Your account is ready &mdash; your orders, tracking and anything we save for you all live in one place.',
          'Have a look around. We are glad you are here.',
        ],
        cta: { label: 'Start shopping', url: SITE },
        signoff: `<span style="color:#8a8a8a;">&mdash; ${esc(site.siteName)}</span>`,
        preheader: `Welcome to ${site.siteName}.`,
        siteName: site.siteName,
      });
      send(
        customer.email,
        `Welcome to ${site.siteName}`,
        `Thanks for joining ${site.siteName}. Your account is ready: ${ACCOUNT_URL}\n\n- ${site.siteName}`,
        html,
      );
    } catch (err) {
      logger.warn({ err, customerId }, 'welcome email failed (non-fatal)');
    }
  },

  // ── Password reset code ────────────────────────────────────────────────────
  // Issues a reset code the same way customerAuth issues its login codes — a
  // 6-digit code, stored HASHED with a 10-minute TTL in customer_auth_codes —
  // and mails it. The verify half (consume the code, set the new password) is
  // added alongside this by the customerAuth edits piece; it reads the same
  // row. Never reveals whether an account exists: a miss returns silently.
  // Friends & Family welcome — the counterpart sendRegularWelcome deliberately
  // skips active members "because they get the F&F welcome instead," but nothing
  // sent it, so members got no welcome at all. This is that email. NOT auto-fired
  // on milieu assign: the owner controls timing (some F&F accounts are created
  // before the invite goes out). Reachable via
  // POST /counter/customers/:id/friends-family-welcome.
  async sendFriendsFamilyWelcome(customerId: string): Promise<void> {
    try {
      const customer = await db.customer.findUnique({ where: { id: customerId }, select: { email: true, name: true } });
      if (!customer || !isRealEmail(customer.email)) return;
      const site = await settingsService.getSite();
      send(customer.email, 'Welcome to Friends & Family', "You're in — welcome to Friends & Family.", welcomeFriendsFamilyHtml(firstName(customer.name), site.siteName));
    } catch { /* the mail transport logs its own failures */ }
  },

  async sendPasswordResetCode(email: string): Promise<void> {
    try {
      const destination = String(email ?? '').trim().toLowerCase();
      if (!isRealEmail(destination)) return;
      // Only issue for a real account. We do not create one here, and we do not
      // tell the caller either way (this returns void) — no enumeration oracle.
      const customer = await db.customer.findFirst({ where: { email: destination }, select: { id: true } });
      if (!customer) return;

      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      await db.customerAuthCode.create({
        data: {
          destination,
          kind: 'email',
          codeHash: sha256(code),
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
      });

      const site = await settingsService.getSite();
      const html = codeEmailHtml({
        code,
        heading: 'Reset your password.',
        intro: 'Enter this code to reset your password. It expires in 10 minutes.',
        siteName: site.siteName,
      });
      send(
        destination,
        `Reset your ${site.siteName} password`,
        `Your ${site.siteName} password reset code is ${code}. It expires in 10 minutes.\n\n`
          + `If you did not request this, you can ignore this email.`,
        html,
      );
    } catch (err) {
      logger.warn({ err }, 'password-reset email failed (non-fatal)');
    }
  },
};

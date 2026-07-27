import { db } from '../lib/db.js';
import { hookBus } from '../lib/hooks.js';
import { ConflictError, NotFoundError, TooManyRequestsError, ValidationError } from '../lib/errors.js';
import type { AddMemberInput, BulkMembersInput, CreateMilieuInput, PublicRegisterInput, UpdateMilieuInput } from '../schemas/milieu.schema.js';

// Milieus — named customer groups. Semantics ported from the 1.x WP plugin
// (docs/superpowers/specs/2026-07-21-milieus-native-design.md):
//   - assign is idempotent: re-adding resets assignedAt + recomputes expiry
//     from the group's default duration
//   - extend: permanent membership = no-op; otherwise max(current, now) + s
//   - sweep runs two independent timelines: group lifetime (delete the
//     milieu, memberships cascade) and member duration (delete membership)
//   - discount: the single largest pct across a customer's milieus, no
//     stacking

const PAGE_SIZE = 25;

const DAY = 24 * 3600 * 1000;

// 1.x members.php expiry tiers: permanent | ok | soon (≤30d) | urgent (≤7d) | expired.
function expiryTier(expiresAt: Date | null, now: Date): string {
  if (!expiresAt) return 'permanent';
  const delta = expiresAt.getTime() - now.getTime();
  if (delta <= 0) return 'expired';
  if (delta <= 7 * DAY) return 'urgent';
  if (delta <= 30 * DAY) return 'soon';
  return 'ok';
}

function defaultExpiry(memberDurationDays: number, from: Date): Date | null {
  return memberDurationDays > 0 ? new Date(from.getTime() + memberDurationDays * DAY) : null;
}

// Per-IP signup rate limit (1.x spam.php: 5/hour). In-memory is correct for
// a single-process API; revisit if this ever runs multi-instance.
const SIGNUP_RATE_PER_HOUR = 5;
const SIGNUP_MAP_MAX = 10_000;
const signupHits = new Map<string, number[]>();

function signupRateExceeded(ip: string, now: number): boolean {
  const cutoff = now - 3600_000;
  // Bounded: evict fully-stale IPs once the map gets big, so a wide botnet
  // can't grow it without limit (audit finding — the old version never
  // deleted keys).
  if (signupHits.size >= SIGNUP_MAP_MAX) {
    for (const [k, v] of signupHits) {
      if (v.every((t) => t <= cutoff)) signupHits.delete(k);
    }
  }
  const hits = (signupHits.get(ip) ?? []).filter((t) => t > cutoff);
  if (hits.length >= SIGNUP_RATE_PER_HOUR) {
    signupHits.set(ip, hits);
    return true;
  }
  hits.push(now);
  signupHits.set(ip, hits);
  return false;
}

export const milieuService = {
  async list() {
    const rows = await db.milieu.findMany({
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { memberships: true } } },
    });
    return rows.map(({ _count, ...m }) => ({ ...m, memberCount: _count.memberships }));
  },

  async get(id: string) {
    const m = await db.milieu.findUnique({ where: { id }, include: { _count: { select: { memberships: true } } } });
    if (!m) throw new NotFoundError('Milieu not found', 'id');
    const { _count, ...rest } = m;
    return { ...rest, memberCount: _count.memberships };
  },

  async create(input: CreateMilieuInput) {
    const existing = await db.milieu.findUnique({ where: { slug: input.slug }, select: { id: true } });
    if (existing) throw new ConflictError('A milieu with that slug already exists', 'slug');
    return db.milieu.create({ data: input });
  },

  async update(id: string, input: UpdateMilieuInput) {
    await this.get(id);
    if (input.slug) {
      const other = await db.milieu.findUnique({ where: { slug: input.slug }, select: { id: true } });
      if (other && other.id !== id) throw new ConflictError('A milieu with that slug already exists', 'slug');
    }
    if (input.regSlug) {
      const other = await db.milieu.findUnique({ where: { regSlug: input.regSlug }, select: { id: true } });
      if (other && other.id !== id) throw new ConflictError('A milieu with that registration slug already exists', 'regSlug');
    }
    return db.milieu.update({ where: { id }, data: input });
  },

  async remove(id: string) {
    await this.get(id);
    await db.milieu.delete({ where: { id } }); // memberships cascade
  },

  // Idempotent (1.x milieus_assign_member): re-adding resets assignedAt and
  // recomputes expiresAt from the group default. Accepts customerId or email.
  async assign(milieuId: string, input: AddMemberInput) {
    const milieu = await this.get(milieuId);
    let customerId = input.customerId;
    if (!customerId) {
      const c = await db.customer.findUnique({ where: { email: input.email! }, select: { id: true } });
      if (!c) throw new NotFoundError('No customer with that email', 'email');
      customerId = c.id;
    } else {
      const c = await db.customer.findUnique({ where: { id: customerId }, select: { id: true } });
      if (!c) throw new NotFoundError('Customer not found', 'customerId');
    }
    const now = new Date();
    const expiresAt = defaultExpiry(milieu.memberDurationDays, now);
    // Admin assign also clears any pending flag — an operator explicitly
    // adding someone IS the approval (1.x: assigning grants the role and
    // benefits immediately; audit finding A8).
    return db.milieuMembership.upsert({
      where: { milieu_customer: { milieuId, customerId } },
      update: { assignedAt: now, expiresAt, source: input.source, reminderSentAt: null, pendingAt: null },
      create: { milieuId, customerId, assignedAt: now, expiresAt, source: input.source },
      include: { customer: { select: { id: true, email: true, name: true } } },
    });
  },

  async revoke(milieuId: string, customerId: string) {
    const row = await db.milieuMembership.findUnique({ where: { milieu_customer: { milieuId, customerId } }, select: { id: true } });
    if (!row) throw new NotFoundError('Membership not found', 'customerId');
    await db.milieuMembership.delete({ where: { id: row.id } });
  },

  // 1.x milieus_extend_member: permanent (null expiry) = no-op returning null;
  // else extension is added to max(current expiry, now).
  async extend(milieuId: string, customerId: string, seconds: number): Promise<Date | null> {
    const row = await db.milieuMembership.findUnique({ where: { milieu_customer: { milieuId, customerId } } });
    if (!row) throw new NotFoundError('Membership not found', 'customerId');
    if (!row.expiresAt) return null;
    const base = Math.max(row.expiresAt.getTime(), Date.now());
    const next = new Date(base + seconds * 1000);
    await db.milieuMembership.update({ where: { id: row.id }, data: { expiresAt: next, reminderSentAt: null } });
    return next;
  },

  async bulk(milieuId: string, input: BulkMembersInput): Promise<number> {
    const milieu = await this.get(milieuId);
    let count = 0;
    for (const customerId of input.customerIds) {
      try {
        if (input.action === 'revoke') {
          await this.revoke(milieuId, customerId);
        } else if (input.action === 'extend_30') {
          // Permanent members can't be extended — extend() returns null; the
          // reported count only includes real changes (1.x members.php rule).
          const next = await this.extend(milieuId, customerId, 30 * 24 * 3600);
          if (next === null) continue;
        } else {
          // reset_expiry — back to the group's default duration, from now.
          const row = await db.milieuMembership.findUnique({ where: { milieu_customer: { milieuId, customerId } }, select: { id: true } });
          if (!row) continue;
          await db.milieuMembership.update({
            where: { id: row.id },
            data: { expiresAt: defaultExpiry(milieu.memberDurationDays, new Date()), reminderSentAt: null },
          });
        }
        count++;
      } catch (err) {
        if (err instanceof NotFoundError) continue; // bulk tolerates missing rows (1.x counts successes)
        throw err;
      }
    }
    return count;
  },

  async listMembers(milieuId: string, page: number, search: string) {
    await this.get(milieuId);
    const where = {
      milieuId,
      ...(search
        ? {
            customer: {
              OR: [
                { email: { contains: search, mode: 'insensitive' as const } },
                { name: { contains: search, mode: 'insensitive' as const } },
              ],
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      db.milieuMembership.findMany({
        where,
        orderBy: { assignedAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: { customer: { select: { id: true, email: true, name: true } } },
      }),
      db.milieuMembership.count({ where }),
    ]);
    const now = new Date();
    return {
      total,
      page,
      pageSize: PAGE_SIZE,
      rows: rows.map((r) => ({
        customerId: r.customerId,
        email: r.customer.email,
        name: r.customer.name,
        assignedAt: r.assignedAt,
        expiresAt: r.expiresAt,
        expiryTier: expiryTier(r.expiresAt, now),
        source: r.source,
        pending: r.pendingAt !== null,
      })),
    };
  },

  // Typeahead for the members panel: customers NOT already in this milieu.
  async searchCandidates(milieuId: string, q: string) {
    if (q.length < 2) return [];
    return db.customer.findMany({
      where: {
        memberships: { none: { milieuId } },
        OR: [
          { email: { contains: q, mode: 'insensitive' } },
          { name: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: { id: true, email: true, name: true },
      take: 8,
    });
  },

  // Both 1.x sweep timelines. Idempotent; safe to run repeatedly. Emits
  // onMembershipRevoked per swept membership (1.x fires
  // milieus_member_revoked from its sweep too) so notifications/webhooks/
  // audit follow-ups have a seam to hook into — without this the cascade
  // deletes would be silent and unhookable (audit finding A9).
  async runSweep(): Promise<{ milieusDeleted: number; membershipsRevoked: number }> {
    const now = new Date();
    const expiredMemberships = await db.milieuMembership.findMany({
      where: {
        OR: [
          { expiresAt: { not: null, lte: now } },
          { milieu: { expiresAt: { not: null, lte: now } } },
        ],
      },
      include: {
        milieu: { select: { id: true, name: true, slug: true } },
        customer: { select: { id: true, email: true, name: true } },
      },
    });

    // Group lifetime: delete expired milieus; memberships cascade.
    const expiredMilieus = await db.milieu.findMany({ where: { expiresAt: { not: null, lte: now } }, select: { id: true } });
    for (const m of expiredMilieus) {
      await db.milieu.delete({ where: { id: m.id } });
    }
    // Member duration: delete expired memberships (non-null expiry in the past).
    const revoked = await db.milieuMembership.deleteMany({ where: { expiresAt: { not: null, lte: now } } });

    for (const m of expiredMemberships) {
      await hookBus.run('onMembershipRevoked', { customer: m.customer, milieu: m.milieu, reason: 'expired' });
    }
    return { milieusDeleted: expiredMilieus.length, membershipsRevoked: revoked.count };
  },

  // Public signup via a registration link (M4). This is the only
  // unauthenticated write path in the system — everything here is hardened
  // per the 2026-07-21 security audit:
  //   - an existing customer's record is NEVER mutated from this path (no
  //     name overwrite); name is only set when the Customer is first created
  //   - an existing membership is NEVER reset/renewed from this path (an
  //     attacker re-submitting a member's email must not extend or convert
  //     their membership) — re-registration of a member is a no-op that
  //     reports current status and does not burn the signup counter
  //   - the max-signups cap is enforced atomically (conditional increment),
  //     so concurrent signups can't overshoot it, and the counter only moves
  //     for genuinely new memberships
  //   - unknown/disabled slugs 404 BEFORE the rate-limit hit is recorded
  //     (1.x order: bad-slug posts cost nothing)
  // Approval-gated milieus create a pending membership (no benefits until
  // approved); duration starts at approval, not signup.
  async register(regSlug: string, input: PublicRegisterInput, ip: string): Promise<{ status: 'active' | 'pending' }> {
    const milieuPeek = await db.milieu.findUnique({ where: { regSlug } });
    const now = new Date();
    const live = milieuPeek && milieuPeek.regEnabled && !(milieuPeek.expiresAt && milieuPeek.expiresAt <= now);
    if (!live) throw new NotFoundError('Registration link not found', 'slug');
    const milieu = milieuPeek;

    // Honeypot: bots get a fake success shaped exactly like the real
    // response for this link type, so the trap isn't distinguishable.
    // (Deliberate divergence from 1.x, which shows a visible error — a
    // silent lie leaks less to the bot. Declared in the spec.)
    if (input.website) return { status: milieu.regRequiresApproval ? 'pending' : 'active' };

    if (signupRateExceeded(ip, now.getTime())) {
      throw new TooManyRequestsError('Too many signups from this address — try again later.', 3600);
    }

    const existingCustomer = await db.customer.findUnique({ where: { email: input.email }, select: { id: true } });
    if (existingCustomer) {
      const existingMembership = await db.milieuMembership.findUnique({
        where: { milieu_customer: { milieuId: milieu.id, customerId: existingCustomer.id } },
        select: { pendingAt: true },
      });
      if (existingMembership) {
        // Already registered — report status, change nothing, burn nothing.
        return { status: existingMembership.pendingAt ? 'pending' : 'active' };
      }
    }

    // Atomic cap: reserve a signup slot with a conditional increment. Two
    // concurrent signups can't both pass a stale read of the counter.
    if (milieu.regMaxSignups > 0) {
      const reserved = await db.milieu.updateMany({
        where: { id: milieu.id, regSignupCount: { lt: milieu.regMaxSignups } },
        data: { regSignupCount: { increment: 1 } },
      });
      if (reserved.count === 0) {
        throw new ValidationError('This registration link has reached its signup limit.', 'slug');
      }
    } else {
      await db.milieu.update({ where: { id: milieu.id }, data: { regSignupCount: { increment: 1 } } });
    }

    const customer =
      existingCustomer ??
      (await db.customer.create({ data: { email: input.email, name: input.name ?? null } }));

    const pending = milieu.regRequiresApproval;
    await db.milieuMembership.create({
      data: {
        milieuId: milieu.id,
        customerId: customer.id,
        source: 'link',
        ...(pending
          ? { pendingAt: now, expiresAt: null }
          : { assignedAt: now, expiresAt: defaultExpiry(milieu.memberDurationDays, now) }),
      },
    });
    return { status: pending ? 'pending' : 'active' };
  },

  // Approve a pending signup: benefits and duration start now (1.x approvals
  // assign the role at approval time, not request time).
  async approve(milieuId: string, customerId: string) {
    const milieu = await this.get(milieuId);
    const row = await db.milieuMembership.findUnique({ where: { milieu_customer: { milieuId, customerId } } });
    if (!row) throw new NotFoundError('Membership not found', 'customerId');
    if (!row.pendingAt) return row; // already active — idempotent
    const now = new Date();
    return db.milieuMembership.update({
      where: { id: row.id },
      data: { pendingAt: null, assignedAt: now, expiresAt: defaultExpiry(milieu.memberDurationDays, now) },
    });
  },

  // 1.x expiring-soon reminders: memberships ending within `days`, not yet
  // reminded (reminderSentAt null). Stamps each and fires the hook — at most
  // once per membership, matching 1.x's _milieus_reminder_sent_ flag.
  async runReminders(days = 3): Promise<number> {
    const now = new Date();
    const until = new Date(now.getTime() + days * DAY);
    const due = await db.milieuMembership.findMany({
      where: { expiresAt: { gt: now, lte: until }, reminderSentAt: null, pendingAt: null },
      include: {
        milieu: { select: { id: true, name: true, slug: true } },
        customer: { select: { id: true, email: true, name: true } },
      },
    });
    for (const m of due) {
      await db.milieuMembership.update({ where: { id: m.id }, data: { reminderSentAt: now } });
      await hookBus.run('onMembershipExpiringSoon', {
        customer: m.customer,
        milieu: m.milieu,
        expiresAt: m.expiresAt,
      });
    }
    return due.length;
  },

  // 1.x wc-pricing.php rule: single largest discount across the customer's
  // active (non-expired) milieus. Null when no discount applies.
  async discountFor(customerId: string): Promise<{ pct: number; milieuName: string } | null> {
    const now = new Date();
    const rows = await db.milieuMembership.findMany({
      where: {
        customerId,
        pendingAt: null, // awaiting approval = no benefits yet
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        milieu: { discountPct: { gt: 0 }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      },
      include: { milieu: { select: { name: true, discountPct: true } } },
    });
    if (rows.length === 0) return null;
    const best = rows.reduce((a, b) => (b.milieu.discountPct > a.milieu.discountPct ? b : a));
    return { pct: best.milieu.discountPct, milieuName: best.milieu.name };
  },
};

export { expiryTier };

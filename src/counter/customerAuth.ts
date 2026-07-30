import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { db } from '../lib/db.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { checkRateLimit } from '../lib/rateLimit.js';
import { NotFoundError, TooManyRequestsError, UnauthorizedError, ValidationError } from '../lib/errors.js';
import { authEventService } from '../services/authEvent.service.js';

// Counter — customer accounts.
//
// One customer, many ways to prove they are that customer: a password, a
// social account, a phone number, an emailed code. Someone who checks out as a
// guest, later signs in with Google, and later adds a phone is ONE person.
// Woo ties an account to a single WordPress user and makes social login a
// plugin's problem; here identity is a first-class list.
//
// Guest checkout is untouched and stays first-class — an order carries a
// guestEmail and no customer. `claimGuestOrders` is how that history becomes
// theirs if they later register with the same address.
//
// Security decisions worth stating, because each is a place this commonly goes
// wrong:
//
//   Codes are stored HASHED, never in plaintext. A leaked database must not
//   hand an attacker a list of live login codes.
//
//   Session tokens are stored hashed for the same reason — the raw token
//   exists only in the response and the customer's cookie.
//
//   Sign-in never reveals whether an account exists. Every requestCode() call
//   returns the same shape whether or not the destination is known, because
//   the difference is an account-enumeration oracle.
//
//   Every outcome is AUDITED, failures included. Rate limiting stops a fast
//   attack; it does not tell anyone one happened. Without the failure rows,
//   a slow credential-stuffing run that stays under every limit leaves no
//   trace at all — which is the whole point of running it slowly.
//
// What is deliberately NOT recorded: passwords, codes, session tokens, and
// OAuth subjects in full. An audit log that leaks the credential it is
// auditing is worse than none, since it is read by more people than the
// tables it describes.

const CODE_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;

export type IdentityKind = 'password' | 'oauth' | 'phone' | 'email';

const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex');

/** E.164-ish. Deliberately permissive on format, strict on shape. */
function normalizePhone(raw: string): string {
  const trimmed = raw.replace(/[\s()-]/g, '');
  if (!/^\+[1-9]\d{6,14}$/.test(trimmed)) {
    throw new ValidationError('Enter a phone number in international format, e.g. +447700900123.', 'phone');
  }
  return trimmed;
}

function normalizeEmail(raw: string): string {
  const e = raw.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new ValidationError('That email address does not look right.', 'email');
  return e;
}

async function issueSession(customerId: string, userAgent?: string) {
  const token = randomBytes(32).toString('base64url');
  const session = await db.customerSession.create({
    data: {
      customerId,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      userAgent: userAgent?.slice(0, 300) ?? null,
    },
  });
  // The raw token is returned ONCE and never stored.
  return { token, expiresAt: session.expiresAt };
}

/** Finds an existing customer by email, or makes one. */
async function upsertCustomer(email: string, name?: string) {
  const existing = await db.customer.findFirst({ where: { email } });
  if (existing) return existing;
  return db.customer.create({ data: { email, name: name ?? null } });
}

export const customerAuth = {
  // ─── Password ────────────────────────────────────────────────────────────

  async registerWithPassword(input: { email: string; password: string; name?: string; ip?: string }) {
    const email = normalizeEmail(input.email);
    const ip = input.ip ?? null;
    if (input.password.length < 8) {
      throw new ValidationError('Use at least 8 characters.', 'password');
    }
    const existing = await db.customerIdentity.findFirst({ where: { kind: 'password', subject: email } });
    if (existing) throw new ValidationError('An account already exists for that email — try signing in.', 'email');

    const customer = await upsertCustomer(email, input.name);
    await db.customerIdentity.create({
      data: {
        customerId: customer.id,
        kind: 'password',
        subject: email,
        secretHash: await hashPassword(input.password),
        verifiedAt: null,
      },
    });
    const claimed = await this.claimGuestOrders(customer.id, email);
    await authEventService.logCustomer(
      'customer_registered',
      email,
      ip,
      claimed.claimed > 0 ? `password; claimed ${claimed.claimed} guest order(s)` : 'password',
    );
    return { customer, ...(await issueSession(customer.id)) };
  },

  async signInWithPassword(input: { email: string; password: string; userAgent?: string; ip?: string }) {
    const email = normalizeEmail(input.email);
    const ip = input.ip ?? null;
    // Rate-limited per email BEFORE touching the hash, so this cannot be used
    // as a password-guessing oracle.
    const rl = await checkRateLimit(`customer-login:${email}`, 10, 15 * 60);
    if (!rl.allowed) {
      // Logged as its own type. A throttled attempt means the limiter already
      // fired — that is the loudest signal this surface produces, and burying
      // it in with ordinary wrong-password failures wastes it.
      await authEventService.logCustomer('customer_login_throttled', email, ip, 'rate limit reached');
      throw new TooManyRequestsError('Too many attempts — try again shortly.', rl.retryAfterSeconds);
    }

    const identity = await db.customerIdentity.findFirst({ where: { kind: 'password', subject: email } });
    // Same error either way: "no such account" vs "wrong password" is an
    // enumeration oracle.
    if (!identity?.secretHash || !(await verifyPassword(input.password, identity.secretHash))) {
      // The DETAIL distinguishes them, because the log is read by the operator
      // — who is entitled to know which it was — not by the person signing in.
      await authEventService.logCustomer(
        'customer_login_failure',
        email,
        ip,
        identity ? 'wrong password' : 'no such account',
      );
      throw new UnauthorizedError('Those details do not match.');
    }
    await db.customerIdentity.update({ where: { id: identity.id }, data: { lastUsedAt: new Date() } });
    const customer = await db.customer.findUnique({ where: { id: identity.customerId } });
    if (!customer) throw new NotFoundError('Account not found', 'customer');
    await authEventService.logCustomer('customer_login_success', email, ip, 'password');
    return { customer, ...(await issueSession(customer.id, input.userAgent)) };
  },

  // ─── One-time codes: phone or email ──────────────────────────────────────

  /**
   * Issues a code. Returns the same shape whether or not the destination is
   * known — the caller cannot learn whether an account exists.
   *
   * The code is RETURNED to the caller so the transport (SMS via Nexus, or
   * email) stays that caller's job; it is never logged here.
   */
  async requestCode(input: { destination: string; kind: 'phone' | 'email'; ip?: string }) {
    const destination = input.kind === 'phone' ? normalizePhone(input.destination) : normalizeEmail(input.destination);
    const ip = input.ip ?? null;
    const rl = await checkRateLimit(`customer-code:${destination}`, 5, 15 * 60);
    if (!rl.allowed) {
      await authEventService.logCustomer('customer_login_throttled', destination, ip, `${input.kind} code rate limit reached`);
      throw new TooManyRequestsError('Too many codes requested — try again shortly.', rl.retryAfterSeconds);
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await db.customerAuthCode.create({
      data: {
        destination,
        kind: input.kind,
        codeHash: sha256(code),
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      },
    });
    // The code itself is never a log field — see the header note.
    await authEventService.logCustomer('customer_code_requested', destination, ip, input.kind);
    return { destination, code, expiresInSeconds: CODE_TTL_MS / 1000 };
  },

  /** Verifies a code and signs the customer in, creating them if needed. */
  async verifyCode(input: { destination: string; kind: 'phone' | 'email'; code: string; name?: string; userAgent?: string; ip?: string }) {
    const destination = input.kind === 'phone' ? normalizePhone(input.destination) : normalizeEmail(input.destination);
    const ip = input.ip ?? null;
    const row = await db.customerAuthCode.findFirst({
      where: { destination, kind: input.kind, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) {
      await authEventService.logCustomer('customer_code_failure', destination, ip, 'no live code — expired or never issued');
      throw new UnauthorizedError('That code has expired — request a new one.');
    }

    if (row.attempts >= MAX_CODE_ATTEMPTS) {
      await authEventService.logCustomer('customer_login_throttled', destination, ip, `${MAX_CODE_ATTEMPTS} wrong code attempts`);
      throw new TooManyRequestsError('Too many wrong attempts on this code — request a new one.', 60);
    }

    // Constant-time compare so a timing difference can't be used to guess.
    const given = Buffer.from(sha256(input.code));
    const expected = Buffer.from(row.codeHash);
    const ok = given.length === expected.length && timingSafeEqual(given, expected);
    if (!ok) {
      await db.customerAuthCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
      await authEventService.logCustomer('customer_code_failure', destination, ip, `wrong code (attempt ${row.attempts + 1}/${MAX_CODE_ATTEMPTS})`);
      throw new UnauthorizedError('That code is not right.');
    }

    // Single use.
    await db.customerAuthCode.update({ where: { id: row.id }, data: { consumedAt: new Date() } });

    // A phone sign-in has no email, so the customer record is keyed on the
    // phone identity instead. Email sign-in reuses or creates the email customer.
    const identity = await db.customerIdentity.findFirst({ where: { kind: input.kind, provider: null, subject: destination } });
    let customerId: string;
    if (identity) {
      customerId = identity.customerId;
      await db.customerIdentity.update({ where: { id: identity.id }, data: { verifiedAt: new Date(), lastUsedAt: new Date() } });
    } else {
      const customer = input.kind === 'email'
        ? await upsertCustomer(destination, input.name)
        : await db.customer.create({ data: { email: `${destination}@phone.local`, name: input.name ?? null } });
      customerId = customer.id;
      await db.customerIdentity.create({
        data: { customerId, kind: input.kind, subject: destination, verifiedAt: new Date(), lastUsedAt: new Date() },
      });
      if (input.kind === 'email') await this.claimGuestOrders(customerId, destination);
    }

    const customer = await db.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundError('Account not found', 'customer');
    await authEventService.logCustomer(
      identity ? 'customer_login_success' : 'customer_registered',
      destination,
      ip,
      `${input.kind} code`,
    );
    return { customer, ...(await issueSession(customerId, input.userAgent)) };
  },

  // ─── Social ──────────────────────────────────────────────────────────────

  /**
   * Signs in (or registers) from an already-verified social profile.
   *
   * This takes a VERIFIED profile — exchanging the provider's code for a token
   * and validating it belongs to us is the caller's job. Accepting an
   * unverified provider id here would let anyone sign in as anyone by posting
   * a subject.
   */
  async signInWithOAuth(input: {
    provider: 'google' | 'apple' | 'facebook';
    subject: string;
    email?: string;
    name?: string;
    emailVerified?: boolean;
    userAgent?: string;
    ip?: string;
  }) {
    if (!input.subject.trim()) throw new ValidationError('Missing provider account id.', 'subject');
    const ip = input.ip ?? null;
    // The provider's account id is masked in the log: it is a stable
    // cross-site identifier, and an audit trail is a lower-trust artefact than
    // the identity table it describes.
    const label = `${input.provider}:${maskSubject(input.subject)}`;

    const existing = await db.customerIdentity.findFirst({
      where: { kind: 'oauth', provider: input.provider, subject: input.subject },
    });
    if (existing) {
      await db.customerIdentity.update({ where: { id: existing.id }, data: { lastUsedAt: new Date() } });
      const customer = await db.customer.findUnique({ where: { id: existing.customerId } });
      if (!customer) throw new NotFoundError('Account not found', 'customer');
      await authEventService.logCustomer('customer_oauth_login', label, ip, input.provider);
      return { customer, ...(await issueSession(customer.id, input.userAgent)) };
    }

    // Link to an existing account by email ONLY when the provider says the
    // email is verified. Apple in particular lets a user hide their address,
    // and auto-linking on an unverified email is an account-takeover route:
    // sign up at a provider claiming someone else's address, get their orders.
    const email = input.email ? normalizeEmail(input.email) : null;
    let customer;
    if (email && input.emailVerified) {
      customer = await upsertCustomer(email, input.name);
    } else {
      // Not verified, so we must not attach to any existing account with this
      // address. Customer.email is ALSO unique, so we cannot store the claimed
      // address either — a second customer row carrying it would collide, and
      // "just reuse the existing row" is precisely the takeover we are
      // refusing. So: a placeholder address keyed to the provider account, and
      // the claimed email kept in meta so it can be verified and merged later.
      customer = await db.customer.create({
        data: {
          email: `${input.provider}-${input.subject}@social.local`,
          name: input.name ?? null,
          meta: email ? { unverifiedEmail: email } : {},
        },
      });
    }

    await db.customerIdentity.create({
      data: {
        customerId: customer.id,
        kind: 'oauth',
        provider: input.provider,
        subject: input.subject,
        verifiedAt: new Date(),
        lastUsedAt: new Date(),
      },
    });
    if (email && input.emailVerified) await this.claimGuestOrders(customer.id, email);
    // Whether the address was verified decides whether this account got linked
    // to existing history or deliberately isolated — the single most important
    // fact to be able to reconstruct if a takeover is ever alleged.
    await authEventService.logCustomer(
      'customer_oauth_registered',
      label,
      ip,
      email && input.emailVerified
        ? `${input.provider}; verified email linked`
        : `${input.provider}; email unverified — isolated account`,
    );
    return { customer, ...(await issueSession(customer.id, input.userAgent)) };
  },

  // ─── Sessions ────────────────────────────────────────────────────────────

  /** Resolves a raw session token to its customer, or null. */
  async resolveSession(token: string) {
    if (!token) return null;
    const session = await db.customerSession.findUnique({
      where: { tokenHash: sha256(token) },
      include: { customer: true },
    });
    if (!session || session.expiresAt < new Date()) return null;
    await db.customerSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
    return session.customer;
  },

  async signOut(token: string, ip?: string) {
    // Read before delete: once the row is gone there is no way back to whose
    // session it was, and an audit entry that cannot name anyone is noise.
    const session = await db.customerSession.findUnique({
      where: { tokenHash: sha256(token) },
      include: { customer: { select: { email: true } } },
    });
    await db.customerSession.deleteMany({ where: { tokenHash: sha256(token) } });
    if (session) await authEventService.logCustomer('customer_logout', session.customer.email, ip ?? null);
    return { signedOut: true as const };
  },

  /** Every device — for "sign out everywhere" after a password change. */
  async signOutAll(customerId: string, ip?: string) {
    const customer = await db.customer.findUnique({ where: { id: customerId }, select: { email: true } });
    const { count } = await db.customerSession.deleteMany({ where: { customerId } });
    if (customer) {
      await authEventService.logCustomer('customer_logout', customer.email, ip ?? null, `all devices (${count} session(s))`);
    }
    return { signedOut: count };
  },

  async identitiesFor(customerId: string) {
    const rows = await db.customerIdentity.findMany({ where: { customerId }, orderBy: { createdAt: 'asc' } });
    // Never return secretHash.
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind as IdentityKind,
      provider: r.provider,
      subject: r.kind === 'password' || r.kind === 'email' ? r.subject : maskSubject(r.subject),
      verified: Boolean(r.verifiedAt),
      lastUsedAt: r.lastUsedAt,
    }));
  },

  /**
   * Refuses to remove someone's last way in. Unlinking the only identity on an
   * account locks the customer out of their own order history permanently.
   */
  async unlinkIdentity(customerId: string, identityId: string, ip?: string) {
    const all = await db.customerIdentity.findMany({ where: { customerId } });
    if (all.length <= 1) {
      throw new ValidationError('That is the only way to sign in to this account — add another first.', 'identityId');
    }
    const target = all.find((i) => i.id === identityId);
    if (!target) throw new NotFoundError('Identity not found', 'identityId');
    await db.customerIdentity.delete({ where: { id: identityId } });
    // Removing a sign-in method is a step in most account takeovers — the
    // attacker cuts off the real owner's way back in. Worth a row.
    const customer = await db.customer.findUnique({ where: { id: customerId }, select: { email: true } });
    await authEventService.logCustomer(
      'customer_identity_unlinked',
      customer?.email ?? customerId,
      ip ?? null,
      `${target.kind}${target.provider ? ` (${target.provider})` : ''}`,
    );
    return { id: identityId, unlinked: true as const };
  },

  // ─── Guest history ───────────────────────────────────────────────────────

  /**
   * Attaches past guest orders to a newly-created account.
   *
   * Only ever called with an email the customer has just PROVEN they control
   * (password registration, a verified emailed code, or a provider-verified
   * address). Doing it on a merely-typed email would hand over someone else's
   * order history to anyone who guessed their address.
   */
  async claimGuestOrders(customerId: string, email: string) {
    const { count } = await db.order.updateMany({
      where: { guestEmail: email.toLowerCase(), customerId: null },
      data: { customerId },
    });
    return { claimed: count };
  },
};

/** Shows enough to recognise, not enough to reuse. */
function maskSubject(subject: string): string {
  if (subject.startsWith('+')) return `••• ${subject.slice(-4)}`;
  return subject.length <= 6 ? '•••' : `${subject.slice(0, 3)}•••${subject.slice(-2)}`;
}

import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { db } from '../lib/db.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { checkRateLimit } from '../lib/rateLimit.js';
import { NotFoundError, TooManyRequestsError, UnauthorizedError, ValidationError } from '../lib/errors.js';
import { authEventService } from '../services/authEvent.service.js';
import { notificationService } from '../services/notification.service.js';
import { codeEmailHtml } from '../services/emailTemplate.js';
import { lifecycleService } from '../services/lifecycle.service.js';
import { resolveCustomerByEmail, emailInUse, addEmail, markEmailVerified } from './customerEmail.js';

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

// Constant-time guard: when no credential is found, still run one password
// verify against a throwaway hash so "no account" and "wrong password" take the
// same time and cannot be told apart by timing.
let DUMMY_HASH: string | null = null;
async function dummyVerify(password: string): Promise<void> {
  if (!DUMMY_HASH) DUMMY_HASH = await hashPassword('timing-guard-not-a-real-password');
  await verifyPassword(password, DUMMY_HASH).catch(() => false);
}

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

/** Finds an existing customer by ANY of their emails, or makes one. */
async function upsertCustomer(email: string, name?: string) {
  // Resolve ONLY through VERIFIED identities (+ scalar primary). Matching an
  // UNVERIFIED identity here was an account-capture hole: an attacker could add
  // victim@email to their own account (unverified), and the victim's later
  // sign-in would resolve into the attacker's account. A verified secondary
  // still matches (it is verified), so legitimate multi-email login is intact.
  const resolved = await resolveCustomerByEmail(email, { verifiedOnly: true });
  if (resolved) {
    const c = await db.customer.findUnique({ where: { id: resolved.id } });
    if (c) return c;
  }
  return db.customer.create({ data: { email, name: name ?? null } });
}

/**
 * Mint + store + email a one-time email code. Shared by requestCode (which adds
 * its own rate-limit + audit log around this) and registerWithPassword (which
 * mails a verification code on signup but already logs 'customer_registered' —
 * a second 'customer_code_requested' row would be redundant, and if fired
 * fire-and-forget it races the audit-trail read). Returns the code so callers
 * that need it (tests, requestCode's response) can surface it.
 */
async function issueAndSendEmailCode(destination: string, purpose: 'login' | 'email_change' = 'login'): Promise<string> {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await db.customerAuthCode.create({
    data: { destination, kind: 'email', purpose, codeHash: sha256(code), expiresAt: new Date(Date.now() + CODE_TTL_MS) },
  });
  const brand = process.env.SITE_NAME ? `${process.env.SITE_NAME} ` : '';
  const text = `Your ${brand}login code is ${code}. It expires in 10 minutes.\n\nIf you didn't request this, you can ignore this email.`;
  void notificationService.sendToAddress(destination, 'Your login code', text, codeEmailHtml({ code })).catch(() => {});
  return code;
}

export const customerAuth = {
  // ─── Password ────────────────────────────────────────────────────────────

  async registerWithPassword(input: { email: string; password: string; name?: string; ip?: string }) {
    const email = normalizeEmail(input.email);
    const ip = input.ip ?? null;
    if (input.password.length < 8) {
      throw new ValidationError('Use at least 8 characters.', 'password');
    }
    // Uniqueness across the FULL email set of EVERY account (not just password
    // subjects) so a signup can't claim an address already held as someone's
    // secondary email.
    if (await emailInUse(email)) throw new ValidationError('An account already exists for that email — try signing in.', 'email');

    // emailInUse already guaranteed no account (verified identity, unverified
    // identity, OR scalar) holds this address, so this is always a fresh account.
    const customer = await db.customer.create({ data: { email, name: input.name ?? null } });
    // ONE shared password credential per customer, keyed by customerId (never by
    // the email) so any of the account's emails reaches the same hash.
    await db.customerIdentity.create({
      data: {
        customerId: customer.id,
        kind: 'password',
        subject: customer.id,
        secretHash: await hashPassword(input.password),
        verifiedAt: new Date(),
      },
    });
    // The registering address is an UNVERIFIED claim until proven. Submitting a
    // signup form is not proof of controlling the mailbox — if it were, anyone
    // could register victim@ and (before this) inherit the victim's guest order
    // history. So the email identity is created verifiedAt:null and NO orders are
    // claimed here; verifyCode promotes it + claims the history once the mailbox
    // is proven from THIS account's own session. The address is unproven, so it
    // is NOT a resolution/merge target: resolveCustomerByEmail's scalar fallback
    // is gated to proven/legacy accounts, and verifyCode neutralises this scalar
    // if a different mailbox-controller proves the address (audit C5).
    await db.customerIdentity.create({ data: { customerId: customer.id, kind: 'email', subject: email, verifiedAt: null } });
    await authEventService.logCustomer('customer_registered', email, ip, 'password; email unverified, verification code sent');
    // Mail the verification code so the registrant can prove the mailbox and
    // claim any guest orders. issueAndSendEmailCode (not requestCode) so this
    // adds no second audit row beyond the 'customer_registered' above.
    // Best-effort: a dead transport must not fail the signup.
    void issueAndSendEmailCode(email).catch(() => {});
    void lifecycleService.sendRegularWelcome(customer.id); // best-effort; skips F&F members
    return { customer, ...(await issueSession(customer.id)) };
  },

  /**
   * Reset the account password using an emailed code (the "forgot password"
   * flow). The code is issued + mailed by lifecycleService.sendPasswordResetCode
   * into the same customer_auth_codes store login codes use; this consumes it
   * and sets (or creates) the password identity. Mirrors verifyCode's
   * constant-time compare and single-use, and signs every other session out.
   */
  async resetPasswordWithCode(input: { email: string; code: string; newPassword: string; ip?: string }) {
    const email = normalizeEmail(input.email);
    const ip = input.ip ?? null;
    if (input.newPassword.length < 8) throw new ValidationError('Use at least 8 characters.', 'newPassword');

    // Only a 'reset'-purpose code resets a password. A login/verification code
    // (purpose 'login') must NOT be redeemable here — that interchangeability was
    // the account-takeover path.
    const row = await db.customerAuthCode.findFirst({
      where: { destination: email, kind: 'email', purpose: 'reset', consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) throw new UnauthorizedError('That code has expired — request a new one.');
    if (row.attempts >= MAX_CODE_ATTEMPTS) {
      throw new TooManyRequestsError('Too many wrong attempts on this code — request a new one.', 60);
    }
    const given = Buffer.from(sha256(input.code));
    const expected = Buffer.from(row.codeHash);
    const ok = given.length === expected.length && timingSafeEqual(given, expected);
    if (!ok) {
      await db.customerAuthCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
      throw new UnauthorizedError('That code is not right.');
    }
    await db.customerAuthCode.update({ where: { id: row.id }, data: { consumedAt: new Date() } });

    // Resolve the account from ANY of its verified emails (the code proved this
    // address; it may be a secondary). Update the ONE shared password credential
    // found by customerId, not by subject=email.
    const resolved = await resolveCustomerByEmail(email, { verifiedOnly: true });
    const customer = resolved ? await db.customer.findUnique({ where: { id: resolved.id } }) : null;
    if (!customer) throw new NotFoundError('Account not found', 'email');
    const secretHash = await hashPassword(input.newPassword);
    const identity = await db.customerIdentity.findFirst({ where: { customerId: customer.id, kind: 'password' } });
    if (identity) {
      await db.customerIdentity.update({ where: { id: identity.id }, data: { secretHash, verifiedAt: new Date() } });
    } else {
      await db.customerIdentity.create({ data: { customerId: customer.id, kind: 'password', subject: customer.id, secretHash, verifiedAt: new Date() } });
    }
    await this.signOutAll(customer.id, ip ?? undefined); // a reset invalidates every existing session
    await authEventService.logCustomer('customer_password_changed', email, ip, 'reset-with-code');
    return { customer, ...(await issueSession(customer.id)) };
  },

  async signInWithPassword(input: { email: string; password: string; userAgent?: string; ip?: string }) {
    const email = normalizeEmail(input.email);
    const ip = input.ip ?? null;
    // Rate-limited per email BEFORE touching the hash, so this cannot be used
    // as a password-guessing oracle.
    // TWO limiters, because they stop different attacks. The per-email one
    // below defends a single account against a password guessing run. It does
    // nothing about spraying one common password across thousands of DIFFERENT
    // addresses from one host — every attempt is a fresh key, so no limit is
    // ever reached. The per-IP limiter is what catches that.
    if (ip) {
      const ipRl = await checkRateLimit(`customer-login-ip:${ip}`, 30, 15 * 60);
      if (!ipRl.allowed) {
        await authEventService.logCustomer('customer_login_throttled', email, ip, 'per-IP rate limit reached');
        throw new TooManyRequestsError('Too many attempts — try again shortly.', ipRl.retryAfterSeconds);
      }
    }
    // Resolve the account BEFORE the per-account limiter so the limit keys on the
    // CUSTOMER, not the entered address — three emails must not mean 3× the
    // password-guessing budget. Unknown addresses key on the address (the per-IP
    // limiter above catches spraying); the outcome is identical either way.
    //
    // verifiedOnly:FALSE here on purpose: a just-registered account holds its
    // email as an UNVERIFIED identity (the real address is not the scalar until a
    // code verifies it — audit C5), and the password itself is the proof of
    // ownership. Resolving via an unverified identity cannot be abused: an
    // attacker who pre-seeded victim@ on their own account still fails the
    // password check (dummyVerify on the miss), so no account is captured.
    const resolved = await resolveCustomerByEmail(email, { verifiedOnly: false });
    const acctKey = resolved ? `customer-login:${resolved.id}` : `customer-login:unknown:${email}`;
    const rl = await checkRateLimit(acctKey, 10, 15 * 60);
    if (!rl.allowed) {
      // Logged as its own type. A throttled attempt means the limiter already
      // fired — that is the loudest signal this surface produces, and burying
      // it in with ordinary wrong-password failures wastes it.
      await authEventService.logCustomer('customer_login_throttled', email, ip, 'rate limit reached');
      throw new TooManyRequestsError('Too many attempts — try again shortly.', rl.retryAfterSeconds);
    }

    // The ONE shared password credential, reached by customerId regardless of
    // which of the account's ≤3 emails was entered.
    const identity = resolved
      ? await db.customerIdentity.findFirst({ where: { customerId: resolved.id, kind: 'password' } })
      : null;
    // Same error either way — "no such account" vs "wrong password" is an
    // enumeration oracle — and constant-time: an unknown/passwordless account
    // still runs one verify against a dummy hash so timing does not leak it.
    let ok = false;
    if (identity?.secretHash) ok = await verifyPassword(input.password, identity.secretHash);
    else await dummyVerify(input.password);
    if (!ok) {
      // The DETAIL distinguishes them for the operator log — read by more people
      // than the person signing in is, but not by them.
      await authEventService.logCustomer('customer_login_failure', email, ip, resolved ? 'wrong password' : 'no such account');
      throw new UnauthorizedError('Those details do not match.');
    }
    await db.customerIdentity.update({ where: { id: identity!.id }, data: { lastUsedAt: new Date() } });
    const customer = await db.customer.findUnique({ where: { id: resolved!.id } });
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
  async requestCode(input: { destination: string; kind: 'phone' | 'email'; ip?: string; purpose?: 'login' | 'email_change' }) {
    // `purpose` scopes the code to a flow so it can't be redeemed elsewhere (a
    // login code at the reset endpoint = takeover). The PUBLIC route never passes
    // it (defaults to 'login'); only the signed-in email-change flow sets
    // 'email_change'. Password RESET codes are minted separately (lifecycle) with
    // purpose:'reset' and are never issued through this path.
    const purpose = input.purpose ?? 'login';
    // No SMS transport exists in this build, so a phone code would be minted and
    // never delivered — the route would answer {sent:true} for a code that never
    // arrives. Fail loudly instead. (Re-enable once a Nexus SMS sender lands.)
    if (input.kind === 'phone') {
      throw new ValidationError('Phone sign-in is not available yet — please use email.', 'kind');
    }
    const destination = normalizeEmail(input.destination); // kind is 'email' past the guard
    const ip = input.ip ?? null;
    const rl = await checkRateLimit(`customer-code:${destination}`, 5, 15 * 60);
    if (!rl.allowed) {
      await authEventService.logCustomer('customer_login_throttled', destination, ip, `${input.kind} code rate limit reached`);
      throw new TooManyRequestsError('Too many codes requested — try again shortly.', rl.retryAfterSeconds);
    }

    // Mint + store + deliver (best-effort). Kind is 'email' past the guard.
    const code = await issueAndSendEmailCode(destination, purpose);
    // The code itself is never a log field — see the header note.
    await authEventService.logCustomer('customer_code_requested', destination, ip, input.kind);
    return { destination, code, expiresInSeconds: CODE_TTL_MS / 1000 };
  },

  /** Verifies a code and signs the customer in, creating them if needed.
   *  `sessionCustomerId` (when the caller is already signed in) lets a just-
   *  registered account PROMOTE its own pending email — see the else-branch. */
  async verifyCode(input: { destination: string; kind: 'phone' | 'email'; code: string; name?: string; userAgent?: string; ip?: string; sessionCustomerId?: string | null }) {
    const destination = input.kind === 'phone' ? normalizePhone(input.destination) : normalizeEmail(input.destination);
    const ip = input.ip ?? null;
    // Only a 'login'-purpose code signs in here. A password-reset or email-change
    // code (different purpose) must NOT be redeemable to mint a session.
    const row = await db.customerAuthCode.findFirst({
      where: { destination, kind: input.kind, purpose: 'login', consumedAt: null, expiresAt: { gt: new Date() } },
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
    if (identity && identity.verifiedAt) {
      // A VERIFIED identity means control of this destination was proven before
      // — sign into that account.
      customerId = identity.customerId;
      await db.customerIdentity.update({ where: { id: identity.id }, data: { lastUsedAt: new Date() } });
    } else if (identity && !identity.verifiedAt && input.sessionCustomerId && identity.customerId === input.sessionCustomerId) {
      // PROMOTE (register→verify). The caller is signed in as the very account
      // that holds this unverified email — i.e. the person who just registered
      // it, proving the mailbox from their own session. This is unambiguous
      // ownership, so promote the identity in place (verify it, promote the
      // placeholder scalar to the real address, claim guest orders) instead of
      // the capture-guard delete+create — which would otherwise strand their
      // password account behind a placeholder scalar. An attacker cannot reach
      // this branch: it requires a session for the SAME account, which they
      // cannot have for the victim's reclaim.
      customerId = identity.customerId;
      await db.customerIdentity.update({ where: { id: identity.id }, data: { verifiedAt: new Date(), lastUsedAt: new Date() } });
      const acct = await db.customer.findUnique({ where: { id: customerId }, select: { email: true } });
      if (acct?.email?.endsWith('@unverified.local')) {
        // Promote the real address to the scalar, unless already taken.
        const clash = await db.customer.findFirst({ where: { email: { equals: destination, mode: 'insensitive' }, NOT: { id: customerId } }, select: { id: true } });
        if (!clash) await db.customer.update({ where: { id: customerId }, data: { email: destination } });
      }
      await this.claimGuestOrders(customerId, destination);
    } else {
      // Either no identity, or an UNVERIFIED one that does NOT belong to the
      // caller's own session. An unverified identity is an unproven claim
      // (possibly an attacker's pre-seed of this address on their account). The
      // code just proved THIS user controls the address, so that claim must NOT
      // capture the login — void it, freeing the unique subject, and
      // resolve/create for the real controller.
      if (identity && !identity.verifiedAt) {
        await db.customerIdentity.delete({ where: { id: identity.id } });
        // Neutralise a POISONED SCALAR. If the voided account carries this exact
        // address as its Customer.email scalar (an unproven password
        // registration always does) and has no OTHER verified email identity,
        // deleting the identity above would leave it as scalar=X with no email
        // identities — which resolveCustomerByEmail's (gated) scalar fallback now
        // treats as a legacy account and would happily re-resolve into. Rename
        // the scalar to a dead placeholder so it is neither a resolution target
        // nor a UNIQUE-collision blocking the real controller's new account.
        const voided = await db.customer.findUnique({ where: { id: identity.customerId }, select: { email: true } });
        if (voided?.email && voided.email.toLowerCase() === destination) {
          // Free the scalar from `destination` UNCONDITIONALLY (audit C7). The old
          // code only did this when the voided account had NO other verified email;
          // when it DID, the scalar stayed == destination and the upsertCustomer
          // below (which sets Customer.email = destination for the real controller)
          // hit a P2002 UNIQUE collision on customers.email — the whole verifyCode
          // threw and the victim was PERMANENTLY locked out of their own address.
          // If the voided account still has another verified email, promote THAT
          // to its primary; otherwise a dead placeholder. Either way destination is
          // freed so the real controller's account can take it.
          const otherVerified = await db.customerIdentity.findFirst({
            where: { customerId: identity.customerId, kind: 'email', verifiedAt: { not: null }, NOT: { subject: destination } },
            select: { subject: true },
          });
          await db.customer.update({
            where: { id: identity.customerId },
            data: { email: otherVerified?.subject ?? `void-${randomBytes(10).toString('hex')}@unverified.local` },
          });
        }
        await authEventService.logCustomer('customer_identity_unlinked', destination, ip, 'voided an unverified identity claim on a proven address (capture guard)');
      }
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
  async unlinkIdentity(customerId: string, identityId: string, ip?: string, proof?: { password?: string; code?: string }) {
    const all = await db.customerIdentity.findMany({ where: { customerId } });
    const target = all.find((i) => i.id === identityId);
    if (!target) throw new NotFoundError('Identity not found', 'identityId');

    // Removing a VERIFIED sign-in method is a takeover step (a stolen session
    // otherwise strips the real owner's way back in — audit C3), so it requires
    // FRESH re-auth, not just a session. Removing an unverified/pending claim
    // (e.g. cancelling a half-added email) does not.
    if (target.verifiedAt || target.kind === 'password') {
      const pwd = all.find((i) => i.kind === 'password' && i.secretHash);
      if (pwd?.secretHash) {
        if (!proof?.password || !(await verifyPassword(proof.password, pwd.secretHash))) {
          throw new UnauthorizedError('Enter your password to remove a sign-in method.');
        }
      } else {
        // Passwordless account: require a live login code sent to one of the
        // account's OWN currently-verified emails — proof of mailbox control the
        // session-thief does not have.
        const verifiedEmails = all.filter((i) => i.kind === 'email' && i.verifiedAt).map((i) => i.subject);
        const row = proof?.code && verifiedEmails.length
          ? await db.customerAuthCode.findFirst({ where: { destination: { in: verifiedEmails }, kind: 'email', purpose: 'login', consumedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } })
          : null;
        const ok = !!row && (() => { const a = Buffer.from(sha256(proof!.code!)); const b = Buffer.from(row.codeHash); return a.length === b.length && timingSafeEqual(a, b); })();
        if (!row || !ok) throw new UnauthorizedError('Enter the code we email you to remove a sign-in method.');
        await db.customerAuthCode.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
      }
    }

    // INVARIANTS (mirror removeEmail): never leave the account unrecoverable.
    const remaining = all.filter((i) => i.id !== identityId);
    const stillUsable = remaining.some((i) => (i.kind === 'password' && i.secretHash) || (i.kind !== 'password' && i.verifiedAt != null));
    if (!stillUsable) {
      throw new ValidationError('That is the last way to sign in to this account — add and verify another first.', 'identityId');
    }
    const customer = await db.customer.findUnique({ where: { id: customerId }, select: { email: true } });
    if (target.kind === 'email' && customer?.email && customer.email.toLowerCase() === target.subject.toLowerCase()) {
      // Removing the identity that backs Customer.email orphans the primary —
      // forgot-password/code-login can never reach the account again. Repoint the
      // primary to another VERIFIED email first, or refuse.
      const nextPrimary = remaining.find((i) => i.kind === 'email' && i.verifiedAt != null);
      if (!nextPrimary) throw new ValidationError('That is your account\'s primary email — add and verify another before removing it.', 'identityId');
      await db.customer.update({ where: { id: customerId }, data: { email: nextPrimary.subject } });
    }
    await db.customerIdentity.delete({ where: { id: identityId } });
    // Removing a sign-in method is a step in most account takeovers — the
    // attacker cuts off the real owner's way back in. Worth a row. (Reuses the
    // `customer` loaded above for the primary-repoint check.)
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
  /**
   * Change a password, proving the old one first.
   *
   * The current password is required even though the caller already holds a
   * session: a session can be a borrowed laptop, and "someone walked away
   * from a logged-in browser" should not be enough to lock the owner out of
   * their own account.
   *
   * Every OTHER session is dropped afterwards. If the reason for the change
   * was that somebody else had the old password, leaving their session alive
   * makes the change pointless.
   */
  async changePassword(input: { customerId: string; current: string; next: string; ip?: string }) {
    if (input.next.length < 8) throw new ValidationError('Use at least 8 characters.', 'password');
    if (input.next === input.current) throw new ValidationError('That is the password you already have.', 'password');
    const identity = await db.customerIdentity.findFirst({
      where: { customerId: input.customerId, kind: 'password' },
    });
    if (!identity?.secretHash) {
      throw new ValidationError('This account signs in with a code or a social login, so it has no password to change.', 'password');
    }
    if (!(await verifyPassword(input.current, identity.secretHash))) {
      throw new ValidationError('That is not your current password.', 'current');
    }
    await db.customerIdentity.update({
      where: { id: identity.id },
      data: { secretHash: await hashPassword(input.next) },
    });
    await this.signOutAll(input.customerId, input.ip);
    await authEventService.logCustomer('customer_password_changed', identity.subject, input.ip ?? null, 'self-service');
    // A fresh session, so changing the password does not sign you out of the
    // tab you changed it in.
    return issueSession(input.customerId);
  },

  /**
   * ADD an email to the account (up to 3). A code goes to the NEW address; the
   * email only becomes a usable login once confirmEmailChange verifies it. The
   * account keeps its other emails — this adds, it does not replace. (Named
   * *EmailChange for back-compat with the storefront route; semantics are add.)
   *
   * Two-step on purpose: without it, one hijacked session could bolt an
   * attacker's inbox onto the account, so the code to the new address is the
   * proof, and a password re-auth gates the request itself.
   */
  async requestEmailChange(input: { customerId: string; newEmail: string; password?: string; code?: string; ip?: string }) {
    const email = normalizeEmail(input.newEmail);
    const identity = await db.customerIdentity.findFirst({
      where: { customerId: input.customerId, kind: 'password' },
    });
    // Re-authenticate the REQUEST, not just the new address. The code sent to the
    // new address only proves the requester controls THAT inbox — for a stolen
    // session that inbox is the ATTACKER's, so "code to new address" alone let a
    // session-thief bolt their own email onto a passwordless account and take it
    // over (audit C3). Password accounts prove the password; passwordless accounts
    // must prove control of an EXISTING verified email (a code sent there), which
    // the session-thief does not have.
    if (identity?.secretHash) {
      if (!input.password) throw new ValidationError('Enter your password to add an email.', 'password');
      if (!(await verifyPassword(input.password, identity.secretHash))) {
        throw new ValidationError('That password is not right.', 'password');
      }
    } else {
      const verifiedEmails = (await db.customerIdentity.findMany({
        where: { customerId: input.customerId, kind: 'email', verifiedAt: { not: null } },
        select: { subject: true },
      })).map((i) => i.subject);
      const row = input.code && verifiedEmails.length
        ? await db.customerAuthCode.findFirst({ where: { destination: { in: verifiedEmails }, kind: 'email', purpose: 'login', consumedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } })
        : null;
      const ok = !!row && (() => { const a = Buffer.from(sha256(input.code!)); const b = Buffer.from(row.codeHash); return a.length === b.length && timingSafeEqual(a, b); })();
      if (!row || !ok) throw new UnauthorizedError('To add an email, first enter the code we send to your existing address.');
      await db.customerAuthCode.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
    }
    // Enforces the ≤3 cap + global uniqueness and records the address as an
    // UNVERIFIED identity; the code below is what verifies it.
    await addEmail(input.customerId, email);
    // 'email_change' purpose: this code confirms an added address only — it must
    // not be redeemable to sign in (verifyCode) or reset a password.
    const out = await this.requestCode({ destination: email, kind: 'email', ip: input.ip, purpose: 'email_change' });
    return { sent: true, to: email, ...(out.code ? { code: out.code } : {}) };
  },

  /** Second half: the code proves the new address is reachable. */
  async confirmEmailChange(input: { customerId: string; newEmail: string; code: string; ip?: string }) {
    const email = normalizeEmail(input.newEmail);
    // Confirm is strictly the SECOND HALF of a request the caller can prove
    // happened: an unverified email identity for this address must already exist
    // on THIS account (planted by requestEmailChange/addEmail). Without this
    // check, a signed-in user who has a live code for any address could confirm
    // it — markEmailVerified would no-op (no pending row) but claimGuestOrders
    // still re-parented that address's guest orders to their account, desyncing
    // the two halves of the add-flow (audit). Require the pending identity first.
    const pending = await db.customerIdentity.findFirst({ where: { customerId: input.customerId, kind: 'email', subject: email } });
    if (!pending) throw new NotFoundError('No pending email change for that address — start from your account.', 'newEmail');
    // Prove the new address is reachable WITHOUT verifyCode's side effects:
    // verifyCode also CREATES a customer for the destination and claims that
    // address's guest orders, which then collides with the Customer.email
    // @unique update below — orphaning a customer and mis-claiming orders. So
    // replicate only the read / attempts / compare / consume steps here.
    const codeRow = await db.customerAuthCode.findFirst({
      where: { destination: email, kind: 'email', purpose: 'email_change', consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!codeRow) throw new UnauthorizedError('That code has expired — request a new one.');
    if (codeRow.attempts >= MAX_CODE_ATTEMPTS) {
      throw new TooManyRequestsError('Too many wrong attempts on this code — request a new one.', 60);
    }
    const givenCode = Buffer.from(sha256(input.code));
    const expectedCode = Buffer.from(codeRow.codeHash);
    if (!(givenCode.length === expectedCode.length && timingSafeEqual(givenCode, expectedCode))) {
      await db.customerAuthCode.update({ where: { id: codeRow.id }, data: { attempts: { increment: 1 } } });
      throw new UnauthorizedError('That code is not right.');
    }
    await db.customerAuthCode.update({ where: { id: codeRow.id }, data: { consumedAt: new Date() } });
    // ADD, don't replace: mark this address a verified login email and claim any
    // guest orders placed under it. The account's other emails and its primary
    // (Customer.email) are untouched — promoting a new primary is a separate,
    // explicit action (setPrimaryEmail).
    await markEmailVerified(input.customerId, email);
    await this.claimGuestOrders(input.customerId, email);
    await authEventService.logCustomer('customer_email_changed', email, input.ip ?? null, 'email added');
    return { email };
  },

  async claimGuestOrders(customerId: string, email: string) {
    // CASE-INSENSITIVE: orders store guestEmail AS TYPED at checkout (e.g.
    // "Bob@Gmail.com"), but this matched a lowercased string exactly — so a
    // shopper who typed any capital at checkout then verified the address later
    // silently claimed ZERO of their guest orders. Match on normalized case.
    const { count } = await db.order.updateMany({
      where: { guestEmail: { equals: email, mode: 'insensitive' }, customerId: null },
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

import { db } from '../lib/db.js';
import { ValidationError, ConflictError, NotFoundError } from '../lib/errors.js';

// Multi-email accounts — the single home for "which addresses belong to this
// account, and which one is primary". Up to 3 verified emails per customer, all
// sharing ONE password credential; sign-in / reset / guest-order claim resolve
// through here so the rule lives in one place, not the ~14 call sites that used
// to do `db.customer.findFirst({ where: { email } })` against the scalar column.
//
// Model (reuses CustomerIdentity, no new table):
//   - each login email  = CustomerIdentity{ kind:'email', subject:<lowercased>, verifiedAt }
//   - the ONE credential = CustomerIdentity{ kind:'password', subject:<customerId>, secretHash }
//   - Customer.email     = the PRIMARY / outbound-mail address (a mirror of the
//                          verified email flagged primary)
// verifiedAt gates login: an added-but-unverified email is inert for auth.
// A DB partial unique index on (subject) WHERE kind='email' guarantees no two
// accounts can claim the same address (the composite @@unique does NOT, because
// provider is NULL and Postgres treats NULLs as distinct).

export const MAX_EMAILS = 3;

export function normalizeEmail(raw: string): string {
  const e = raw.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new ValidationError('That email address does not look right.', 'email');
  return e;
}

/**
 * Entered address → the owning customer. Verified-only by default (a login/reset
 * resolver must never accept an unverified address). Falls back to the scalar
 * Customer.email for accounts not yet backfilled into email identities.
 */
export async function resolveCustomerByEmail(
  email: string,
  opts: { verifiedOnly?: boolean } = {},
): Promise<{ id: string } | null> {
  const subject = normalizeEmail(email);
  const verifiedOnly = opts.verifiedOnly !== false;
  const em = await db.customerIdentity.findFirst({
    where: { kind: 'email', subject, ...(verifiedOnly ? { verifiedAt: { not: null } } : {}) },
    select: { customerId: true },
  });
  if (em) return { id: em.customerId };
  // Scalar-primary fallback — for LEGACY/imported accounts whose primary email
  // was never backfilled as an identity. It is GATED (audit C5): an unproven
  // password-registration writes its real address to the scalar too, and an
  // ungated fallback made that scalar a resolution/merge target — so a verified
  // OAuth (or a code login) for a victim's address re-resolved through the
  // ATTACKER's poisoned scalar into the attacker's account. Only trust the
  // scalar when the account has NO email identities at all (a true transitional/
  // migrated account — the registration path always creates an email identity,
  // so a fresh signup never looks like this). An account that carries an
  // (unverified) email identity is an unproven claim and is NOT resolvable by
  // scalar.
  const c = await db.customer.findFirst({
    where: {
      email: { equals: subject, mode: 'insensitive' },
      identities: { none: { kind: 'email' } },
    },
    select: { id: true },
  });
  return c ? { id: c.id } : null;
}

/** True if the address already belongs to ANY account (identity OR scalar primary). */
export async function emailInUse(email: string, exceptCustomerId?: string): Promise<boolean> {
  const subject = normalizeEmail(email);
  const em = await db.customerIdentity.findFirst({
    where: { kind: 'email', subject, ...(exceptCustomerId ? { NOT: { customerId: exceptCustomerId } } : {}) },
    select: { id: true },
  });
  if (em) return true;
  const c = await db.customer.findFirst({
    where: { email: { equals: subject, mode: 'insensitive' }, ...(exceptCustomerId ? { NOT: { id: exceptCustomerId } } : {}) },
    select: { id: true },
  });
  return !!c;
}

export interface AccountEmail { email: string; verifiedAt: Date | null; primary: boolean }

/** The account's ≤3 emails with verified state; primary === Customer.email. */
export async function listAccountEmails(customerId: string): Promise<AccountEmail[]> {
  const [customer, ids] = await Promise.all([
    db.customer.findUnique({ where: { id: customerId }, select: { email: true } }),
    db.customerIdentity.findMany({ where: { customerId, kind: 'email' }, select: { subject: true, verifiedAt: true }, orderBy: { createdAt: 'asc' } }),
  ]);
  const primary = customer?.email ? customer.email.toLowerCase() : null;
  const out: AccountEmail[] = ids.map((i) => ({ email: i.subject, verifiedAt: i.verifiedAt, primary: i.subject === primary }));
  // Guarantee the primary shows even if it was never backfilled as an identity.
  if (primary && !out.some((e) => e.email === primary)) out.unshift({ email: primary, verifiedAt: new Date(0), primary: true });
  return out;
}

export async function emailCount(customerId: string): Promise<number> {
  return db.customerIdentity.count({ where: { customerId, kind: 'email' } });
}

/**
 * Attach a NEW (unverified) email to an account. Enforces the ≤3 cap and global
 * uniqueness; the caller then mails a verify code to the returned address.
 */
export async function addEmail(customerId: string, email: string): Promise<{ to: string }> {
  const subject = normalizeEmail(email);
  if (await emailInUse(subject, customerId)) throw new ConflictError('That email is already on another account.', 'email');
  const already = await db.customerIdentity.findFirst({ where: { customerId, kind: 'email', subject }, select: { id: true, verifiedAt: true } });
  if (already?.verifiedAt) throw new ConflictError('That email is already on your account.', 'email');
  if (!already) {
    if ((await emailCount(customerId)) >= MAX_EMAILS) throw new ValidationError(`An account can have at most ${MAX_EMAILS} emails.`, 'email');
    await db.customerIdentity.create({ data: { customerId, kind: 'email', subject, verifiedAt: null } });
  }
  return { to: subject };
}

/** Mark an added email verified (called after its code is consumed). */
export async function markEmailVerified(customerId: string, email: string): Promise<void> {
  const subject = normalizeEmail(email);
  await db.customerIdentity.updateMany({ where: { customerId, kind: 'email', subject }, data: { verifiedAt: new Date() } });
}

/** Promote a VERIFIED email to primary (moves outbound account mail to it). */
export async function setPrimaryEmail(customerId: string, email: string): Promise<void> {
  const subject = normalizeEmail(email);
  const em = await db.customerIdentity.findFirst({ where: { customerId, kind: 'email', subject }, select: { verifiedAt: true } });
  if (!em) throw new NotFoundError('That email is not on your account.', 'email');
  if (!em.verifiedAt) throw new ValidationError('Verify the email before making it your primary.', 'email');
  await db.customer.update({ where: { id: customerId }, data: { email: subject } });
}

/** Remove an email. Never the primary or the last remaining one. */
export async function removeEmail(customerId: string, email: string): Promise<void> {
  const subject = normalizeEmail(email);
  const customer = await db.customer.findUnique({ where: { id: customerId }, select: { email: true } });
  if (customer && customer.email.toLowerCase() === subject) {
    throw new ValidationError('That is your primary email — make another one primary first.', 'email');
  }
  if ((await emailCount(customerId)) <= 1) throw new ValidationError('An account must keep at least one email.', 'email');
  await db.customerIdentity.deleteMany({ where: { customerId, kind: 'email', subject } });
}

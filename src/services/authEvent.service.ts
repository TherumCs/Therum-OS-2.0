import { db } from '../lib/db.js';

export type AdminAuthEventType =
  | 'login_success'
  | 'login_failure'
  | 'login_locked'
  | 'setup'
  | 'logout'
  | '2fa_enabled'
  | '2fa_disabled'
  | '2fa_challenge_failed'
  | 'password_changed';

// Storefront (Counter) equivalents. Deliberately a SEPARATE union rather than
// reusing the admin names: a grep for `login_failure` should not silently
// return storefront noise, and a dashboard counting admin failures should not
// have to know which scope each row came from to be right.
export type CustomerAuthEventType =
  | 'customer_registered'
  | 'customer_login_success'
  | 'customer_login_failure'
  | 'customer_login_throttled'
  | 'customer_code_requested'
  | 'customer_code_failure'
  | 'customer_oauth_login'
  | 'customer_oauth_registered'
  // Self-service credential changes. Worth a trail of their own: a
  // password or login-email change is the event a compromised account
  // is usually noticed by, and it needs to be distinguishable from a
  // routine sign-in when someone reads the log back.
  | 'customer_password_changed'
  | 'customer_email_changed'
  | 'customer_logout'
  | 'customer_identity_unlinked';

export type AuthScope = 'admin' | 'customer';

// 1.9.44 had no auth-specific audit log at all (confirmed in the research
// pass) — this is new, not ported. Fire-and-forget by design: an audit-log
// write failure must never block the actual auth flow it's recording.
export const authEventService = {
  async log(type: AdminAuthEventType, username: string, ip: string | null, detail?: string): Promise<void> {
    try {
      await db.authEvent.create({ data: { type, username, ip, detail, scope: 'admin' } });
    } catch {
      // Never let audit logging break auth itself.
    }
  },

  /**
   * Storefront-account equivalent of `log`.
   *
   * `subject` is whatever was presented — an email, a phone number, a provider
   * account id — and like the admin log it is NOT a foreign key, because the
   * events most worth recording are the ones where no such account exists.
   * That is exactly what credential stuffing looks like.
   */
  async logCustomer(type: CustomerAuthEventType, subject: string, ip: string | null, detail?: string): Promise<void> {
    try {
      await db.authEvent.create({ data: { type, username: subject, ip, detail, scope: 'customer' } });
    } catch {
      // Never let audit logging break auth itself.
    }
  },

  async recentForUsername(username: string, limit = 20) {
    return db.authEvent.findMany({ where: { username: { equals: username, mode: 'insensitive' } }, orderBy: { createdAt: 'desc' }, take: limit });
  },

  // Settings > Activity. Real audit trail (login/logout/lockout/2FA/password
  // events); scoped to auth events only since there's no general
  // content-change log in this codebase yet. `scope` omitted means both.
  async recent(limit = 50, scope?: AuthScope) {
    return db.authEvent.findMany({
      ...(scope ? { where: { scope } } : {}),
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  },

  async count(scope?: AuthScope): Promise<number> {
    return db.authEvent.count(scope ? { where: { scope } } : undefined);
  },

  /**
   * Failed sign-in attempts per scope over a window.
   *
   * The number that makes the log actionable rather than merely present: a
   * storefront normally produces a trickle of failures, and a spike is the
   * signal. Without this an admin has to eyeball 50 rows and guess.
   */
  async failureCounts(sinceMinutes = 60): Promise<{ admin: number; customer: number; distinctCustomerSubjects: number }> {
    const since = new Date(Date.now() - sinceMinutes * 60_000);
    const [admin, customer, distinct] = await Promise.all([
      db.authEvent.count({ where: { scope: 'admin', type: { in: ['login_failure', 'login_locked', '2fa_challenge_failed'] }, createdAt: { gte: since } } }),
      db.authEvent.count({ where: { scope: 'customer', type: { in: ['customer_login_failure', 'customer_login_throttled', 'customer_code_failure'] }, createdAt: { gte: since } } }),
      db.authEvent.groupBy({
        by: ['username'],
        where: { scope: 'customer', type: { in: ['customer_login_failure', 'customer_login_throttled'] }, createdAt: { gte: since } },
      }),
    ]);
    // Many failures across MANY accounts is stuffing; many against ONE is a
    // targeted guess. The two want different responses, so both are reported.
    return { admin, customer, distinctCustomerSubjects: distinct.length };
  },
};

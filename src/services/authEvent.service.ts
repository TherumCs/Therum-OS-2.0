import { db } from '../lib/db.js';

export type AuthEventType = 'login_success' | 'login_failure' | 'login_locked' | 'setup' | 'logout' | '2fa_enabled' | '2fa_disabled' | '2fa_challenge_failed' | 'password_changed';

// 1.9.44 had no auth-specific audit log at all (confirmed in the research
// pass) — this is new, not ported. Fire-and-forget by design: an audit-log
// write failure must never block the actual auth flow it's recording.
export const authEventService = {
  async log(type: AuthEventType, username: string, ip: string | null, detail?: string): Promise<void> {
    try {
      await db.authEvent.create({ data: { type, username, ip, detail } });
    } catch {
      // Never let audit logging break auth itself.
    }
  },

  async recentForUsername(username: string, limit = 20) {
    return db.authEvent.findMany({ where: { username: { equals: username, mode: 'insensitive' } }, orderBy: { createdAt: 'desc' }, take: limit });
  },

  // Settings > Activity — admin-wide, not scoped to one username. Real audit
  // trail (login/logout/lockout/2FA/password events); scoped to auth events
  // only since there's no general content-change log in this codebase yet.
  async recent(limit = 50) {
    return db.authEvent.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
  },

  async count(): Promise<number> {
    return db.authEvent.count();
  },
};

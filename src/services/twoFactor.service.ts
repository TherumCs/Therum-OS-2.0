import { randomInt } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from '../lib/db.js';
import { generateSecret, formatSecretForDisplay, verifyTotp } from '../lib/totp.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { NotFoundError, ValidationError, ConflictError } from '../lib/errors.js';

interface BackupCode {
  hash: string;
  usedAt: string | null;
}

// No ambiguous chars (0/O/1/I) — matches 1.9.44's own backup-code alphabet,
// a real usability detail (codes are read off a screen and typed by hand).
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateBackupCode(): string {
  const chars = Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

async function requireUser(userId: string) {
  const user = await db.adminUser.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError('Admin user not found', 'id');
  return user;
}

export const twoFactorService = {
  // Generates and stores a new secret in a PENDING state (totpEnabled stays
  // false until a real code is verified via confirm()) — never turn 2FA on
  // just because a secret exists, only once the user has proven they can
  // actually generate a valid code with it.
  async enroll(userId: string): Promise<{ secret: string; secretFormatted: string }> {
    const user = await requireUser(userId);
    if (user.totpEnabled) throw new ConflictError('Two-factor authentication is already enabled.', 'totp');
    const secret = generateSecret();
    await db.adminUser.update({ where: { id: userId }, data: { totpSecret: secret, totpLastStep: null } });
    return { secret, secretFormatted: formatSecretForDisplay(secret) };
  },

  // Returns backup codes ONCE, in plaintext — only their hashes are ever
  // stored, matching how the password itself is handled.
  async confirm(userId: string, code: string): Promise<{ backupCodes: string[] }> {
    const user = await requireUser(userId);
    if (!user.totpSecret) throw new ValidationError('Start enrollment first.', 'totp');
    const result = verifyTotp(user.totpSecret, code, user.totpLastStep);
    if (!result.ok) throw new ValidationError('Incorrect code — check the time on your device and try again.', 'code');
    const plainCodes = Array.from({ length: 8 }, generateBackupCode);
    const backupCodes: BackupCode[] = await Promise.all(plainCodes.map(async (c) => ({ hash: await hashPassword(c), usedAt: null })));
    await db.adminUser.update({
      where: { id: userId },
      data: { totpEnabled: true, totpLastStep: result.step, backupCodes: backupCodes as unknown as Prisma.InputJsonValue },
    });
    return { backupCodes: plainCodes };
  },

  async disable(userId: string): Promise<void> {
    await requireUser(userId);
    await db.adminUser.update({ where: { id: userId }, data: { totpEnabled: false, totpSecret: null, backupCodes: Prisma.JsonNull, totpLastStep: null } });
  },

  // Used during login, after the password already checked out — accepts
  // either a live TOTP code or a single-use backup code, whichever matches.
  async verifyChallenge(userId: string, code: string): Promise<boolean> {
    const user = await requireUser(userId);
    if (!user.totpEnabled || !user.totpSecret) return false;

    const totp = verifyTotp(user.totpSecret, code, user.totpLastStep);
    if (totp.ok) {
      await db.adminUser.update({ where: { id: userId }, data: { totpLastStep: totp.step } });
      return true;
    }

    const codes = (Array.isArray(user.backupCodes) ? (user.backupCodes as unknown as BackupCode[]) : []).slice();
    for (const [i, backupCode] of codes.entries()) {
      if (backupCode.usedAt) continue;
      if (await verifyPassword(code, backupCode.hash)) {
        codes[i] = { ...backupCode, usedAt: new Date().toISOString() };
        await db.adminUser.update({ where: { id: userId }, data: { backupCodes: codes as unknown as Prisma.InputJsonValue } });
        return true;
      }
    }
    return false;
  },

  async status(userId: string): Promise<{ enabled: boolean; unusedBackupCodes: number }> {
    const user = await requireUser(userId);
    const codes = Array.isArray(user.backupCodes) ? (user.backupCodes as unknown as BackupCode[]) : [];
    return { enabled: user.totpEnabled, unusedBackupCodes: codes.filter((c) => !c.usedAt).length };
  },

  /**
   * What switching enforcement on would actually do to this install.
   *
   * Shown BEFORE the toggle, not discovered after. The API-token count is the
   * part that surprises people: a token issued by an account without 2FA
   * stops working the moment enforcement is on, and an integration failing
   * silently at 3am is a worse outcome than the toggle being one click slower.
   */
  async enforcementReadiness(): Promise<{
    total: number;
    enrolled: number;
    withoutTwoFactor: { id: string; username: string; apiTokens: number }[];
    affectedApiTokens: number;
  }> {
    const users = await db.adminUser.findMany({
      select: {
        id: true,
        username: true,
        totpEnabled: true,
        // Revoked tokens cannot be used, so counting them would overstate
        // the damage and make this warning easy to dismiss.
        _count: { select: { apiTokens: { where: { revokedAt: null } } } },
      },
      orderBy: { username: 'asc' },
    });
    const without = users
      .filter((u) => !u.totpEnabled)
      .map((u) => ({ id: u.id, username: u.username, apiTokens: u._count.apiTokens }));
    return {
      total: users.length,
      enrolled: users.filter((u) => u.totpEnabled).length,
      withoutTwoFactor: without,
      affectedApiTokens: without.reduce((n, u) => n + u.apiTokens, 0),
    };
  },
};

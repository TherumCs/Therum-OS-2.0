import { z } from 'zod';

const Username = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[a-zA-Z0-9._-]+$/, 'Username may only contain letters, numbers, dots, dashes, and underscores.');

// 10, not 8 — favoring length over forced complexity rules (mixed
// case/digit/symbol requirements tend to produce predictable patterns like
// "Password1!" rather than actually stronger passwords; current NIST
// guidance favors length). 1.9.44 had no password policy at all on this
// step (confirmed in the research pass) — this is a real gap closed, not a
// port of anything.
const Password = z.string().min(10, 'Password must be at least 10 characters.');

export const SetupInput = z.object({
  username: Username,
  password: Password,
});

export const LoginInput = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const VerifyTwoFactorInput = z.object({
  challengeToken: z.string().min(1),
  code: z.string().min(1),
});

export const TwoFactorConfirmInput = z.object({
  code: z.string().min(1),
});

export const IssueApiTokenInput = z.object({
  name: z.string().min(1).max(80),
  scope: z.enum(['read', 'write']).default('read'),
  expiresInDays: z.number().int().positive().max(365).nullable().default(null),
});

// There was previously no way to rotate your password after the one-time
// setup at all — a real gap, not something 1.9.44 had either (it just used
// WordPress's native profile screen for this, which has no 2.0 equivalent).
export const ChangePasswordInput = z.object({
  currentPassword: z.string().min(1),
  newPassword: Password,
});

export type SetupInput = z.infer<typeof SetupInput>;
export type LoginInput = z.infer<typeof LoginInput>;
export type VerifyTwoFactorInput = z.infer<typeof VerifyTwoFactorInput>;
export type TwoFactorConfirmInput = z.infer<typeof TwoFactorConfirmInput>;
export type IssueApiTokenInput = z.infer<typeof IssueApiTokenInput>;
export type ChangePasswordInput = z.infer<typeof ChangePasswordInput>;

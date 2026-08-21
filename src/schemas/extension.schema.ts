import { z } from 'zod';

// Permissions an extension must declare upfront — no "I need users" surprise.
export const Permission = z.enum([
  'products:read',
  'products:write',
  'orders:read',
  'orders:write',
  'customers:read',
  'webhooks:manage',
]);

export const ExtensionManifest = z.object({
  hooks: z.array(z.string()).default([]),
  permissions: z.array(Permission).default([]),
  uiEntry: z.string().optional(),
});

export const RegisterExtensionInput = z.object({
  name: z.string().min(1).max(120),
  version: z.string().min(1).max(40),
  manifest: ExtensionManifest,
  config: z.record(z.string(), z.unknown()).default({}),
  enabled: z.boolean().default(false),
});

export const UpdateExtensionInput = z.object({
  enabled: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export type Permission = z.infer<typeof Permission>;
export type ExtensionManifest = z.infer<typeof ExtensionManifest>;
export type RegisterExtensionInput = z.infer<typeof RegisterExtensionInput>;
export type UpdateExtensionInput = z.infer<typeof UpdateExtensionInput>;

// Known hook points the core fires. Extensions hook services, not routes.
export const HOOK_POINTS = [
  'onProductCreate',
  'onProductUpdate',
  'onOrderCreate',
  'onOrderPaid',
  'onContentCreate',
  'onContentPublish',
  'onImportStart',
  'onImportRow',
  'onImportEnd',
  // Milieus (M3): fired by the daily sweep for memberships expiring within
  // the reminder window — at most once per membership (reminderSentAt).
  'onMembershipExpiringSoon',
  // Milieus: fired per membership removed by the sweep (member duration hit,
  // or the whole milieu's lifetime ended) — the seam notifications/webhooks/
  // audit hook into.
  'onMembershipRevoked',
] as const;
export type HookPoint = (typeof HOOK_POINTS)[number];

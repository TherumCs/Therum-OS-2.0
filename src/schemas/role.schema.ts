import { z } from 'zod';

// The 7 composable capability bundles from 1.9.44's Permissions page —
// canonical list also lives in role.service.ts's BUNDLES (kept as plain
// exported consts there since Zod enums and UI option lists both need to
// iterate the same values; this schema just enforces membership).
export const BUNDLE_VALUES = [
  'read',
  'write',
  'publish',
  'edit-broadly',
  'manage-settings',
  'storefront-customer',
  'storefront-manager',
] as const;
export type Bundle = (typeof BUNDLE_VALUES)[number];

export const CreateRoleInput = z.object({
  name: z.string().min(1).max(60),
  bundles: z.array(z.enum(BUNDLE_VALUES)).default([]),
});
export type CreateRoleInput = z.infer<typeof CreateRoleInput>;

export const UpdateRoleInput = z.object({
  name: z.string().min(1).max(60).optional(),
  bundles: z.array(z.enum(BUNDLE_VALUES)).optional(),
});
export type UpdateRoleInput = z.infer<typeof UpdateRoleInput>;

export const AssignRoleInput = z.object({
  roleId: z.string().nullable(), // null = full admin
});
export type AssignRoleInput = z.infer<typeof AssignRoleInput>;

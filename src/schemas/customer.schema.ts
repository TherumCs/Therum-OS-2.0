import { z } from 'zod';

export const AddressInput = z.object({
  line1: z.string().min(1),
  line2: z.string().optional(),
  city: z.string().min(1),
  region: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().min(2).max(2),
  isDefault: z.boolean().default(false),
});

export const CreateCustomerInput = z.object({
  // Lowercased on write so the stored value matches every auth/reset lookup,
  // which all lowercase. A mixed-case stored email against the case-sensitive
  // column permanently locked the account out.
  email: z.string().email().transform((s) => s.toLowerCase()),
  name: z.string().max(200).optional(),
  meta: z.record(z.string(), z.unknown()).default({}),
  addresses: z.array(AddressInput).default([]),
});

export const ListCustomersQuery = z.object({
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

// Display name / username is freely editable; first/last are the real name.
// All nullable so the admin can clear a field.
export const UpdateCustomerInput = z.object({
  name: z.string().max(200).nullable().optional(),
  firstName: z.string().max(120).nullable().optional(),
  lastName: z.string().max(120).nullable().optional(),
});

export type CreateCustomerInput = z.infer<typeof CreateCustomerInput>;
export type ListCustomersQuery = z.infer<typeof ListCustomersQuery>;
export type UpdateCustomerInput = z.infer<typeof UpdateCustomerInput>;

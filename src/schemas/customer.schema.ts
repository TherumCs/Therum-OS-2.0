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
  email: z.string().email(),
  name: z.string().max(200).optional(),
  meta: z.record(z.string(), z.unknown()).default({}),
  addresses: z.array(AddressInput).default([]),
});

export const ListCustomersQuery = z.object({
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export type CreateCustomerInput = z.infer<typeof CreateCustomerInput>;
export type ListCustomersQuery = z.infer<typeof ListCustomersQuery>;

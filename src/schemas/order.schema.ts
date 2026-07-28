import { z } from 'zod';
import { sortFields } from './listing.js';

export const OrderItemInput = z.object({
  variantId: z.string().min(1),
  quantity: z.number().int().positive(),
});

export const CreateOrderInput = z.object({
  customerId: z.string().optional(),
  // Two-decimal currencies only for now — zero-decimal (JPY/KRW/…) needs
  // explicit minor-unit normalization at each gateway before it's allowed
  // in (audit M-4). Expand deliberately, not by accepting any 3 letters.
  currency: z.enum(['USD', 'EUR', 'GBP', 'CAD', 'AUD']).default('USD'),
  // Optional client-supplied idempotency key — re-POST with the same key
  // returns the original order instead of creating a duplicate.
  idempotencyKey: z.string().max(200).optional(),
  // Guest contact email (storefront checkout) — receipt address only, never
  // resolved to a customer account (audit H-1).
  guestEmail: z.string().email().max(320).optional(),
  items: z.array(OrderItemInput).min(1, 'an order needs at least one item'),
});

export const TransitionOrderInput = z.object({
  status: z.enum(['processing', 'shipped', 'delivered', 'failed', 'cancelled']),
});

export const ListOrdersQuery = z.object({
  status: z.enum(['pending', 'processing', 'shipped', 'delivered', 'failed', 'cancelled']).optional(),
  customerId: z.string().optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
  ...sortFields(['createdAt', 'number', 'status', 'total'], 'createdAt'),
});

export type CreateOrderInput = z.infer<typeof CreateOrderInput>;
export type TransitionOrderInput = z.infer<typeof TransitionOrderInput>;
export type ListOrdersQuery = z.infer<typeof ListOrdersQuery>;

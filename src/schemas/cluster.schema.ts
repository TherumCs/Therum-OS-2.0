import { z } from 'zod';

export const CreateClusterInput = z.object({
  name: z.string().min(1).max(80),
  // A group of fewer than 2 products isn't a group (1.x auto-dissolves them).
  productIds: z.array(z.string().min(1)).min(2).max(50),
});

export const UpdateClusterInput = z.object({
  name: z.string().min(1).max(80).optional(),
  productIds: z.array(z.string().min(1)).min(2).max(50).optional(),
});

export const SetPrimaryInput = z.object({
  // null clears the override → primary reverts to the earliest member.
  productId: z.string().min(1).nullable(),
});

export type CreateClusterInput = z.infer<typeof CreateClusterInput>;
export type UpdateClusterInput = z.infer<typeof UpdateClusterInput>;
export type SetPrimaryInput = z.infer<typeof SetPrimaryInput>;

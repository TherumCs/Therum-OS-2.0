import { z } from 'zod';

export const ConnectInput = z.object({ credential: z.string().min(1).max(2000) });
export type ConnectInput = z.infer<typeof ConnectInput>;

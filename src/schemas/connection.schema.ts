import { z } from 'zod';

export const ConnectInput = z.object({
  // 4000, not 2000: a Printify personal access token is a JWT well over a
  // thousand characters, and a cap that truncates a valid credential fails as
  // "invalid key" with nothing pointing at the real cause.
  credential: z.string().min(1).max(4000),
  /**
   * WHICH connect route the operator chose.
   *
   * A provider can offer several — Printful takes a key pair this store issues
   * AND a private token of its own — and the stored string means something
   * different in each case. The tester reads this to run the matching check;
   * testing a token as if it were a store key reports a failure for a
   * credential that is perfectly good.
   */
  method: z.enum(['fields', 'api-token', 'oauth', 'store-pull']).default('fields'),
});
export type ConnectInput = z.infer<typeof ConnectInput>;

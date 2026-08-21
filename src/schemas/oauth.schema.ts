import { z } from 'zod';

export const OAuthAppInput = z.object({
  clientId: z.string().min(1).max(500),
  clientSecret: z.string().min(1).max(500),
});
export type OAuthAppInput = z.infer<typeof OAuthAppInput>;

export const OAuthCallbackInput = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
  redirectUri: z.string().url(),
});
export type OAuthCallbackInput = z.infer<typeof OAuthCallbackInput>;

import { z } from 'zod';

// Parse, don't trust — the process won't boot with a bad environment.
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4100),
  HOST: z.string().default('0.0.0.0'),
  // The admin (Next.js) runs as an internal upstream only — it is reached
  // through this server's /tos-admin proxy, never addressed directly.
  ADMIN_UPSTREAM_PORT: z.coerce.number().int().positive().default(3100),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars'),
  // Shared secret for verifying inbound payment webhooks (HMAC-SHA256). Optional
  // in dev; the webhook route 503s until it's set.
  WEBHOOK_SECRET: z.string().min(16).optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  // Comma-separated allowed origins for CORS. Defaults to the admin (3000) and
  // builder (5174) dev ports. In production this MUST be set explicitly.
  CORS_ORIGINS: z.string().default('http://localhost:3100,http://localhost:5174,http://localhost:10004'),
});

export type Env = z.infer<typeof EnvSchema>;

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment:\n', JSON.stringify(parsed.error.flatten().fieldErrors, null, 2));
  process.exit(1);
}

export const env: Env = parsed.data;

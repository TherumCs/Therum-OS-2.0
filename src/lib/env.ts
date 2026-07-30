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
  // SEPARATE from JWT_SECRET on purpose, and it matters.
  //
  // Nexus credentials (payment provider keys and the like) used to be
  // encrypted with a key derived from JWT_SECRET. That made the two
  // impossible to rotate independently: changing the signing key — the
  // ordinary response to a leaked or weak one — would silently make every
  // stored credential undecryptable. Signing keys should be cheap to rotate;
  // an encryption key is only rotated with a re-encryption pass.
  //
  // Optional so an existing install still boots. When unset, crypto.ts falls
  // back to the old JWT_SECRET derivation, which keeps already-encrypted
  // credentials readable — see the comment there.
  CREDENTIAL_KEY: z.string().min(32, 'CREDENTIAL_KEY must be at least 32 chars').optional(),
  // Shared secret for verifying inbound payment webhooks (HMAC-SHA256). Optional
  // in dev; the webhook route 503s until it's set.
  WEBHOOK_SECRET: z.string().min(16).optional(),
  // OAuth apps this PLATFORM owns, so "Authorize with X" is one click instead
  // of asking every merchant to register a developer app first. JSON:
  //   {"square":{"clientId":"…","clientSecret":"…"}, "stripe":{…}}
  // Absent is fine — providers simply fall back to a per-install app.
  OAUTH_APPS: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  // Comma-separated allowed origins for CORS. Defaults to the admin (3000) and
  // builder (5174) dev ports. In production this MUST be set explicitly.
  CORS_ORIGINS: z.string().default('http://localhost:3100,http://localhost:5174,http://localhost:10004'),
});

export type Env = z.infer<typeof EnvSchema>;

// PRODUCTION GATE. The system-health preflight already reports on these, but a
// warning on a dashboard nobody opened is not protection: the point of failure
// here is a deploy, and a deploy should stop. Development is left alone.
const PROD_REQUIRED = (e: Env): string[] => {
  const bad: string[] = [];
  if (/dev-only|change-?me|placeholder|secret123/i.test(e.JWT_SECRET)) {
    bad.push('JWT_SECRET is still a development placeholder.');
  }
  if (!e.CREDENTIAL_KEY) {
    // Without it, crypto.ts derives the credential key from JWT_SECRET — so
    // rotating the signing key silently orphans every stored payment
    // credential. Fine to defer in dev; not something to discover in prod.
    bad.push('CREDENTIAL_KEY must be set so it can be rotated apart from JWT_SECRET.');
  }
  const origins = e.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
  if (origins.includes('*')) bad.push('CORS_ORIGINS must not be wildcarded.');
  if (origins.every((o) => /^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(o))) {
    bad.push('CORS_ORIGINS is still localhost-only — set the real origin(s).');
  }
  return bad;
};

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment:\n', JSON.stringify(parsed.error.flatten().fieldErrors, null, 2));
  process.exit(1);
}

export const env: Env = parsed.data;

if (env.NODE_ENV === 'production') {
  const problems = PROD_REQUIRED(env);
  if (problems.length) {
    // eslint-disable-next-line no-console
    console.error('Refusing to start in production:\n' + problems.map((p) => `  - ${p}`).join('\n'));
    process.exit(1);
  }
}

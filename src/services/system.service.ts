import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db } from '../lib/db.js';
import { redis } from '../lib/redis.js';
import { env } from '../lib/env.js';

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8')) as { version: string };

export type CheckStatus = 'ok' | 'warn' | 'error';

export interface HealthCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

// Real checks against actual runtime state — the Node/Postgres equivalent of
// 1.9.44's dashboard Site Health card (pending updates / PHP version / HTTPS /
// debug-mode-in-prod), not a decorative "all green" placeholder. Each check
// is something that would actually bite a real deployment if wrong.
async function checkDatabase(): Promise<HealthCheck> {
  try {
    await db.$queryRaw`SELECT 1`;
    return { id: 'database', label: 'Database', status: 'ok', detail: 'Postgres reachable.' };
  } catch (err) {
    return { id: 'database', label: 'Database', status: 'error', detail: err instanceof Error ? err.message : 'Unreachable.' };
  }
}

async function checkRedis(): Promise<HealthCheck> {
  try {
    await redis.ping();
    return { id: 'redis', label: 'Redis / job queue', status: 'ok', detail: 'Redis reachable.' };
  } catch (err) {
    return { id: 'redis', label: 'Redis / job queue', status: 'error', detail: err instanceof Error ? err.message : 'Unreachable — background jobs will not run.' };
  }
}

function checkJwtSecret(): HealthCheck {
  const secret = env.JWT_SECRET;
  if (secret.startsWith('dev-only-change-me')) {
    return { id: 'jwt-secret', label: 'JWT secret', status: 'error', detail: 'Still set to the dev placeholder — replace before any real deployment.' };
  }
  // Length alone is not strength: the shipped placeholder was 71 characters,
  // most of them zeroes, and passed a length check comfortably. Counting
  // DISTINCT characters catches padded and repeated values, which is the
  // shape a hand-written "long" secret usually takes.
  const distinct = new Set(secret).size;
  if (distinct < 16) {
    return {
      id: 'jwt-secret',
      label: 'JWT secret',
      status: 'error',
      detail: `Only ${distinct} distinct characters — this looks padded rather than random. Generate one with: openssl rand -base64 48`,
    };
  }
  return { id: 'jwt-secret', label: 'JWT secret', status: 'ok', detail: 'A real secret is configured.' };
}

// Nexus credentials are encrypted with CREDENTIAL_KEY. Without it they fall
// back to a key derived from JWT_SECRET, which means the signing key can no
// longer be rotated without destroying every stored credential — worth
// surfacing while the vault is still small enough to re-enter by hand.
function checkCredentialKey(): HealthCheck {
  if (!env.CREDENTIAL_KEY) {
    return {
      id: 'credential-key',
      label: 'Credential encryption key',
      status: 'warn',
      detail: 'Not set — connection secrets are encrypted with a key derived from JWT_SECRET, so the two cannot be rotated independently.',
    };
  }
  if (env.CREDENTIAL_KEY === env.JWT_SECRET) {
    return {
      id: 'credential-key',
      label: 'Credential encryption key',
      status: 'error',
      detail: 'Identical to JWT_SECRET — set it to a different value, or rotating one breaks the other.',
    };
  }
  return { id: 'credential-key', label: 'Credential encryption key', status: 'ok', detail: 'Set, and distinct from the signing secret.' };
}

function checkCors(): HealthCheck {
  const origins = env.CORS_ORIGINS.split(',').map((o) => o.trim());
  if (env.NODE_ENV === 'production' && origins.includes('*')) {
    return { id: 'cors', label: 'CORS', status: 'error', detail: 'CORS_ORIGINS is wildcarded in production.' };
  }
  const onlyLocalhost = origins.every((o) => o.includes('localhost'));
  if (env.NODE_ENV === 'production' && onlyLocalhost) {
    return { id: 'cors', label: 'CORS', status: 'warn', detail: 'Only localhost origins are allowed — is this intentional in production?' };
  }
  return { id: 'cors', label: 'CORS', status: 'ok', detail: `${origins.length} allowed origin(s) configured.` };
}

function checkNodeEnv(): HealthCheck {
  if (env.NODE_ENV === 'development') {
    return { id: 'node-env', label: 'Environment', status: 'warn', detail: 'Running in development mode.' };
  }
  return { id: 'node-env', label: 'Environment', status: 'ok', detail: `Running in ${env.NODE_ENV}.` };
}

function checkWebhookSecret(): HealthCheck {
  if (!env.WEBHOOK_SECRET) {
    return { id: 'webhook-secret', label: 'Payment webhook secret', status: 'warn', detail: 'Not set — inbound payment webhooks will 503.' };
  }
  return { id: 'webhook-secret', label: 'Payment webhook secret', status: 'ok', detail: 'Configured.' };
}

// admin/ and builder/ ship their own package.json and are deployed separately,
// so a mismatch with the API's version is a real operational fact worth seeing
// rather than an assumption. Missing/unreadable reads as 'unknown', never as
// the API's own version.
function readSiblingVersion(dir: 'admin' | 'builder'): string {
  try {
    const raw = readFileSync(join(process.cwd(), dir, 'package.json'), 'utf8');
    return (JSON.parse(raw) as { version?: string }).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export const systemService = {
  async health(): Promise<{ status: CheckStatus; checks: HealthCheck[] }> {
    const checks = await Promise.all([checkDatabase(), checkRedis(), Promise.resolve(checkJwtSecret()), Promise.resolve(checkCredentialKey()), Promise.resolve(checkCors()), Promise.resolve(checkNodeEnv()), Promise.resolve(checkWebhookSecret())]);
    const status: CheckStatus = checks.some((c) => c.status === 'error') ? 'error' : checks.some((c) => c.status === 'warn') ? 'warn' : 'ok';
    return { status, checks };
  },

  // Matches 1.9.44's Settings > About panel (version/db/credits), read from
  // real runtime values rather than hand-maintained strings that drift.
  // The About panel used to show four bare values. What an operator actually
  // wants off this screen is "what am I running, on what, and is it healthy" —
  // so it now also reports uptime, the platform, and the pieces that are
  // separately deployable (admin, builder) and can silently drift out of step
  // with the API version.
  about(): {
    version: string;
    node: string;
    database: string;
    env: string;
    platform: string;
    uptimeSeconds: number;
    startedAt: string;
    adminVersion: string;
    builderVersion: string;
  } {
    return {
      version: pkg.version,
      node: process.version,
      database: 'PostgreSQL',
      env: env.NODE_ENV,
      platform: `${process.platform} ${process.arch}`,
      uptimeSeconds: Math.round(process.uptime()),
      startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      adminVersion: readSiblingVersion('admin'),
      builderVersion: readSiblingVersion('builder'),
    };
  },

  // Settings > Performance's "PHP runtime" panel, translated to this stack's
  // real equivalent — Node's own memory stats, not a fabricated PHP-shaped one.
  runtime(): { rssMb: number; heapUsedMb: number; heapTotalMb: number; nodeVersion: string } {
    const mem = process.memoryUsage();
    const mb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10;
    return { rssMb: mb(mem.rss), heapUsedMb: mb(mem.heapUsed), heapTotalMb: mb(mem.heapTotal), nodeVersion: process.version };
  },
};

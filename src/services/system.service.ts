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
  const insecureDefault = env.JWT_SECRET.startsWith('dev-only-change-me');
  if (insecureDefault) {
    return { id: 'jwt-secret', label: 'JWT secret', status: 'error', detail: 'Still set to the dev placeholder — replace before any real deployment.' };
  }
  return { id: 'jwt-secret', label: 'JWT secret', status: 'ok', detail: 'A real secret is configured.' };
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

export const systemService = {
  async health(): Promise<{ status: CheckStatus; checks: HealthCheck[] }> {
    const checks = await Promise.all([checkDatabase(), checkRedis(), Promise.resolve(checkJwtSecret()), Promise.resolve(checkCors()), Promise.resolve(checkNodeEnv()), Promise.resolve(checkWebhookSecret())]);
    const status: CheckStatus = checks.some((c) => c.status === 'error') ? 'error' : checks.some((c) => c.status === 'warn') ? 'warn' : 'ok';
    return { status, checks };
  },

  // Matches 1.9.44's Settings > About panel (version/db/credits), read from
  // real runtime values rather than hand-maintained strings that drift.
  about(): { version: string; node: string; database: string; env: string } {
    return { version: pkg.version, node: process.version, database: 'PostgreSQL', env: env.NODE_ENV };
  },

  // Settings > Performance's "PHP runtime" panel, translated to this stack's
  // real equivalent — Node's own memory stats, not a fabricated PHP-shaped one.
  runtime(): { rssMb: number; heapUsedMb: number; heapTotalMb: number; nodeVersion: string } {
    const mem = process.memoryUsage();
    const mb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10;
    return { rssMb: mb(mem.rss), heapUsedMb: mb(mem.heapUsed), heapTotalMb: mb(mem.heapTotal), nodeVersion: process.version };
  },
};

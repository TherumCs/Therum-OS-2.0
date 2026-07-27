import { redis } from './redis.js';

// Redis-backed fixed-window counter. 1.9.44 never had this on the primary
// password step at all (confirmed in the research pass — only the 2FA code
// step was throttled) — this closes that gap rather than porting anything.
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export async function checkRateLimit(key: string, max: number, windowSeconds: number): Promise<RateLimitResult> {
  const redisKey = `ratelimit:${key}`;
  const count = await redis.incr(redisKey);
  if (count === 1) await redis.expire(redisKey, windowSeconds);
  const ttl = await redis.ttl(redisKey);
  const retryAfterSeconds = ttl > 0 ? ttl : windowSeconds;
  return { allowed: count <= max, remaining: Math.max(0, max - count), retryAfterSeconds };
}

// Only call after an actual success — a failed attempt should keep counting
// against the window, that's the whole point of the limiter.
export async function clearRateLimit(key: string): Promise<void> {
  await redis.del(`ratelimit:${key}`);
}

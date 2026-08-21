import { redis } from './redis.js';

// Redis-backed fixed-window counter. 1.9.44 never had this on the primary
// password step at all (confirmed in the research pass — only the 2FA code
// step was throttled) — this closes that gap rather than porting anything.
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

// INCR then EXPIRE as two commands has a fatal gap: a crash (or a failover)
// between them leaves the counter with NO expiry, so it never resets and that
// key is locked out forever. This Lua runs atomically in Redis — increment,
// and whenever the key has no TTL (a fresh key OR a previously-stranded one),
// arm the window. Self-healing: a key stuck from before this fix recovers on
// its next hit instead of staying wedged.
const RATE_LIMIT_LUA = `
local c = redis.call('INCR', KEYS[1])
local t = redis.call('TTL', KEYS[1])
if t < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  t = tonumber(ARGV[1])
end
return {c, t}`;

export async function checkRateLimit(key: string, max: number, windowSeconds: number): Promise<RateLimitResult> {
  const redisKey = `ratelimit:${key}`;
  const [count, ttl] = (await redis.eval(RATE_LIMIT_LUA, 1, redisKey, String(windowSeconds))) as [number, number];
  const retryAfterSeconds = ttl > 0 ? ttl : windowSeconds;
  return { allowed: count <= max, remaining: Math.max(0, max - count), retryAfterSeconds };
}

// Only call after an actual success — a failed attempt should keep counting
// against the window, that's the whole point of the limiter.
export async function clearRateLimit(key: string): Promise<void> {
  await redis.del(`ratelimit:${key}`);
}

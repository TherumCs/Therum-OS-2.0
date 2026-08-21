import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { promisify } from 'node:util';

// The promisified scrypt's default typing drops the options overload; assert
// the 4-arg (with options) signature so N/maxmem can be passed.
const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
  options?: ScryptOptions,
) => Promise<Buffer>;
const KEY_LEN = 64;

// New hashes use N = 2^17 (OWASP's recommendation for scrypt on new systems);
// Node's built-in default is 2^14. The cost is stored IN the hash so raising it
// can never lock anyone out: a legacy "salt:hash" still verifies at 2^14, a new
// "scrypt$N$salt$hash" verifies at whatever N it carries. scrypt at 2^17 needs
// ~256MB working memory, above Node's 32MB default, so maxmem is set to match.
const SCRYPT_N = 1 << 17;
const LEGACY_N = 1 << 14; // Node's default, what every "salt:hash" was made at.
const scryptMaxmem = (n: number): number => Math.max(32 * 1024 * 1024, 256 * n * 8);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = (await scryptAsync(password, salt, KEY_LEN, { N: SCRYPT_N, maxmem: scryptMaxmem(SCRYPT_N) })) as Buffer;
  return `scrypt$${SCRYPT_N}$${salt}$${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  let salt: string, hashHex: string, n: number;
  if (stored.startsWith('scrypt$')) {
    const parts = stored.split('$'); // scrypt$N$salt$hash
    n = Number(parts[1]);
    salt = parts[2] ?? '';
    hashHex = parts[3] ?? '';
    if (!Number.isInteger(n) || n < 2) return false;
  } else {
    // Legacy format "salt:hash", hashed at Node's default cost.
    [salt, hashHex] = stored.split(':') as [string, string];
    n = LEGACY_N;
  }
  if (!salt || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const derived = (await scryptAsync(password, salt, expected.length, { N: n, maxmem: scryptMaxmem(n) })) as Buffer;
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

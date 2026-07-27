import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// RFC 6238 TOTP (30s step, 6 digits, SHA-1) + RFC 4648 base32, hand-rolled
// with node:crypto rather than adding a dependency — same philosophy as this
// codebase's own JWT signing (auth.service.ts). No QR generation: manual
// secret entry only (see the AdminUser.totpSecret comment in schema.prisma
// for why) — that also means no new dependency for QR rendering either.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = '';
  for (const byte of buf) bits += byte.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) out += ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  const rem = bits.length % 5;
  if (rem > 0) out += ALPHABET[parseInt(bits.slice(bits.length - rem).padEnd(5, '0'), 2)];
  return out;
}

function base32Decode(str: string): Buffer {
  const clean = str.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function generateSecret(): string {
  return base32Encode(randomBytes(20)); // 160-bit secret, the RFC 4226 recommendation
}

// Groups of 4 for readability when displaying for manual entry (matches how
// authenticator apps and 1.9.44's own enrollment screen present it).
export function formatSecretForDisplay(secret: string): string {
  return secret.match(/.{1,4}/g)?.join(' ') ?? secret;
}

function codeForStep(secret: string, step: number): string {
  const key = base32Decode(secret);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', key).update(counter).digest();
  // HMAC-SHA1 always digests to exactly 20 bytes, so `offset` (0-15, from the
  // low nibble of the last byte) and offset+3 (max 18) are always in bounds —
  // these accesses can't actually be undefined, unlike a truly dynamic index.
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binCode = ((hmac[offset]! & 0x7f) << 24) | ((hmac[offset + 1]! & 0xff) << 16) | ((hmac[offset + 2]! & 0xff) << 8) | (hmac[offset + 3]! & 0xff);
  return String(binCode % 10 ** DIGITS).padStart(DIGITS, '0');
}

export interface VerifyResult {
  ok: boolean;
  step?: number; // the accepted step, for anti-replay tracking
}

// ±1 step (30s) tolerance for clock drift, matching common TOTP practice and
// 1.9.44's own implementation. `lastAcceptedStep` blocks immediate code
// reuse — a code is only ever valid once, even within its own 30s window.
export function verifyTotp(secret: string, code: string, lastAcceptedStep: number | null): VerifyResult {
  if (!/^\d{6}$/.test(code)) return { ok: false };
  const now = Math.floor(Date.now() / 1000 / STEP_SECONDS);
  for (const step of [now, now - 1, now + 1]) {
    if (lastAcceptedStep !== null && step <= lastAcceptedStep) continue;
    const expected = codeForStep(secret, step);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(code))) return { ok: true, step };
  }
  return { ok: false };
}

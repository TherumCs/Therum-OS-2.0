import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from './env.js';

// Key derivation, not the raw secret as key material — a fixed
// domain-separation string keeps this key cryptographically distinct from
// anything else derived from the same input.
//
// CREDENTIAL_KEY is its own env var, separate from JWT_SECRET. Deriving both
// from JWT_SECRET (as this did originally) welded them together: rotating the
// signing key — the normal response to a weak or leaked one — would silently
// make every stored Nexus credential undecryptable, and the failure would
// only show up the next time a payment provider was called.
//
// The JWT_SECRET fallback exists so an install that predates CREDENTIAL_KEY
// still boots and can still read what it already encrypted. Setting
// CREDENTIAL_KEY on an install with existing credentials therefore requires a
// re-encryption pass; setting it before any credential is stored (as here)
// costs nothing.
function deriveKey(): Buffer {
  const material = env.CREDENTIAL_KEY ?? env.JWT_SECRET;
  return createHash('sha256').update(`nexus-credential-key:${material}`).digest();
}

const ALGO = 'aes-256-gcm';
// GCM's authentication tag is what makes this tamper-evident. Node will
// otherwise ACCEPT A SHORTER TAG than the 16 bytes we write — and a 4-byte
// tag is ~2^96 times easier to forge. Pinning the length on both sides means
// a truncated tag is rejected outright instead of being verified weakly.
const TAG_LENGTH = 16;
const IV_LENGTH = 12;

// Packed as iv(12) + authTag(16) + ciphertext, base64 — one opaque string
// to store, no separate columns for iv/tag to keep in sync.
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, deriveKey(), iv, { authTagLength: TAG_LENGTH });
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

export function decryptSecret(packed: string): string {
  const buf = Buffer.from(packed, 'base64');
  // Reject anything too short to even contain iv + full tag, rather than
  // slicing a partial tag and handing it to setAuthTag.
  if (buf.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error('Stored secret is malformed — refusing to decrypt.');
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv(ALGO, deriveKey(), iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function maskSecret(plaintext: string): string {
  if (plaintext.length <= 4) return '••••';
  return `${'•'.repeat(Math.min(6, plaintext.length - 4))}${plaintext.slice(-4)}`;
}

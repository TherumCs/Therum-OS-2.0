import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from './env.js';

// Key derivation, not JWT_SECRET as key material directly — a fixed domain-
// separation string keeps this key cryptographically distinct from anything
// else that might ever derive from JWT_SECRET, even though nothing else
// does today. No new required env var: every environment already has
// JWT_SECRET set.
function deriveKey(): Buffer {
  return createHash('sha256').update(`nexus-credential-key:${env.JWT_SECRET}`).digest();
}

const ALGO = 'aes-256-gcm';

// Packed as iv(12) + authTag(16) + ciphertext, base64 — one opaque string
// to store, no separate columns for iv/tag to keep in sync.
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, deriveKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

export function decryptSecret(packed: string): string {
  const buf = Buffer.from(packed, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = createDecipheriv(ALGO, deriveKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function maskSecret(plaintext: string): string {
  if (plaintext.length <= 4) return '••••';
  return `${'•'.repeat(Math.min(6, plaintext.length - 4))}${plaintext.slice(-4)}`;
}

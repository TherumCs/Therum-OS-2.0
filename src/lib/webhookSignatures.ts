import { createHmac, timingSafeEqual } from 'node:crypto';

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// GitHub: X-Hub-Signature-256: sha256=<hex HMAC-SHA256 of the raw body>.
export function verifyGithubSignature(rawBody: string, header: string | undefined, secret: string): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  return safeEqual(header, expected);
}

// Stripe: Stripe-Signature: t=<unix ts>,v1=<hex HMAC-SHA256 of "ts.rawBody">.
export function verifyStripeSignature(rawBody: string, header: string | undefined, secret: string, toleranceSeconds = 300): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=') as [string, string]));
  if (!parts.t || !parts.v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex');
  return safeEqual(parts.v1, expected);
}

// Slack: X-Slack-Signature: v0=<hex HMAC-SHA256 of "v0:ts:rawBody">, alongside X-Slack-Request-Timestamp.
export function verifySlackSignature(rawBody: string, signatureHeader: string | undefined, timestampHeader: string | undefined, secret: string, toleranceSeconds = 300): boolean {
  if (!signatureHeader?.startsWith('v0=') || !timestampHeader) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestampHeader)) > toleranceSeconds) return false;
  const expected = `v0=${createHmac('sha256', secret).update(`v0:${timestampHeader}:${rawBody}`).digest('hex')}`;
  return safeEqual(signatureHeader, expected);
}

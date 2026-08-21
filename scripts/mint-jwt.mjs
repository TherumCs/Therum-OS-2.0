// Mint a short-lived admin JWT for testing protected routes.
// Run: node --env-file=.env scripts/mint-jwt.mjs [role]
import { createHmac } from 'node:crypto';

const secret = process.env.JWT_SECRET;
if (!secret) {
  console.error('JWT_SECRET not set — run with: node --env-file=.env scripts/mint-jwt.mjs');
  process.exit(1);
}

const role = process.argv[2] ?? 'admin';
const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const now = Math.floor(Date.now() / 1000);

const header = b64url({ alg: 'HS256', typ: 'JWT' });
const payload = b64url({ sub: 'test-admin', role, iat: now, exp: now + 3600 });
const data = `${header}.${payload}`;
const sig = createHmac('sha256', secret).update(data).digest('base64url');

console.log(`${data}.${sig}`);

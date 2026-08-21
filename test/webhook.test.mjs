// Unit test for the webhook HMAC verifier. Run: npm run build && npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyHmac } from '../dist/lib/webhook.js';

test('verifyHmac accepts a valid signature', () => {
  const secret = 'topsecret';
  const body = JSON.stringify({ type: 'payment.succeeded', orderId: 'abc' });
  const sig = createHmac('sha256', secret).update(body).digest('hex');
  assert.equal(verifyHmac(body, sig, secret), true);
});

test('verifyHmac rejects tampering, wrong sig, and missing sig', () => {
  const secret = 'topsecret';
  const body = JSON.stringify({ type: 'payment.succeeded', orderId: 'abc' });
  const sig = createHmac('sha256', secret).update(body).digest('hex');
  assert.equal(verifyHmac(body + 'x', sig, secret), false, 'tampered body');
  assert.equal(verifyHmac(body, 'deadbeef', secret), false, 'wrong sig');
  assert.equal(verifyHmac(body, undefined, secret), false, 'missing sig');
  assert.equal(verifyHmac(body, sig, 'othersecret'), false, 'wrong secret');
});

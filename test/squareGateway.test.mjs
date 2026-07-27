// C5a — Square gateway: the pure/offline surfaces (webhook signature,
// event mapping, credential parsing, method-strip lighting). Live API calls
// (payment links, refunds) are exercised against real Square sandbox
// credentials once connected in Nexus — not mocked here.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { buildServer } from '../dist/server.js';
import { closeQueues } from '../dist/lib/queue.js';
import { db, disconnectDb } from '../dist/lib/db.js';
import { encryptSecret } from '../dist/lib/crypto.js';
import { squareGateway } from '../dist/lib/payments/squareGateway.js';

let app;

const SIG_KEY = 'sq-test-signature-key';
const NOTIFY_URL = 'https://example.com/api/webhooks/psp/square';
const WEBHOOK_CRED = `${SIG_KEY}|${NOTIFY_URL}`;

function signed(body) {
  const raw = JSON.stringify(body);
  const sig = createHmac('sha256', SIG_KEY).update(NOTIFY_URL + raw).digest('base64');
  return { raw, sig };
}

before(async () => {
  app = await buildServer();
});

after(async () => {
  await db.connection.deleteMany({ where: { provider: 'square' } });
  await db.connectionAuditLog.deleteMany({ where: { provider: 'square' } });
  await app.close();
  await closeQueues();
  await disconnectDb();
});

test('webhook: valid HMAC(url+body) verifies; tampered body throws; missing header null', async () => {
  const { raw, sig } = signed({ type: 'payment.updated', event_id: 'evt_sq1' });
  const ok = await squareGateway.verifyWebhook(raw, { 'x-square-hmacsha256-signature': sig }, WEBHOOK_CRED);
  assert.equal(ok.type, 'payment.updated');

  await assert.rejects(
    () => squareGateway.verifyWebhook(raw + ' ', { 'x-square-hmacsha256-signature': sig }, WEBHOOK_CRED),
    /signature mismatch/,
  );
  assert.equal(await squareGateway.verifyWebhook(raw, {}, WEBHOOK_CRED), null);
});

test('parseEvent: payment statuses map to canonical kinds; order_id recovered from note', () => {
  const completed = squareGateway.parseEvent({
    type: 'payment.updated', event_id: 'evt_sq2',
    data: { object: { payment: { status: 'COMPLETED', order_id: 'sqord_1', note: 'order_id:cm_local_1' } } },
  });
  assert.equal(completed.kind, 'payment.succeeded');
  assert.equal(completed.paymentIntentId, 'sqord_1');
  assert.equal(completed.payload.orderId, 'cm_local_1');

  const failed = squareGateway.parseEvent({
    type: 'payment.updated', event_id: 'evt_sq3',
    data: { object: { payment: { status: 'FAILED', order_id: 'sqord_1' } } },
  });
  assert.equal(failed.kind, 'payment.failed');

  const pending = squareGateway.parseEvent({
    type: 'payment.created', event_id: 'evt_sq4',
    data: { object: { payment: { status: 'PENDING', order_id: 'sqord_1' } } },
  });
  assert.equal(pending.kind, 'payment.pending', 'in-flight payments are ledgered, not acted on');
});

test('parseEvent: refund statuses map correctly (FAILED/REJECTED never read as succeeded)', () => {
  const ok = squareGateway.parseEvent({
    type: 'refund.updated', event_id: 'evt_sq5',
    data: { object: { refund: { status: 'COMPLETED', id: 'sqre_1', order_id: 'sqord_1' } } },
  });
  assert.equal(ok.kind, 'refund.succeeded');
  assert.equal(ok.refundId, 'sqre_1');

  for (const status of ['FAILED', 'REJECTED']) {
    const bad = squareGateway.parseEvent({
      type: 'refund.updated', event_id: 'evt_sq6',
      data: { object: { refund: { status, id: 'sqre_2', order_id: 'sqord_1' } } },
    });
    assert.equal(bad.kind, 'refund.failed', `${status} maps to refund.failed`);
  }
});

test('credential must be "accessToken|locationId" — malformed rejects before any network call', async () => {
  await assert.rejects(
    () => squareGateway.createIntent({ id: 'o1', number: 'THR-X', total: 1000, currency: 'USD' }, 'just-a-token'),
    /accessToken\|locationId/,
  );
});

test('connecting square lights up card + Cash App + Afterpay in the method strip', async () => {
  await db.connection.upsert({
    where: { provider: 'square' },
    update: { credentialEncrypted: encryptSecret('tok|loc|sandbox'), status: 'connected' },
    create: { provider: 'square', category: 'payments', credentialEncrypted: encryptSecret('tok|loc|sandbox'), maskedPreview: 'sq…', status: 'connected' },
  });
  const res = await app.inject({ method: 'GET', url: '/api/checkout/methods' });
  const methods = res.json().methods;
  const byId = (id) => methods.find((m) => m.id === id);
  assert.equal(byId('card').available, true);
  assert.equal(byId('card').provider, 'square', 'square resolves card (stripe not connected)');
  assert.equal(byId('cashapp').available, true, 'Cash App lights up via square');
  assert.equal(byId('afterpay').available, true, 'Afterpay lights up via square');
  assert.equal(byId('venmo').available, false, 'venmo still needs paypal');
});

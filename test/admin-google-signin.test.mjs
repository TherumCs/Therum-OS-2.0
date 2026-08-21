// Google sign-in for the partner approval screen.
//
// The security question this feature raises: a verified Google email proves WHO
// someone is, never that they may administer this store. These tests pin that
// distinction, because getting it wrong turns the approval page back into a
// credential vending machine with a nicer button.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { db, disconnectDb } from '../dist/lib/db.js';
import { closeQueues } from '../dist/lib/queue.js';
import { signState, readState, adminForGoogle, authorizeUrl } from '../dist/counter/adminGoogleSignIn.js';
import * as cryptoMod from 'node:crypto';

let linked;

before(async () => {
  linked = await db.adminUser.create({
    data: {
      username: 'google-link-test',
      passwordHash: 'x'.repeat(60),
      googleEmail: 'linked-tester@example.com',
    },
  });
});

after(async () => {
  await db.adminUser.deleteMany({ where: { username: 'google-link-test' } });
  await closeQueues();
  await disconnectDb();
});

describe('who Google sign-in is allowed to be', () => {
  test('a linked, verified Google account resolves to its admin', async () => {
    const who = await adminForGoogle({ email: 'linked-tester@example.com', emailVerified: true });
    assert.ok(who, 'a linked account should resolve');
    assert.equal(who.id, linked.id);
  });

  test('an UNLINKED verified Google account gets nothing', async () => {
    // The whole point: anyone can obtain a verified Google account in a minute.
    const who = await adminForGoogle({ email: 'a-stranger@gmail.com', emailVerified: true });
    assert.equal(who, null, 'any verified Google account must NOT become an admin');
  });

  test('an UNVERIFIED email is refused even when it matches a linked admin', async () => {
    // An unverified address is a claim, not an identity — Google will mint a
    // token for one, and it is trivially attacker-chosen.
    const who = await adminForGoogle({ email: 'linked-tester@example.com', emailVerified: false });
    assert.equal(who, null, 'an unverified email must never satisfy the link');
  });

  test('the match is case-insensitive in the way the callback normalises', async () => {
    // exchangeCode lowercases before this is called; prove the stored value is
    // what that produces, so a Google account with capitals still matches.
    const who = await adminForGoogle({ email: 'LINKED-TESTER@EXAMPLE.COM'.toLowerCase(), emailVerified: true });
    assert.ok(who, 'lowercased email should match the stored link');
  });
});

describe('the state parameter', () => {
  test('round-trips the return destination', () => {
    const s = signState('/wc-auth/v1/authorize?app_name=PODpartner');
    assert.equal(readState(s)?.returnTo, '/wc-auth/v1/authorize?app_name=PODpartner');
  });

  test('a tampered state is refused', () => {
    const s = signState('/wc-auth/v1/authorize?app_name=PODpartner');
    const [body, sig] = s.split('.');
    // Swap the destination but keep the signature — the CSRF/open-redirect case.
    const evil = Buffer.from(JSON.stringify({ r: 'https://attacker.example/steal', t: Date.now(), n: 'x' })).toString('base64url');
    assert.equal(readState(`${evil}.${sig}`), null, 'a forged return destination must be refused');
    assert.equal(readState(`${body}.${'a'.repeat(sig.length)}`), null, 'a forged signature must be refused');
    assert.equal(readState('garbage'), null);
    assert.equal(readState(''), null);
  });

  test('an expired state is refused', () => {
    // Reach past the API to build one stamped 11 minutes ago.
    // eslint-disable-next-line
    const { createHmac } = cryptoMod;
    const body = Buffer.from(JSON.stringify({ r: '/x', t: Date.now() - 11 * 60 * 1000, n: 'x' })).toString('base64url');
    const sig = createHmac('sha256', process.env.JWT_SECRET).update(body).digest('base64url');
    assert.equal(readState(`${body}.${sig}`), null, 'a stale state must expire');
  });
});

describe('the authorize URL', () => {
  test('asks Google for an account choice and carries our state', () => {
    const url = new URL(authorizeUrl(
      { clientId: 'cid.apps.googleusercontent.com', clientSecret: 's' },
      'https://example-store.com/wc-auth/v1/google/callback',
      'STATE',
    ));
    assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(url.searchParams.get('client_id'), 'cid.apps.googleusercontent.com');
    assert.equal(url.searchParams.get('redirect_uri'), 'https://example-store.com/wc-auth/v1/google/callback');
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('state'), 'STATE');
    // Never silently reuse whichever Google session happens to be open — this
    // account is the one being authorised to hand out store keys.
    assert.equal(url.searchParams.get('prompt'), 'select_account');
    assert.match(url.searchParams.get('scope'), /openid/);
    // The client secret must never appear in a URL the browser follows.
    assert.doesNotMatch(url.toString(), /client_secret/);
  });
});

describe('the generic /auth/google/start guard', () => {
  // safeNext is not exported (it is route-local), so this asserts the rule it
  // enforces via the live route's redirect target. The cases that matter are
  // the ones that LOOK relative to a careless check.
  test('refuses destinations that leave this origin', async () => {
    const { buildServer } = await import('../dist/server.js');
    const app = await buildServer();
    await app.ready();
    try {
      const cases = [
        ['//evil.example/steal', 'protocol-relative is absolute to a browser'],
        ['https://evil.example', 'an absolute URL'],
        ['javascript:alert(1)', 'a script URL'],
        ['', 'empty'],
      ];
      for (const [next, why] of cases) {
        const r = await app.inject({ method: 'GET', url: `/auth/google/start?next=${encodeURIComponent(next)}` });
        const loc = r.headers.location ?? '';
        // Either it redirects to Google (state carries the SAFE default) or it
        // bounces to the admin — never to the attacker's destination.
        assert.doesNotMatch(loc, /evil\.example/, `${why} must not survive as a destination`);
        assert.doesNotMatch(loc, /^javascript:/i, `${why} must not survive as a destination`);
      }
    } finally {
      await app.close();
    }
  });
});

# Multi-Email Login (up to 3 emails / account) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let a customer attach up to 3 email addresses to one account, sign in (and reset/recover) with ANY verified one using the same single password, verify each added address by code, and keep one "primary" address for all outbound account mail.

**Architecture:** Reuse the existing `CustomerIdentity` table (Option A — lowest blast radius). Keep exactly ONE `kind='password'` identity per customer as the shared credential, re-keyed so it is found by `customerId` (not by email). Represent each of the ≤3 addresses as a `kind='email'` identity whose `verifiedAt` gates login. `Customer.email` stays `@unique` and becomes strictly the PRIMARY / outbound address (a denormalized mirror of the primary email member). All email→customer resolution funnels through ONE new helper, `resolveCustomerByEmail(email, {verifiedOnly})`, so the semantics live in one place instead of the ~14 call sites that resolve email today.

**Tech Stack:** Fastify + TypeScript, Prisma + Postgres, Redis (rate limits), Next.js admin ("Counter"), server-rendered storefront (`accountPage.ts` IIFE). Deployed on PM2 (VPS therum@2.25.93.243); backend port 10009; admin `/tos-admin`.

## Global Constraints

- **One shared password per account.** Exactly one `CustomerIdentity{kind:'password'}` per customer holds the single `secretHash`. NEVER create a per-email password hash. `password.ts` is email-agnostic — do not change it.
- **Verified-gate on login.** Only a `kind='email'` identity with `verifiedAt IS NOT NULL` may resolve a login / reset / be made primary. An unverified added email must be inert for auth.
- **Exactly one primary, always.** `Customer.email` == the primary verified email. Cannot remove the primary or the last remaining email. Promoting a new primary requires it to be verified.
- **Global email uniqueness across the UNION of all accounts' emails.** Enforced by a NEW partial unique index (see Task 1) because the existing `@@unique([kind,provider,subject])` does NOT bite for `provider IS NULL` kinds (Postgres NULL-distinct). All subjects stored/compared **lowercased** (index is case-sensitive) — reuse `normalizeEmail` (customerAuth.ts:63).
- **≤3 cap is application-enforced** (no DB count constraint). Enforce on every add path.
- **Throttle on customerId, not the entered email** after resolve (else 3 emails = 3× the password-guessing budget). Preserve the no-enumeration-oracle property (unknown email must not diverge in code path or timing).
- **Store-sender rule preserved.** A customer's email is a DESTINATION only, never a `from`. `notification.service.ts` transport is unchanged; From stays the store address (e.g. `commoncents@sidemoney.co`).
- **Outbound address classes:** relationship/account mail (welcome, F&F welcome, membership-expiry, marketing broadcast) → the PRIMARY. Contextual/transactional (password-reset code, add-email verify code, review request, abandoned cart, back-in-stock) → the address the user ACTED WITH.
- **Live store.** 55 customers, 9 with passwords (incl. Tarick tbanton1@icloud.com). The production migration (Task 12) is gated on Bam's explicit go and must be reversible-checked (a known account still resolves + logs in before and after).
- **Schema drift:** `Customer.firstName`/`lastName` exist in `schema.prisma` but NOT in any migration SQL (advanced via `db push`). The new migration must be authored so it diffs cleanly against the real DB — verify `npx prisma migrate diff` / `migrate status` before generating (see Task 1 Step 1).

---

## File Structure

- `prisma/schema.prisma` — demote `Customer.email` role (comment only); add partial unique index via migration. No new model (Option A).
- `prisma/migrations/<ts>_multi_email/migration.sql` — **Create:** partial unique index on `customer_identities(subject) WHERE kind='email'`; backfill; re-key password subjects. (+ reconcile firstName/lastName if the diff requires.)
- `src/counter/customerEmail.ts` — **Create:** the shared `resolveCustomerByEmail`, `listAccountEmails`, `addEmail`, `verifyAddedEmail`, `setPrimaryEmail`, `removeEmail`, `emailCount`, cross-account uniqueness check. One home for multi-email semantics.
- `src/counter/customerAuth.ts` — **Modify:** `upsertCustomer` (84), `registerWithPassword` (93), `signInWithPassword` (166), `resetPasswordWithCode` (130), `verifyCode` (292), `signInWithOAuth` (360), `requestEmailChange`/`confirmEmailChange` (533/560 → thin wrappers over customerEmail.ts), `claimGuestOrders` (569 → per verified email), `identitiesFor`/`unlinkIdentity` (441/458).
- `src/services/lifecycle.service.ts` — **Modify:** `sendPasswordResetCode` (463 resolve any verified email); welcome sends → primary (definition change).
- `src/services/{milieu,customer,reviewService,orderTracking}.service.ts`, `src/counter/wooImporter.ts`, `src/api/routes/taxonomy.ts` — **Modify:** swap `findFirst/findUnique({email})` for `resolveCustomerByEmail`.
- `src/api/routes/counter.ts` — **Create routes:** `GET /shop/account/me` (extend), `POST /shop/account/emails`, `POST /shop/account/emails/verify`, `DELETE /shop/account/emails/:email`, `POST /shop/account/emails/:email/primary`, `POST /shop/account/emails/:email/resend`.
- `src/site/accountPage.ts` — **Modify:** Security block emails manager + `/me` render + client calls.
- `src/api/routes/customers.ts`, `src/services/customer.service.ts`, `src/schemas/customer.schema.ts` — **Modify:** `customerInclude` returns email identities; new `/customers/:id/emails*` routes; widen `list` search + `create` uniqueness.
- `admin/app/(app)/customers/CustomersClient.tsx` + `admin/app/api/customers/[id]/emails/**` — **Modify/Create:** admin emails list + proxy handlers.
- `test/multiEmail.*.test.ts` — **Create:** unit + integration tests (see Task 0 for the runner).

---

## Task 0: Establish the test runner + a disposable test DB

**Files:** none (discovery + config)

- [ ] **Step 1:** Identify the test runner: `cat package.json | grep -A3 '"scripts"'` and look for `test`/`vitest`/`jest`. Record the exact command.
- [ ] **Step 2:** Confirm a test/throwaway Postgres is reachable (a local DB or a `_test` schema) for migration + integration tests — NEVER the prod DB. Record `DATABASE_URL` for tests.
- [ ] **Step 3:** Run the existing suite once to get a green baseline: `<test cmd>`. Expected: passes (or record known-failing so new failures are attributable). **If the suite uses fake/hardcoded auth fixtures, note it** (prior art: literal-string credentials have hidden real auth holes here — real hashes/identities in these tests).

---

## Task 1: Migration — partial unique index + backfill + re-key password subjects

**Files:**
- Create: `prisma/migrations/<ts>_multi_email/migration.sql`
- Test: `test/migration.multiEmail.test.ts`

**Interfaces:**
- Produces DB invariants later tasks rely on: (a) every existing `Customer.email` has a matching `CustomerIdentity{kind:'email', subject:lower(email), verifiedAt:now}`; (b) each `kind='password'` identity's `subject == customerId`; (c) a partial unique index makes `kind='email'` subjects globally unique.

- [ ] **Step 1: Verify the drift baseline before authoring.**
Run `npx prisma migrate status` and `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --script`. Expected: it surfaces the untracked `first_name`/`last_name` columns. Fold whatever it reports into the new migration so applying it does not try to re-add/drop existing columns.

- [ ] **Step 2: Write the failing test** (`test/migration.multiEmail.test.ts`) against a seeded test DB with 2 customers (one with a password identity, one without) and one row carrying `meta.altEmails`:
```ts
test('backfill: every customer gets a verified email identity for its primary', async () => {
  const custs = await db.customer.findMany({ select: { id: true, email: true } });
  for (const c of custs) {
    const em = await db.customerIdentity.findFirst({ where: { customerId: c.id, kind: 'email', subject: c.email.toLowerCase() } });
    expect(em?.verifiedAt).toBeTruthy();
  }
});
test('password identity is re-keyed to customerId', async () => {
  const pws = await db.customerIdentity.findMany({ where: { kind: 'password' } });
  for (const p of pws) expect(p.subject).toBe(p.customerId);
});
test('two customers cannot share an email identity', async () => {
  const [a, b] = await db.customer.findMany({ take: 2 });
  await expect(db.customerIdentity.create({ data: { customerId: b.id, kind: 'email', subject: (await db.customer.findUnique({where:{id:a.id}}))!.email.toLowerCase(), verifiedAt: new Date() } }))
    .rejects.toThrow(); // partial unique index
});
```

- [ ] **Step 3: Run — expect FAIL** (`<test cmd> test/migration.multiEmail.test.ts`). Expected: all three fail (no backfill, subjects are emails, no partial index).

- [ ] **Step 4: Author the migration SQL** (`migration.sql`), idempotent, in this order:
```sql
-- 1. Backfill a verified email identity for every existing primary email.
INSERT INTO customer_identities (id, customer_id, kind, provider, subject, verified_at, created_at)
SELECT gen_random_uuid()::text, c.id, 'email', NULL, lower(c.email), now(), now()
FROM customers c
WHERE NOT EXISTS (
  SELECT 1 FROM customer_identities i
  WHERE i.customer_id = c.id AND i.kind='email' AND i.subject = lower(c.email)
);
-- 2. Migrate dormant meta.altEmails as UNVERIFIED (cannot log in until re-verified).
INSERT INTO customer_identities (id, customer_id, kind, provider, subject, verified_at, created_at)
SELECT gen_random_uuid()::text, c.id, 'email', NULL, lower(ae.value), NULL, now()
FROM customers c
CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(c.meta->'altEmails','[]'::jsonb)) AS ae(value)
WHERE lower(ae.value) <> lower(c.email)
  AND NOT EXISTS (SELECT 1 FROM customer_identities i WHERE i.kind='email' AND i.subject = lower(ae.value));
-- 3. Re-key the single password identity by customerId (so the hash is reached by customer, not email).
UPDATE customer_identities SET subject = customer_id WHERE kind='password';
-- 4. THE security fix: make email identity subjects globally unique (the composite @@unique does not, due to NULL provider).
CREATE UNIQUE INDEX IF NOT EXISTS customer_email_identity_unique ON customer_identities (subject) WHERE kind='email';
```
Note: if `gen_random_uuid()` is unavailable, use the app's cuid pattern via a data migration script instead (see Step 4b).

- [ ] **Step 4b (fallback):** If cuid ids are required (schema uses cuid, not uuid), implement Steps 1–3 as a Node data-migration script (`prisma/dataMigrations/multiEmail.mjs`) using `db.$transaction`, then keep only the `CREATE UNIQUE INDEX` in `migration.sql`. Decide based on the id default in `schema.prisma` for `CustomerIdentity.id`.

- [ ] **Step 5: Apply to the TEST DB and run — expect PASS.** `npx prisma migrate deploy` (test DATABASE_URL) then `<test cmd> test/migration.multiEmail.test.ts`. Expected: all pass.

- [ ] **Step 6: Commit.**
```bash
git add prisma/migrations test/migration.multiEmail.test.ts
git commit -m "feat(auth): migration — backfill email identities, re-key password subjects, unique index"
```

---

## Task 2: `resolveCustomerByEmail` + email-set helpers

**Files:**
- Create: `src/counter/customerEmail.ts`
- Test: `test/customerEmail.test.ts`

**Interfaces:**
- Consumes: `db`, `normalizeEmail` (export it from customerAuth.ts or re-declare).
- Produces (later tasks import these):
```ts
resolveCustomerByEmail(email: string, opts?: { verifiedOnly?: boolean }): Promise<{ id: string } | null>
listAccountEmails(customerId: string): Promise<{ email: string; verifiedAt: Date | null; primary: boolean }[]>
emailInUse(email: string): Promise<boolean> // across ALL accounts' email identities + Customer.email
addEmail(customerId: string, email: string): Promise<{ to: string }> // creates unverified identity, ≤3 cap, uniqueness; caller sends code
markEmailVerified(customerId: string, email: string): Promise<void>
setPrimaryEmail(customerId: string, email: string): Promise<void> // email must be verified; updates Customer.email
removeEmail(customerId: string, email: string): Promise<void> // not primary, not last
```

- [ ] **Step 1: Write failing tests** — `resolveCustomerByEmail` finds a customer by a VERIFIED secondary email and returns null for an unverified one; `emailInUse` is true for another account's verified email; `addEmail` rejects a 4th and a duplicate; `setPrimaryEmail` refuses an unverified email; `removeEmail` refuses the primary and the last. (Seed via the Task 1 test DB.)

- [ ] **Step 2: Run — expect FAIL** (module doesn't exist).

- [ ] **Step 3: Implement** `src/counter/customerEmail.ts`. Core resolver:
```ts
export async function resolveCustomerByEmail(email: string, opts: { verifiedOnly?: boolean } = {}): Promise<{ id: string } | null> {
  const subject = normalizeEmail(email);
  const where: Prisma.CustomerIdentityWhereInput = { kind: 'email', subject };
  if (opts.verifiedOnly !== false) where.verifiedAt = { not: null };
  const em = await db.customerIdentity.findFirst({ where, select: { customerId: true } });
  if (em) return { id: em.customerId };
  // transitional fallback: a legacy account whose primary was not yet backfilled
  const c = await db.customer.findFirst({ where: { email: subject }, select: { id: true } });
  return c ? { id: c.id } : null;
}
```
`emailInUse` checks both a `kind='email'` identity and `Customer.email`. `addEmail` enforces `emailCount < 3` and `!emailInUse`, then `create({ kind:'email', subject, verifiedAt:null })`. `setPrimaryEmail` verifies the target is a verified email of this customer, then `db.customer.update({ email: subject })`. `removeEmail` blocks primary/last, then `deleteMany({ customerId, kind:'email', subject })`.

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit.** `feat(auth): shared multi-email resolver + account-email helpers`

---

## Task 3: Rewire password login (the security-critical path)

**Files:**
- Modify: `src/counter/customerAuth.ts:166-215` (`signInWithPassword`), `:183` (throttle), `:84` (`upsertCustomer`)
- Test: `test/login.multiEmail.test.ts`

**Interfaces:** Consumes `resolveCustomerByEmail` (Task 2). Produces: login accepts any verified email + shared password; unverified email + correct password FAILS identically to wrong password.

- [ ] **Step 1: Write failing tests:** (a) create an account, add+verify a 2nd email, assert sign-in with the 2nd email + the same password succeeds and yields a customer-keyed session; (b) sign-in with an ADDED-BUT-UNVERIFIED email + correct password fails with the SAME error/shape as a wrong password (no oracle); (c) 10 failed attempts across *different* emails of the same account trip the lockout (throttle keyed on customerId, not email); (d) per-IP limiter still independent.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement.** Replace the resolve at `:192`:
```ts
const resolved = await resolveCustomerByEmail(email, { verifiedOnly: true });
// throttle AFTER resolve, on a stable key: customerId when known, else a per-email dummy (no oracle)
const throttleKey = resolved ? `customer-login:${resolved.id}` : `customer-login:unknown:${normalizeEmail(email)}`;
await checkRateLimit(throttleKey, 10, 15 * 60);
if (!resolved) { await fakeVerify(); throw new AuthError('Invalid email or password'); } // constant-time-ish
const pw = await db.customerIdentity.findFirst({ where: { customerId: resolved.id, kind: 'password' } });
if (!pw?.secretHash || !(await verifyPassword(password, pw.secretHash))) throw new AuthError('Invalid email or password');
const customer = await db.customer.findUnique({ where: { id: resolved.id } });
```
`fakeVerify()` = `verifyPassword(password, DUMMY_HASH)` to keep timing uniform. Update `upsertCustomer` (`:84`) to `resolveCustomerByEmail` first (verifiedOnly:false for the create-vs-return decision) before creating, so a verified secondary never spawns a duplicate.

- [ ] **Step 4: Run — expect PASS. Then run the FULL suite** — no existing login test regressed.
- [ ] **Step 5: Commit.** `feat(auth): resolve login by any verified email; throttle per-customer`

---

## Task 4: Forgot-password / reset across verified emails

**Files:** Modify `src/services/lifecycle.service.ts:463` (`sendPasswordResetCode`), `src/counter/customerAuth.ts:130-162` (`resetPasswordWithCode`). Test: `test/reset.multiEmail.test.ts`

- [ ] **Step 1: Failing tests:** forgot-password with a verified SECONDARY email issues a code to THAT address and lets the shared password be reset; the reset updates the ONE password identity (found by customerId), does not create a second; unknown email stays silent (void, no oracle); reset `signOutAll`.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.** `sendPasswordResetCode`: `const r = await resolveCustomerByEmail(destination, { verifiedOnly: true }); if (!r) return;` then mint+mail code to `destination` (unchanged). `resetPasswordWithCode`: resolve customer via `resolveCustomerByEmail`; load/update the password identity by `{ customerId, kind:'password' }` (NOT by subject=email); keep `signOutAll`.
- [ ] **Step 4: Run — expect PASS (+ full suite).**
- [ ] **Step 5: Commit.** `feat(auth): forgot-password resolves any verified email`

---

## Task 5: Register / verifyCode / OAuth — uniqueness across all emails, no duplicate accounts

**Files:** Modify `src/counter/customerAuth.ts:93` (`registerWithPassword` dup check + create), `:292` (`verifyCode`), `:360` (`signInWithOAuth`). Test: `test/register.multiEmail.test.ts`

- [ ] **Step 1: Failing tests:** registering an email that is another account's verified SECONDARY email is rejected ("account already exists"); email-code sign-in with a verified secondary returns the existing customer (does not mint a new one); the new password account seeds one `kind='email'` verified identity for its primary + re-keys the password identity subject to customerId.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.** Dup check at `:99` → `if (await emailInUse(email)) throw ConflictError`. Create path: create the password identity with `subject: customer.id` (not email) + `secretHash`, AND an `email` identity `{ subject: normalizeEmail(email), verifiedAt: new Date() }`. `verifyCode` (`:292`): resolve via email identity → existing customer branch; the add-email path pre-creates the identity so this hits the `if (identity)` branch (Task 6). `signInWithOAuth`: link a provider's verified email against any account email via `resolveCustomerByEmail`.
- [ ] **Step 4: Run — expect PASS (+ full suite).**
- [ ] **Step 5: Commit.** `feat(auth): register/verify/oauth honor the full email set`

---

## Task 6: Add-email flow (add → verify → make-primary → remove) + guest-order claim per email

**Files:** Modify `src/counter/customerAuth.ts:533/560` (repurpose `requestEmailChange`→`addEmail` thin-wrap, `confirmEmailChange`→`verifyAddedEmail`), `:569` (`claimGuestOrders` per verified email), `:441/:458` (`identitiesFor`/`unlinkIdentity`). Test: `test/addEmail.test.ts`

- [ ] **Step 1: Failing tests:** add-email requires the account password + is capped at 3 + rejects a dup on this/any account; verifying the code sets `verifiedAt` and ADDS a login key WITHOUT rewriting other identities' subjects; make-primary (verified only) repoints `Customer.email`; remove refuses the primary/last; verifying a newly-added email claims prior guest orders under THAT address.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.** `addEmail(customerId,email,password)`: verify password, `customerEmail.addEmail`, then `requestCode(newAddress)` (send verify code to the new address). `verifyAddedEmail(customerId,email,code)`: consume code → `markEmailVerified` → `claimGuestOrders(email)`. Delete the old blanket `updateMany({ subject: newEmail })`. `unlinkIdentity`: refuse to remove the identity whose subject == `Customer.email` unless another verified email is promoted first; never leave zero verified sign-in paths.
- [ ] **Step 4: Run — expect PASS (+ full suite).**
- [ ] **Step 5: Commit.** `feat(auth): add/verify/primary/remove emails; claim guest orders per verified email`

---

## Task 7: Widen the remaining email→customer lookups through the resolver

**Files:** Modify `src/services/milieu.service.ts:106,300,328`; `src/api/routes/taxonomy.ts:102`; `src/counter/reviewService.ts:74`; `src/services/orderTracking.service.ts:103`; `src/counter/wooImporter.ts:326,379`; `src/services/customer.service.ts:95,18`. Test: `test/lookups.multiEmail.test.ts`

- [ ] **Step 1: Failing tests (representative):** admin milieu-assign-by-secondary-email finds the account (not "no customer"); product-access grant by a secondary email resolves; a guest order under a verified secondary is claimable / marks review "verified"; order-tracking accepts a verified secondary for a signed-out visitor; `customerService.create` conflicts on another account's secondary email; admin search finds a customer by a secondary email.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.** Replace each `findFirst/findUnique({email})` with `resolveCustomerByEmail(email, { verifiedOnly: true })` (use `false` only where an unverified match should still block creation — i.e. uniqueness checks use `emailInUse`). `customerService.list` search: add `{ identities: { some: { kind:'email', subject: { contains: q } } } }`. `customerService.create`: uniqueness via `emailInUse`; seed the primary email identity like register.
- [ ] **Step 4: Run — expect PASS (+ full suite).**
- [ ] **Step 5: Commit.** `feat(auth): route all email->customer lookups through the resolver`

---

## Task 8: Storefront account endpoints

**Files:** Modify `src/api/routes/counter.ts` (extend `GET /shop/account/me`; add `POST /shop/account/emails`, `POST /shop/account/emails/verify`, `DELETE /shop/account/emails/:email`, `POST /shop/account/emails/:email/primary`, `POST /shop/account/emails/:email/resend`). Test: `test/routes.accountEmails.test.ts`

- [ ] **Step 1: Failing tests:** `/me` returns `emails:[{email,verifiedAt,primary}]` (≤3) with `email`==primary; the add/verify/primary/remove endpoints require the shopper's own session, enforce the invariants (401 without session, 409 on dup/cap, 422 on unverified-primary/remove-primary), and are idempotent-safe.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.** Each route requires `requireCustomer(req)` and delegates to Task 6 service methods; `/me` adds `emails: await listAccountEmails(customer.id)` and keeps scalar `email = primary`.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit.** `feat(account): endpoints to list/add/verify/primary/remove emails`

---

## Task 9: Storefront account UI — emails manager

**Files:** Modify `src/site/accountPage.ts` (Security block `:377-416`, `showUser` `:596`, `load` `:810`, submit handlers `:763/:777`). Test: manual browser walk (Task 12 verification) + a render-smoke assertion.

- [ ] **Step 1:** Replace the single "Sign-in email" row with an "Emails (up to 3)" list rendered from `me.emails`: each row = address + Verified/Pending badge + Primary badge + actions [Make primary (verified only) | Remove (not primary/last) | Resend (pending)]; an "Add email" control disabled at 3. Repurpose the existing `em-form` (add: email+password) and `em-confirm` (verify: code). Make the readonly Details field show `me.primaryEmail`.
- [ ] **Step 2:** Wire client calls through `api()` to the Task 8 endpoints; add `renderEmails(me.emails)` called on load and after each mutation; the reset/login/register responses set `customer.email = primary` so cart-identity stays stable.
- [ ] **Step 3:** Build + deploy backend, then browser-verify at mobile + desktop (add a 2nd email, verify by code, make primary, remove). No widows in copy.
- [ ] **Step 4: Commit.** `feat(account): up-to-3 emails manager UI`

---

## Task 10: Admin — see/manage a customer's emails

**Files:** Modify `src/services/customer.service.ts:9` (`customerInclude` add email identities); `src/api/routes/customers.ts` (add `/customers/:id/emails*` behind the existing auth+capability gate); `admin/app/(app)/customers/CustomersClient.tsx` (`:14,:47,:58,:139` emails list + handlers); Create `admin/app/api/customers/[id]/emails/route.ts` + `[emailId]/route.ts` (proxyToBackend one-liners). Test: `test/admin.customerEmails.test.ts`

- [ ] **Step 1: Failing tests:** list/get payload carries `emails[]`; admin add/verify-trigger/primary/remove routes enforce the same invariants; admin search matches any of a customer's emails.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** mirroring the milieu-members proxy pattern (`admin/app/api/milieus/[id]/members`). Client updates `row.emails` optimistically.
- [ ] **Step 4: Run — expect PASS; admin build (`next build`) clean.**
- [ ] **Step 5: Commit.** `feat(admin): manage up-to-3 customer emails`

---

## Task 11: Guardrails against multi-email abuse

**Files:** Modify `src/services/lifecycle.service.ts:359` (`dropBroadcast` — already primary-only; add an explicit dedupe-to-primary comment + guard), coupon per-user limit (`CouponRedemption` usage) to count by `customerId` when a session exists. Test: `test/guardrails.multiEmail.test.ts`

- [ ] **Step 1: Failing tests:** a marketing broadcast sends exactly ONE mail per multi-email account (primary); a per-user coupon limit is NOT evadable by redeeming under each verified email while logged in.
- [ ] **Step 2–4:** Implement, run (expect PASS), commit. `feat(commerce): dedupe broadcast to primary; coupon per-user by customerId`

---

## Task 12: Production migration + end-to-end verification (GATED on Bam's go)

**Files:** none (ops)

- [ ] **Step 1:** Snapshot: record `db.customer.count()`, `customerIdentity.groupBy(kind)`, and that Tarick (`tbanton1@icloud.com`) currently resolves + the 9 password accounts' subjects.
- [ ] **Step 2:** rsync `src` + `prisma`, `npm run build`, `npx prisma migrate deploy` on the box (backend), `pm2 reload therum-cms-api` + `pm2 restart therum-cms-worker therum-cms-admin`.
- [ ] **Step 3:** Post-migration asserts: every customer has a verified email identity for its primary; every password subject == customerId; the partial unique index exists; count unchanged.
- [ ] **Step 4:** Live login smoke with a REAL known account (Test Shopper) via API: sign in with the primary → success; add+verify a 2nd email → sign in with the 2nd → success; forgot-password with the 2nd → code issued. Do NOT test with a customer's real credentials you don't own; use Test Shopper.
- [ ] **Step 5:** If any assert fails → the index/backfill is reversible (drop index, delete backfilled `kind='email'` rows created by the migration, restore password subjects from the snapshot). Have the rollback SQL ready before Step 2.
- [ ] **Step 6:** Update `_core/FUTURE-DEVELOPMENTS.md` (mark multi-email SHIPPED) and memory (the resolver is now the one email→customer path; auth_events seed-noise note stays).

---

## Self-Review

- **Spec coverage:** every touchpoint from the auth-surface map is covered — credential core (T3), schema/migration (T1), reset (T4), register/verify/oauth (T5), add-email + guest-claim (T6), the ~10 secondary lookups (T7), storefront endpoints+UI (T8/T9), admin (T10), broadcast/coupon abuse (T11), prod migration (T12). The one true security fix (partial unique index) is in T1 and gates everything.
- **Type consistency:** `resolveCustomerByEmail` returns `{id}|null` everywhere; `listAccountEmails` shape `{email,verifiedAt,primary}` is the same in `/me` (T8) and admin `customerInclude` (T10).
- **Placeholder scan:** none — each task has concrete files:lines (from the map), real SQL, and test assertions.
- **Open risk flagged:** cuid-vs-uuid id default decides T1 Step 4 vs 4b; the firstName/lastName drift must be reconciled in T1 Step 1 or the migration diff is wrong. Both are called out.

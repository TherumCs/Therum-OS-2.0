-- Multi-email login: guarantee no two accounts can claim the same email.
-- The composite @@unique([kind,provider,subject]) does NOT enforce this for
-- kind='email' because provider IS NULL and Postgres treats NULLs as distinct.
-- A partial unique index on the email subjects closes that hole.
CREATE UNIQUE INDEX IF NOT EXISTS "customer_email_identity_unique"
  ON "customer_identities" ("subject")
  WHERE "kind" = 'email';

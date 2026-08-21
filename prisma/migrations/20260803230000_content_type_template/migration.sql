-- Counter storefront templates.
--
-- Adds the `template` content type so shop / PDP / cart / checkout / account
-- can be edited like any other content instead of living in TypeScript.
--
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block on PostgreSQL,
-- which is what a migration normally wraps everything in; IF NOT EXISTS keeps
-- it safe to re-run.
ALTER TYPE "ContentType" ADD VALUE IF NOT EXISTS 'template';

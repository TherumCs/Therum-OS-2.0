-- Migration-history reconciliation.
--
-- schema.prisma drifted from the migration history: several columns and one
-- whole table were added to the schema (and pushed onto production with
-- `prisma db push` / by hand) without a migration ever recording them. A
-- migration-built (fresh) database is therefore missing them and cannot run:
--   * customers.first_name / last_name  -> customer register + Counter›Customers 500
--   * webhook_deliveries.genuine / response_body -> outbound webhook logging 500
--   * back_in_stock_subscriptions (whole table) -> the back-in-stock feature 500s
--
-- This is the same disease as orders.woo_id / orders.meta (their own migrations).
-- Additive + idempotent (IF NOT EXISTS), so a no-op on the already-patched
-- production DB and correct on any fresh build.
--
-- NOTE: `prisma migrate diff` also reports DROP INDEX / DROP SEQUENCE lines
-- (schema does not DECLARE the deleted_at/fulfillment_provider indexes, nor the
-- @default(autoincrement()) behind the wooId SERIAL sequences). Those are
-- schema UNDER-documentation, not fresh-env blockers — dropping the sequences
-- would in fact stop wooId from populating — so they are deliberately NOT
-- applied here.

ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "first_name" TEXT;
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "last_name" TEXT;

ALTER TABLE "webhook_deliveries" ADD COLUMN IF NOT EXISTS "genuine" BOOLEAN;
ALTER TABLE "webhook_deliveries" ADD COLUMN IF NOT EXISTS "response_body" TEXT;

CREATE TABLE IF NOT EXISTS "back_in_stock_subscriptions" (
    "id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notified_at" TIMESTAMP(3),
    CONSTRAINT "back_in_stock_subscriptions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "back_in_stock_subscriptions_variant_id_idx" ON "back_in_stock_subscriptions"("variant_id");
CREATE UNIQUE INDEX IF NOT EXISTS "back_in_stock_subscriptions_variant_id_email_key" ON "back_in_stock_subscriptions"("variant_id", "email");
-- Constraints have no IF NOT EXISTS; guard the FK so a re-run is a no-op.
DO $$ BEGIN
  ALTER TABLE "back_in_stock_subscriptions"
    ADD CONSTRAINT "back_in_stock_subscriptions_variant_id_fkey"
    FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- WooCommerce's key_id is a database integer, and partners parse it as one.
-- SERIAL rather than a plain integer so existing rows are backfilled with
-- distinct values automatically; a NULL or a duplicate here would break the
-- unique index on a table that already has credentials in it.
ALTER TABLE "store_credentials" ADD COLUMN "key_id" SERIAL;
CREATE UNIQUE INDEX "store_credentials_key_id_key" ON "store_credentials"("key_id");

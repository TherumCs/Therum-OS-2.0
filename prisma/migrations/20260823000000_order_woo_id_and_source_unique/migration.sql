-- Orders were given an integer WooCommerce-style id (orders.woo_id) and a UNIQUE
-- source_id in schema.prisma, but no migration ever created them: the live DB
-- was patched by hand, so a fresh environment (or `migrate reset`) would build
-- the orders table with NO woo_id column at all. order.service.create never sets
-- wooId — it relies entirely on a DB-side default — so without this the
-- Woo-compat layer emits `id: 0` for every order and partner order sync collides
-- on a single shared id.
--
-- Every statement is IF NOT EXISTS, so this is a no-op on the hand-patched
-- production DB and correct on any fresh build.

-- Dedicated sequence starting at 100000 so an order id never collides with the
-- product / variant / category / tag wooId space (those SERIALs start at 1).
CREATE SEQUENCE IF NOT EXISTS "orders_woo_id_seq" START 100000;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "woo_id" INTEGER DEFAULT nextval('orders_woo_id_seq');
ALTER SEQUENCE "orders_woo_id_seq" OWNED BY "orders"."woo_id";
-- Any pre-existing order without an id gets one now, so none is left serving 0/null.
UPDATE "orders" SET "woo_id" = nextval('orders_woo_id_seq') WHERE "woo_id" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "orders_woo_id_key" ON "orders"("woo_id");

-- source_id: schema declares it @unique (import idempotency) but only the column
-- was ever migrated, not the index. NULLs stay distinct under a Postgres unique
-- index, so store-native orders (source_id NULL) are exempt while a re-run Woo
-- import can no longer duplicate the same source order.
CREATE UNIQUE INDEX IF NOT EXISTS "orders_source_id_key" ON "orders"("source_id");

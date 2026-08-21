-- WooCommerce ids are integers; POD connectors store the returned id in an
-- integer column. Give products, variants, categories and tags a stable
-- auto-increment integer the Woo-compat layer serves as the WooCommerce id.
-- IF NOT EXISTS so it is a no-op on the environment where it was applied by
-- hand first.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "woo_id" SERIAL;
ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "woo_id" SERIAL;
ALTER TABLE "product_categories" ADD COLUMN IF NOT EXISTS "woo_id" SERIAL;
ALTER TABLE "product_tags" ADD COLUMN IF NOT EXISTS "woo_id" SERIAL;

CREATE UNIQUE INDEX IF NOT EXISTS "products_woo_id_key" ON "products"("woo_id");
CREATE UNIQUE INDEX IF NOT EXISTS "product_variants_woo_id_key" ON "product_variants"("woo_id");
CREATE UNIQUE INDEX IF NOT EXISTS "product_categories_woo_id_key" ON "product_categories"("woo_id");
CREATE UNIQUE INDEX IF NOT EXISTS "product_tags_woo_id_key" ON "product_tags"("woo_id");

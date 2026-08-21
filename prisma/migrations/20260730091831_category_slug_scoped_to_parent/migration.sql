-- Category slugs become unique WITHIN A PARENT instead of globally.
--
-- Globally-unique slugs are the WooCommerce problem: one "t-shirts" per store,
-- so the second becomes t-shirts-1. Scoped to the parent, Mens > T-Shirts and
-- Womens > T-Shirts are both "t-shirts" with clean paths.
DROP INDEX IF EXISTS "product_categories_slug_key";

CREATE UNIQUE INDEX "product_categories_parent_id_slug_key"
  ON "product_categories"("parent_id", "slug");

-- The partial index above does NOT constrain top-level rows: Postgres treats
-- NULLs as distinct, so every parent_id IS NULL row would escape it and you
-- could create two root categories both called "mens". This covers them.
--
-- KEEP THIS. Prisma cannot express a partial unique index in schema.prisma, so
-- a future `migrate dev` may not know it exists — if a generated migration ever
-- proposes dropping it, that is the diff being wrong, not this.
CREATE UNIQUE INDEX "product_categories_root_slug_key"
  ON "product_categories"("slug") WHERE "parent_id" IS NULL;

CREATE INDEX IF NOT EXISTS "product_categories_parent_id_idx"
  ON "product_categories"("parent_id");

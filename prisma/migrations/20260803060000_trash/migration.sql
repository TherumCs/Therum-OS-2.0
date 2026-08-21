-- The trash. A timestamp, not a status value: restoring must put a thing back
-- where it was, and a `trashed` status would overwrite draft/active/archived.
ALTER TABLE "products"            ADD COLUMN "deleted_at" TIMESTAMP(3);
ALTER TABLE "content"             ADD COLUMN "deleted_at" TIMESTAMP(3);
ALTER TABLE "product_categories"  ADD COLUMN "deleted_at" TIMESTAMP(3);
ALTER TABLE "product_tags"        ADD COLUMN "deleted_at" TIMESTAMP(3);
CREATE INDEX "products_deleted_at_idx"           ON "products"("deleted_at");
CREATE INDEX "content_deleted_at_idx"            ON "content"("deleted_at");
CREATE INDEX "product_categories_deleted_at_idx" ON "product_categories"("deleted_at");
CREATE INDEX "product_tags_deleted_at_idx"       ON "product_tags"("deleted_at");

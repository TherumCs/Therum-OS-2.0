-- Per-line production stage. A multi-vendor order has each product at its own
-- stage, so production is tracked per item (not per order). Also a per-line
-- notified-at so the "your item is being made" email fires once per line.
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "production_status" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "production_notified_at" TIMESTAMP(3);

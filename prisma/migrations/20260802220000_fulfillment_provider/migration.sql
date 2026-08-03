-- Which fulfilment provider prints a product. Distinct from vendor_id, which
-- is a marketplace seller and a real foreign key.
ALTER TABLE "products" ADD COLUMN "fulfillment_provider" TEXT;
CREATE INDEX "products_fulfillment_provider_idx" ON "products"("fulfillment_provider");

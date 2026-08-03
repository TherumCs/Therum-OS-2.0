-- Push-side twin of webhook_deliveries: did the factory hear about this order?
CREATE TABLE "fulfillment_routes" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "lines" INTEGER NOT NULL,
  "ok" BOOLEAN NOT NULL,
  "reference" TEXT,
  "error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fulfillment_routes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "fulfillment_routes_order_id_idx" ON "fulfillment_routes"("order_id");
CREATE INDEX "fulfillment_routes_provider_ok_idx" ON "fulfillment_routes"("provider", "ok");
ALTER TABLE "fulfillment_routes" ADD CONSTRAINT "fulfillment_routes_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

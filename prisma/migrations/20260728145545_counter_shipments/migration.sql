-- CreateTable
CREATE TABLE "order_shipments" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "vendor_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "shipping_provider" TEXT,
    "shipping_method" TEXT,
    "pod_provider" TEXT,
    "quote_ref" TEXT,
    "quoted_at" TIMESTAMP(3),
    "shipping_total" INTEGER NOT NULL DEFAULT 0,
    "tax_total" INTEGER NOT NULL DEFAULT 0,
    "tracking_carrier" TEXT,
    "tracking_number" TEXT,
    "ship_address" JSONB NOT NULL DEFAULT '{}',
    "shipped_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_shipments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_shipments_order_id_idx" ON "order_shipments"("order_id");

-- CreateIndex
CREATE INDEX "order_shipments_status_idx" ON "order_shipments"("status");

-- AddForeignKey
ALTER TABLE "order_shipments" ADD CONSTRAINT "order_shipments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

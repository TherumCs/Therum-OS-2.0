-- CreateTable
CREATE TABLE "customer_offers" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "coupon_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "seen_at" TIMESTAMP(3),
    "claimed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_offers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_offers_customer_id_status_idx" ON "customer_offers"("customer_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "customer_offers_customer_id_coupon_id_key" ON "customer_offers"("customer_id", "coupon_id");

-- AddForeignKey
ALTER TABLE "customer_offers" ADD CONSTRAINT "customer_offers_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_offers" ADD CONSTRAINT "customer_offers_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

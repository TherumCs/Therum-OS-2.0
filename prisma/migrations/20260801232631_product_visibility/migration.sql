-- AlterTable
ALTER TABLE "products" ADD COLUMN     "visibility" TEXT NOT NULL DEFAULT 'public';

-- CreateTable
CREATE TABLE "product_audiences" (
    "product_id" TEXT NOT NULL,
    "milieu_id" TEXT NOT NULL,

    CONSTRAINT "product_audiences_pkey" PRIMARY KEY ("product_id","milieu_id")
);

-- CreateTable
CREATE TABLE "product_access" (
    "product_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_access_pkey" PRIMARY KEY ("product_id","customer_id")
);

-- CreateIndex
CREATE INDEX "product_audiences_milieu_id_idx" ON "product_audiences"("milieu_id");

-- CreateIndex
CREATE INDEX "product_access_customer_id_idx" ON "product_access"("customer_id");

-- AddForeignKey
ALTER TABLE "product_audiences" ADD CONSTRAINT "product_audiences_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_audiences" ADD CONSTRAINT "product_audiences_milieu_id_fkey" FOREIGN KEY ("milieu_id") REFERENCES "milieus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_access" ADD CONSTRAINT "product_access_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_access" ADD CONSTRAINT "product_access_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "discount_amount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "discount_label" TEXT,
ADD COLUMN     "discount_pct" DOUBLE PRECISION NOT NULL DEFAULT 0;

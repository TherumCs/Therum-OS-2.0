-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "shipping_method" TEXT,
ADD COLUMN     "shipping_total" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tax_total" INTEGER NOT NULL DEFAULT 0;

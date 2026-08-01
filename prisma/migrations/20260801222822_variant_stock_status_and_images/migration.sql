-- AlterTable
ALTER TABLE "product_variants" ADD COLUMN     "image" TEXT,
ADD COLUMN     "images" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "stock_status" TEXT NOT NULL DEFAULT 'tracked';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "ship_address" JSONB NOT NULL DEFAULT '{}';

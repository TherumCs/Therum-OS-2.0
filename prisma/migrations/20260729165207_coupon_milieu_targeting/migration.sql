-- AlterTable
ALTER TABLE "coupons" ADD COLUMN     "milieu_id" TEXT;

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_milieu_id_fkey" FOREIGN KEY ("milieu_id") REFERENCES "milieus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

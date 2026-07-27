-- AlterTable
ALTER TABLE "admin_users" ADD COLUMN     "media_density" INTEGER DEFAULT 5,
ADD COLUMN     "media_view_mode" TEXT DEFAULT 'grid';

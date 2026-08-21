-- AlterTable
ALTER TABLE "admin_users" ADD COLUMN     "custom_css" TEXT,
ADD COLUMN     "list_page_row_count" INTEGER,
ADD COLUMN     "login_landing_page" TEXT,
ADD COLUMN     "sidebar_folded" BOOLEAN NOT NULL DEFAULT false;

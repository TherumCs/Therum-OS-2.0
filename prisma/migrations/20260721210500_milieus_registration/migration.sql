-- AlterTable
ALTER TABLE "milieu_memberships" ADD COLUMN     "pending_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "milieus" ADD COLUMN     "reg_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reg_max_signups" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reg_requires_approval" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reg_signup_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reg_slug" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "milieus_reg_slug_key" ON "milieus"("reg_slug");


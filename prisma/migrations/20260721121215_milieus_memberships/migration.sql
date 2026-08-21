-- CreateEnum
CREATE TYPE "MembershipSource" AS ENUM ('manual', 'link', 'csv', 'api');

-- CreateTable
CREATE TABLE "milieus" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#2563eb',
    "discount_pct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3),
    "member_duration_days" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "milieus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milieu_memberships" (
    "id" TEXT NOT NULL,
    "milieu_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "source" "MembershipSource" NOT NULL DEFAULT 'manual',
    "reminder_sent_at" TIMESTAMP(3),

    CONSTRAINT "milieu_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "milieus_slug_key" ON "milieus"("slug");

-- CreateIndex
CREATE INDEX "milieu_memberships_customer_id_idx" ON "milieu_memberships"("customer_id");

-- CreateIndex
CREATE INDEX "milieu_memberships_expires_at_idx" ON "milieu_memberships"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "milieu_memberships_milieu_id_customer_id_key" ON "milieu_memberships"("milieu_id", "customer_id");

-- AddForeignKey
ALTER TABLE "milieu_memberships" ADD CONSTRAINT "milieu_memberships_milieu_id_fkey" FOREIGN KEY ("milieu_id") REFERENCES "milieus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milieu_memberships" ADD CONSTRAINT "milieu_memberships_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

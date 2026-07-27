-- CreateTable
CREATE TABLE "cluster_groups" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "primary_product_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cluster_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cluster_memberships" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cluster_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cluster_memberships_product_id_key" ON "cluster_memberships"("product_id");

-- CreateIndex
CREATE INDEX "cluster_memberships_group_id_idx" ON "cluster_memberships"("group_id");

-- AddForeignKey
ALTER TABLE "cluster_memberships" ADD CONSTRAINT "cluster_memberships_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "cluster_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cluster_memberships" ADD CONSTRAINT "cluster_memberships_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;


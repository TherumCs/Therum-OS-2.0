-- AlterTable
ALTER TABLE "webhook_log" ADD COLUMN     "verified" BOOLEAN;

-- CreateTable
CREATE TABLE "webhook_secrets" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "secret_encrypted" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_secrets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "webhook_secrets_provider_key" ON "webhook_secrets"("provider");

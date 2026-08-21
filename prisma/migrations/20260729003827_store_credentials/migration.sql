-- CreateTable
CREATE TABLE "store_credentials" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "consumer_key" TEXT NOT NULL,
    "secret_hash" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'read_write',
    "last_used_at" TIMESTAMP(3),
    "last_used_ip" TEXT,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "store_credentials_consumer_key_key" ON "store_credentials"("consumer_key");

-- CreateIndex
CREATE INDEX "store_credentials_revoked_at_idx" ON "store_credentials"("revoked_at");

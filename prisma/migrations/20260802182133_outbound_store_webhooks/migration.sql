-- CreateTable
CREATE TABLE "store_webhooks" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "delivery_url" TEXT NOT NULL,
    "secret_encrypted" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "credential_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "webhook_id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "response_code" INTEGER,
    "error" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "store_webhooks_topic_status_idx" ON "store_webhooks"("topic", "status");

-- CreateIndex
CREATE INDEX "store_webhooks_credential_id_idx" ON "store_webhooks"("credential_id");

-- CreateIndex
CREATE INDEX "webhook_deliveries_webhook_id_created_at_idx" ON "webhook_deliveries"("webhook_id", "created_at");

-- CreateIndex
CREATE INDEX "webhook_deliveries_resource_id_idx" ON "webhook_deliveries"("resource_id");

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_fkey" FOREIGN KEY ("webhook_id") REFERENCES "store_webhooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "connections" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "credential_encrypted" TEXT NOT NULL,
    "masked_preview" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_tested_at" TIMESTAMP(3),
    "last_test_ok" BOOLEAN,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connection_audit_log" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor_id" TEXT,
    "detail" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connection_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_log" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "event" TEXT,
    "payload_summary" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "connections_provider_key" ON "connections"("provider");

-- CreateIndex
CREATE INDEX "connection_audit_log_provider_at_idx" ON "connection_audit_log"("provider", "at");

-- CreateIndex
CREATE INDEX "webhook_log_provider_received_at_idx" ON "webhook_log"("provider", "received_at");

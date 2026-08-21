-- CreateTable
CREATE TABLE "customer_identities" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "provider" TEXT,
    "subject" TEXT NOT NULL,
    "secret_hash" TEXT,
    "verified_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_auth_codes" (
    "id" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_auth_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_sessions" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_agent" TEXT,

    CONSTRAINT "customer_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_identities_customer_id_idx" ON "customer_identities"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_identities_kind_provider_subject_key" ON "customer_identities"("kind", "provider", "subject");

-- CreateIndex
CREATE INDEX "customer_auth_codes_destination_kind_idx" ON "customer_auth_codes"("destination", "kind");

-- CreateIndex
CREATE INDEX "customer_auth_codes_expires_at_idx" ON "customer_auth_codes"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "customer_sessions_token_hash_key" ON "customer_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "customer_sessions_customer_id_idx" ON "customer_sessions"("customer_id");

-- CreateIndex
CREATE INDEX "customer_sessions_expires_at_idx" ON "customer_sessions"("expires_at");

-- AddForeignKey
ALTER TABLE "customer_identities" ADD CONSTRAINT "customer_identities_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_sessions" ADD CONSTRAINT "customer_sessions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

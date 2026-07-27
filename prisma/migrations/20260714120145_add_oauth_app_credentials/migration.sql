-- CreateTable
CREATE TABLE "oauth_app_credentials" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "client_secret_encrypted" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauth_app_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "oauth_app_credentials_provider_key" ON "oauth_app_credentials"("provider");

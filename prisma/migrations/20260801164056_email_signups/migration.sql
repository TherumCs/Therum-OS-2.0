-- CreateTable
CREATE TABLE "email_signups" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'coming-soon',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_signups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_signups_email_key" ON "email_signups"("email");

-- CreateIndex
CREATE INDEX "email_signups_created_at_idx" ON "email_signups"("created_at");

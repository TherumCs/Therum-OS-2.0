-- CreateTable
CREATE TABLE "redirect_rules" (
    "id" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "code" INTEGER NOT NULL DEFAULT 301,
    "is_regex" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "redirect_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "redirect_rules_from_idx" ON "redirect_rules"("from");

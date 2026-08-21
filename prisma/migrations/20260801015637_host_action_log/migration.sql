-- CreateTable
CREATE TABLE "host_action_log" (
    "id" TEXT NOT NULL,
    "action_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "ok" BOOLEAN NOT NULL,
    "output" TEXT NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "host_action_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "host_action_log_action_id_at_idx" ON "host_action_log"("action_id", "at");

-- CreateIndex
CREATE INDEX "host_action_log_at_idx" ON "host_action_log"("at");

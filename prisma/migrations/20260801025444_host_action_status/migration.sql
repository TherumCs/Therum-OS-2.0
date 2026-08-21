-- AlterTable
ALTER TABLE "host_action_log" ADD COLUMN     "finished_at" TIMESTAMP(3),
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'running',
ALTER COLUMN "ok" SET DEFAULT false,
ALTER COLUMN "output" SET DEFAULT '',
ALTER COLUMN "duration_ms" SET DEFAULT 0;

-- CreateIndex
CREATE INDEX "host_action_log_status_idx" ON "host_action_log"("status");

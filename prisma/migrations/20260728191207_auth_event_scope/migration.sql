-- AlterTable
ALTER TABLE "auth_events" ADD COLUMN     "scope" TEXT NOT NULL DEFAULT 'admin';

-- CreateIndex
CREATE INDEX "auth_events_scope_created_at_idx" ON "auth_events"("scope", "created_at");

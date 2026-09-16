-- Marketing module (Flow): subscribers + lists + segments + campaigns +
-- automations + per-send tracking + storefront signup forms. Consent lives on
-- the subscriber, not the customer.
CREATE TABLE IF NOT EXISTS "subscribers" (
  "id" TEXT PRIMARY KEY,
  "email" TEXT NOT NULL UNIQUE,
  "first_name" TEXT,
  "last_name" TEXT,
  "phone" TEXT,
  "status" TEXT NOT NULL DEFAULT 'subscribed',
  "sms_status" TEXT NOT NULL DEFAULT 'none',
  "source" TEXT NOT NULL DEFAULT 'manual',
  "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "customer_id" TEXT UNIQUE,
  "meta" JSONB NOT NULL DEFAULT '{}',
  "subscribed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "unsubscribed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "subscribers_status_idx" ON "subscribers"("status");
CREATE INDEX IF NOT EXISTS "subscribers_created_at_idx" ON "subscribers"("created_at");

CREATE TABLE IF NOT EXISTS "marketing_lists" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL UNIQUE,
  "description" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS "list_memberships" (
  "list_id" TEXT NOT NULL REFERENCES "marketing_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "subscriber_id" TEXT NOT NULL REFERENCES "subscribers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("list_id", "subscriber_id")
);
CREATE INDEX IF NOT EXISTS "list_memberships_subscriber_id_idx" ON "list_memberships"("subscriber_id");

CREATE TABLE IF NOT EXISTS "segments" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "rules" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS "campaigns" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'email',
  "subject" TEXT NOT NULL DEFAULT '',
  "preheader" TEXT NOT NULL DEFAULT '',
  "from_name" TEXT,
  "reply_to" TEXT,
  "blocks" JSONB NOT NULL DEFAULT '[]',
  "html" TEXT NOT NULL DEFAULT '',
  "text" TEXT NOT NULL DEFAULT '',
  "audience" JSONB NOT NULL DEFAULT '{}',
  "status" TEXT NOT NULL DEFAULT 'draft',
  "scheduled_at" TIMESTAMP(3),
  "started_at" TIMESTAMP(3),
  "sent_at" TIMESTAMP(3),
  "recipient_count" INTEGER NOT NULL DEFAULT 0,
  "sent_count" INTEGER NOT NULL DEFAULT 0,
  "failed_count" INTEGER NOT NULL DEFAULT 0,
  "open_count" INTEGER NOT NULL DEFAULT 0,
  "click_count" INTEGER NOT NULL DEFAULT 0,
  "unsub_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "campaigns_status_idx" ON "campaigns"("status");
CREATE INDEX IF NOT EXISTS "campaigns_scheduled_at_idx" ON "campaigns"("scheduled_at");

CREATE TABLE IF NOT EXISTS "automations" (
  "id" TEXT PRIMARY KEY,
  "key" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "channel" TEXT NOT NULL DEFAULT 'email',
  "trigger" JSONB NOT NULL DEFAULT '{}',
  "subject" TEXT NOT NULL DEFAULT '',
  "preheader" TEXT NOT NULL DEFAULT '',
  "blocks" JSONB NOT NULL DEFAULT '[]',
  "html" TEXT NOT NULL DEFAULT '',
  "text" TEXT NOT NULL DEFAULT '',
  "sent_count" INTEGER NOT NULL DEFAULT 0,
  "open_count" INTEGER NOT NULL DEFAULT 0,
  "click_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS "campaign_sends" (
  "id" TEXT PRIMARY KEY,
  "campaign_id" TEXT REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "automation_id" TEXT REFERENCES "automations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "subscriber_id" TEXT REFERENCES "subscribers"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "email" TEXT NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'email',
  "token" TEXT NOT NULL UNIQUE,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "error" TEXT,
  "sent_at" TIMESTAMP(3),
  "opened_at" TIMESTAMP(3),
  "clicked_at" TIMESTAMP(3),
  "unsubscribed_at" TIMESTAMP(3),
  "meta" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "campaign_sends_campaign_id_email_key" ON "campaign_sends"("campaign_id", "email");
CREATE INDEX IF NOT EXISTS "campaign_sends_automation_id_email_idx" ON "campaign_sends"("automation_id", "email");
CREATE INDEX IF NOT EXISTS "campaign_sends_subscriber_id_idx" ON "campaign_sends"("subscriber_id");
CREATE INDEX IF NOT EXISTS "campaign_sends_status_idx" ON "campaign_sends"("status");

CREATE TABLE IF NOT EXISTS "campaign_events" (
  "id" TEXT PRIMARY KEY,
  "send_id" TEXT NOT NULL REFERENCES "campaign_sends"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "kind" TEXT NOT NULL,
  "url" TEXT,
  "ua" TEXT,
  "ip" TEXT,
  "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "campaign_events_send_id_idx" ON "campaign_events"("send_id");

CREATE TABLE IF NOT EXISTS "signup_forms" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'popup',
  "list_id" TEXT REFERENCES "marketing_lists"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "settings" JSONB NOT NULL DEFAULT '{}',
  "views" INTEGER NOT NULL DEFAULT 0,
  "submits" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);

-- Shopper bank connections authorised through Plaid. The access token is
-- encrypted; only display-safe fields (institution, mask, nickname) are clear.
CREATE TABLE "bank_links" (
  "id" TEXT NOT NULL,
  "customer_id" TEXT NOT NULL,
  "item_id" TEXT NOT NULL,
  "access_token_encrypted" TEXT NOT NULL,
  "institution_name" TEXT,
  "institution_id" TEXT,
  "account_mask" TEXT,
  "account_name" TEXT,
  "account_type" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_synced_at" TIMESTAMP(3),
  CONSTRAINT "bank_links_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "bank_links_item_id_key" ON "bank_links"("item_id");
CREATE INDEX "bank_links_customer_id_idx" ON "bank_links"("customer_id");
ALTER TABLE "bank_links" ADD CONSTRAINT "bank_links_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

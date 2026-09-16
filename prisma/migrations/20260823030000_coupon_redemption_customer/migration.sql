-- Per-user coupon cap was keyed on the typed email only, so a signed-in shopper
-- bypassed a usageLimitPerUser by entering a different address each time, and the
-- cap was skipped entirely when no email was present (audit C15). Track the
-- verified customer identity so the cap can key on it first, email as the guest
-- fallback. IF NOT EXISTS so this is a no-op on an already-patched DB.
ALTER TABLE "coupon_redemptions" ADD COLUMN IF NOT EXISTS "customer_id" TEXT;
CREATE INDEX IF NOT EXISTS "coupon_redemptions_coupon_id_customer_id_idx" ON "coupon_redemptions"("coupon_id", "customer_id");

-- Partner→vendor mapping keyed on the immutable credential id, not the human
-- label. The label is not unique: every NULL-description compat key collapsed to
-- one shared "Connected partner" vendor, so two partners were fenced to the SAME
-- vendor and each could read the other's customer PII (audit C2). Unique so two
-- credentials can never share a vendor. IF NOT EXISTS = no-op on a patched DB.
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "credential_id" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "vendors_credential_id_key" ON "vendors"("credential_id");

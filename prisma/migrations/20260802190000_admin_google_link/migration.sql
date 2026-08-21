-- The Google account permitted to sign in as this admin. Explicit link only:
-- matching on "any verified Google email" would let anyone with a Google
-- account approve a partner connection.
ALTER TABLE "admin_users" ADD COLUMN "google_email" TEXT;
CREATE UNIQUE INDEX "admin_users_google_email_key" ON "admin_users"("google_email");

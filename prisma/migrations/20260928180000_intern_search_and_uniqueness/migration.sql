-- Phase 03 hardening: database-enforced duplicate prevention and indexed
-- intern search.

-- At most one open (planned or active) internship per intern. Completed and
-- cancelled internships are history and may repeat.
CREATE UNIQUE INDEX "internships_one_open_per_intern_key"
  ON "internships" ("intern_id")
  WHERE "status" IN ('PLANNED', 'ACTIVE');

-- At most one pending invitation per user. Issuing a new invitation revokes the
-- previous one in the same transaction, so a concurrent duplicate fails here.
CREATE UNIQUE INDEX "user_invitations_one_pending_per_user_key"
  ON "user_invitations" ("user_id")
  WHERE "accepted_at" IS NULL AND "revoked_at" IS NULL;

-- Directory search uses case-insensitive substring matching (ILIKE '%term%'),
-- which B-tree indexes can't serve. Trigram GIN indexes can.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "users_first_name_trgm_idx" ON "users" USING GIN ("first_name" gin_trgm_ops);
CREATE INDEX "users_last_name_trgm_idx" ON "users" USING GIN ("last_name" gin_trgm_ops);
CREATE INDEX "users_email_trgm_idx" ON "users" USING GIN ("email" gin_trgm_ops);
CREATE INDEX "interns_employee_code_trgm_idx" ON "interns" USING GIN ("employee_code" gin_trgm_ops);

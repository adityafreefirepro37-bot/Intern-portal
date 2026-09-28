-- Separate migration: a new enum value ('BLOCKED') must be committed before a
-- constraint can reference it.
ALTER TABLE "onboarding_items"
  ADD CONSTRAINT "onboarding_items_blocked_reason_chk" CHECK ("status" <> 'BLOCKED' OR "blocked_reason" IS NOT NULL);

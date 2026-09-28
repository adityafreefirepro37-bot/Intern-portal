-- Integrity rules and row-level security that Prisma does not model.
-- Prisma ignores CHECK constraints when diffing, so later migrations keep them.

-- -- Identity ----------------------------------------------------------------
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_lowercase_chk" CHECK ("email" = lower("email")),
  ADD CONSTRAINT "users_email_format_chk" CHECK ("email" LIKE '%_@_%');

ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_slug_format_chk" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

ALTER TABLE "roles"
  ADD CONSTRAINT "roles_slug_format_chk" CHECK ("slug" ~ '^[a-z0-9]+(_[a-z0-9]+)*$');

ALTER TABLE "permissions"
  ADD CONSTRAINT "permissions_resource_format_chk" CHECK ("resource" ~ '^[a-z]+(_[a-z]+)*$'),
  ADD CONSTRAINT "permissions_action_format_chk" CHECK ("action" ~ '^[a-z]+(_[a-z]+)*$');

-- -- Date ranges -------------------------------------------------------------
ALTER TABLE "interns"
  ADD CONSTRAINT "interns_dates_chk" CHECK ("expected_end_date" IS NULL OR "joining_date" IS NULL OR "expected_end_date" >= "joining_date"),
  ADD CONSTRAINT "interns_actual_end_chk" CHECK ("actual_end_date" IS NULL OR "joining_date" IS NULL OR "actual_end_date" >= "joining_date");

ALTER TABLE "internships"
  ADD CONSTRAINT "internships_expected_end_chk" CHECK ("expected_end_date" IS NULL OR "expected_end_date" >= "start_date"),
  ADD CONSTRAINT "internships_actual_end_chk" CHECK ("actual_end_date" IS NULL OR "actual_end_date" >= "start_date");

ALTER TABLE "projects"
  ADD CONSTRAINT "projects_dates_chk" CHECK ("target_end_date" IS NULL OR "start_date" IS NULL OR "target_end_date" >= "start_date");

ALTER TABLE "leave_requests"
  ADD CONSTRAINT "leave_requests_dates_chk" CHECK ("end_date" >= "start_date");

ALTER TABLE "attendance"
  ADD CONSTRAINT "attendance_times_chk" CHECK ("check_out_at" IS NULL OR "check_in_at" IS NULL OR "check_out_at" >= "check_in_at"),
  ADD CONSTRAINT "attendance_total_minutes_chk" CHECK ("total_minutes" IS NULL OR "total_minutes" BETWEEN 0 AND 1440);

ALTER TABLE "attendance_corrections"
  ADD CONSTRAINT "attendance_corrections_times_chk" CHECK ("requested_check_out" IS NULL OR "requested_check_in" IS NULL OR "requested_check_out" >= "requested_check_in");

ALTER TABLE "meetings"
  ADD CONSTRAINT "meetings_times_chk" CHECK ("end_at" >= "start_at");

ALTER TABLE "calendar_events"
  ADD CONSTRAINT "calendar_events_times_chk" CHECK ("end_at" IS NULL OR "end_at" >= "start_at");

ALTER TABLE "performance_reviews"
  ADD CONSTRAINT "performance_reviews_period_chk" CHECK ("review_period_end" >= "review_period_start");

ALTER TABLE "announcements"
  ADD CONSTRAINT "announcements_expiry_chk" CHECK ("expires_at" IS NULL OR "published_at" IS NULL OR "expires_at" > "published_at");

-- -- Numeric ranges ----------------------------------------------------------
ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_estimated_minutes_chk" CHECK ("estimated_minutes" IS NULL OR "estimated_minutes" >= 0),
  ADD CONSTRAINT "tasks_actual_minutes_chk" CHECK ("actual_minutes" IS NULL OR "actual_minutes" >= 0),
  ADD CONSTRAINT "tasks_not_own_parent_chk" CHECK ("parent_task_id" IS NULL OR "parent_task_id" <> "id");

ALTER TABLE "performance_reviews"
  ADD CONSTRAINT "performance_reviews_scores_chk" CHECK (
    ("technical_skills" IS NULL OR "technical_skills" BETWEEN 1 AND 5) AND
    ("communication"    IS NULL OR "communication"    BETWEEN 1 AND 5) AND
    ("ownership"        IS NULL OR "ownership"        BETWEEN 1 AND 5) AND
    ("quality"          IS NULL OR "quality"          BETWEEN 1 AND 5) AND
    ("reliability"      IS NULL OR "reliability"      BETWEEN 1 AND 5) AND
    ("teamwork"         IS NULL OR "teamwork"         BETWEEN 1 AND 5) AND
    ("learning"         IS NULL OR "learning"         BETWEEN 1 AND 5) AND
    ("problem_solving"  IS NULL OR "problem_solving"  BETWEEN 1 AND 5)
  );

ALTER TABLE "learning_progress"
  ADD CONSTRAINT "learning_progress_percent_chk" CHECK ("progress_percent" BETWEEN 0 AND 100);

ALTER TABLE "quizzes"
  ADD CONSTRAINT "quizzes_passing_score_chk" CHECK ("passing_score" BETWEEN 0 AND 100);

ALTER TABLE "quiz_attempts"
  ADD CONSTRAINT "quiz_attempts_score_chk" CHECK ("score" BETWEEN 0 AND 100);

ALTER TABLE "lessons"
  ADD CONSTRAINT "lessons_estimated_minutes_chk" CHECK ("estimated_minutes" IS NULL OR "estimated_minutes" >= 0);

ALTER TABLE "submission_versions"
  ADD CONSTRAINT "submission_versions_number_chk" CHECK ("version_number" >= 1);

ALTER TABLE "certificate_verifications"
  ADD CONSTRAINT "certificate_verifications_count_chk" CHECK ("verification_count" >= 0);

ALTER TABLE "intern_profiles"
  ADD CONSTRAINT "intern_profiles_graduation_year_chk" CHECK ("graduation_year" IS NULL OR "graduation_year" BETWEEN 1950 AND 2100);

-- -- File metadata -----------------------------------------------------------
ALTER TABLE "internship_documents"
  ADD CONSTRAINT "internship_documents_file_size_chk" CHECK ("file_size" > 0);

ALTER TABLE "task_attachments"
  ADD CONSTRAINT "task_attachments_file_size_chk" CHECK ("file_size" > 0);

-- -- Row-level security ------------------------------------------------------
-- The application connects as the table owner, which bypasses RLS, and enforces
-- authorization in its service layer. Enabling RLS with no policies denies all
-- access to every other role - notably Supabase's `anon` and `authenticated`
-- roles used by its auto-generated REST API - so the anon key cannot read or
-- write these tables directly. Plain PostgreSQL behaves the same way.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = current_schema()
      AND tablename <> '_prisma_migrations'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;

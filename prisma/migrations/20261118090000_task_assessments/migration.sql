-- Proctored task assessments: one per submitted version of an intern's task (AI-drafted,
-- reviewer-approved questions), attempts with consent and a server-side deadline, answers
-- with AI-suggested and final points, the proctoring timeline, and recording chunks
-- (deleted after the retention period).

-- CreateEnum
CREATE TYPE "AssessmentStatus" AS ENUM ('PREPARING', 'AWAITING_APPROVAL', 'READY', 'IN_PROGRESS', 'SUBMITTED', 'GRADED', 'WAIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AssessmentQuestionKind" AS ENUM ('MULTIPLE_CHOICE', 'SHORT_ANSWER');

-- CreateEnum
CREATE TYPE "ProctorStream" AS ENUM ('CAMERA', 'SCREEN');

-- AlterEnum
ALTER TYPE "AiFeature" ADD VALUE 'ASSESSMENT';

-- CreateTable
CREATE TABLE "task_assessments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "submission_version_id" UUID NOT NULL,
    "intern_user_id" UUID NOT NULL,
    "status" "AssessmentStatus" NOT NULL DEFAULT 'PREPARING',
    "source" TEXT NOT NULL DEFAULT 'AI',
    "generation_error" TEXT,
    "time_limit_minutes" INTEGER NOT NULL DEFAULT 15,
    "pass_percent" INTEGER NOT NULL DEFAULT 60,
    "max_violations" INTEGER NOT NULL DEFAULT 3,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "waived_by" UUID,
    "waived_at" TIMESTAMPTZ(3),
    "waive_reason" TEXT,
    "score_percent" INTEGER,
    "passed" BOOLEAN,
    "integrity_score" INTEGER,
    "graded_by" UUID,
    "graded_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_questions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "assessment_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "AssessmentQuestionKind" NOT NULL,
    "prompt" TEXT NOT NULL,
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "correct_option" INTEGER,
    "points" INTEGER NOT NULL DEFAULT 1,
    "rubric" TEXT,

    CONSTRAINT "assessment_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "assessment_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "consent_at" TIMESTAMPTZ(3) NOT NULL,
    "consent_version" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "deadline_at" TIMESTAMPTZ(3) NOT NULL,
    "submitted_at" TIMESTAMPTZ(3),
    "auto_submitted" BOOLEAN NOT NULL DEFAULT false,
    "submit_reason" TEXT,
    "violations" INTEGER NOT NULL DEFAULT 0,
    "last_seen_at" TIMESTAMPTZ(3),
    "ip_address" TEXT,
    "user_agent" TEXT,
    "screen_surface" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_answers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "attempt_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "choice" INTEGER,
    "text" TEXT,
    "ai_points" DOUBLE PRECISION,
    "ai_feedback" TEXT,
    "points" DOUBLE PRECISION,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assessment_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proctor_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "attempt_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "detail" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proctor_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proctor_recordings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "attempt_id" UUID NOT NULL,
    "stream" "ProctorStream" NOT NULL,
    "sequence" INTEGER NOT NULL,
    "storage_path" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "proctor_recordings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "task_assessments_submission_version_id_key" ON "task_assessments"("submission_version_id");

-- CreateIndex
CREATE INDEX "task_assessments_organization_id_status_idx" ON "task_assessments"("organization_id", "status");

-- CreateIndex
CREATE INDEX "task_assessments_task_id_idx" ON "task_assessments"("task_id");

-- CreateIndex
CREATE INDEX "task_assessments_intern_user_id_status_idx" ON "task_assessments"("intern_user_id", "status");

-- CreateIndex
CREATE INDEX "assessment_questions_assessment_id_position_idx" ON "assessment_questions"("assessment_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_attempts_assessment_id_key" ON "assessment_attempts"("assessment_id");

-- CreateIndex
CREATE INDEX "assessment_attempts_user_id_idx" ON "assessment_attempts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_answers_attempt_id_question_id_key" ON "assessment_answers"("attempt_id", "question_id");

-- CreateIndex
CREATE INDEX "proctor_events_attempt_id_occurred_at_idx" ON "proctor_events"("attempt_id", "occurred_at");

-- CreateIndex
CREATE INDEX "proctor_recordings_created_at_idx" ON "proctor_recordings"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "proctor_recordings_attempt_id_stream_sequence_key" ON "proctor_recordings"("attempt_id", "stream", "sequence");

-- AddForeignKey
ALTER TABLE "task_assessments" ADD CONSTRAINT "task_assessments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_assessments" ADD CONSTRAINT "task_assessments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_assessments" ADD CONSTRAINT "task_assessments_submission_version_id_fkey" FOREIGN KEY ("submission_version_id") REFERENCES "submission_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_assessments" ADD CONSTRAINT "task_assessments_intern_user_id_fkey" FOREIGN KEY ("intern_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_questions" ADD CONSTRAINT "assessment_questions_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "task_assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_attempts" ADD CONSTRAINT "assessment_attempts_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "task_assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_attempts" ADD CONSTRAINT "assessment_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_answers" ADD CONSTRAINT "assessment_answers_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "assessment_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_answers" ADD CONSTRAINT "assessment_answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "assessment_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proctor_events" ADD CONSTRAINT "proctor_events_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "assessment_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proctor_recordings" ADD CONSTRAINT "proctor_recordings_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "assessment_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Integrity constraints.
ALTER TABLE "task_assessments" ADD CONSTRAINT "task_assessments_limits_chk"
  CHECK ("time_limit_minutes" BETWEEN 5 AND 120 AND "pass_percent" BETWEEN 0 AND 100 AND "max_violations" BETWEEN 0 AND 20);
ALTER TABLE "assessment_attempts" ADD CONSTRAINT "assessment_attempts_deadline_chk" CHECK ("deadline_at" > "started_at");

-- No access through Supabase's public API (the app uses the server role).
ALTER TABLE "task_assessments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assessment_questions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assessment_attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assessment_answers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "proctor_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "proctor_recordings" ENABLE ROW LEVEL SECURITY;

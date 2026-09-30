-- Phase 06: learning (categories, modules, enrollments, paths, plans, required
-- training, quizzes with questions, assignments) and performance (goals,
-- evidence, check-ins, feedback + requests, review cycles/templates/answers,
-- revisions, development plans). Extends the Phase 01 tables in place.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
CREATE TYPE "CourseDifficulty" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED');
CREATE TYPE "LessonContentType" AS ENUM ('TEXT', 'VIDEO', 'DOCUMENT', 'LINK', 'QUIZ', 'ASSIGNMENT');
CREATE TYPE "EnrollmentType" AS ENUM ('SELF_ENROLLED', 'ASSIGNED', 'REQUIRED');
CREATE TYPE "EnrollmentStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
CREATE TYPE "LearningPlanStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');
CREATE TYPE "RequiredTrainingTarget" AS ENUM ('EVERYONE', 'DEPARTMENT', 'POSITION', 'INTERN', 'ONBOARDING_TEMPLATE');
CREATE TYPE "QuizQuestionType" AS ENUM ('MULTIPLE_CHOICE', 'TRUE_FALSE', 'SHORT_ANSWER');
CREATE TYPE "QuizAnswerPolicy" AS ENUM ('NEVER', 'AFTER_SUBMISSION', 'AFTER_PASS');
CREATE TYPE "QuizAttemptStatus" AS ENUM ('IN_PROGRESS', 'SUBMITTED');
CREATE TYPE "FeedbackContextType" AS ENUM ('TASK', 'PROJECT', 'LEARNING', 'GOAL', 'WEEKLY_CHECKIN', 'GENERAL');
CREATE TYPE "FeedbackType" AS ENUM ('POSITIVE', 'DEVELOPMENTAL', 'GENERAL');
CREATE TYPE "FeedbackRequestStatus" AS ENUM ('OPEN', 'COMPLETED', 'DECLINED', 'CANCELLED');
CREATE TYPE "CheckinStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'REVIEWED');
CREATE TYPE "GoalCategory" AS ENUM ('TECHNICAL', 'COMMUNICATION', 'PROJECT', 'LEARNING', 'LEADERSHIP', 'PROCESS', 'OTHER');
CREATE TYPE "GoalStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'AT_RISK', 'COMPLETED', 'CANCELLED');
CREATE TYPE "GoalEvidenceType" AS ENUM ('TASK', 'PROJECT', 'SUBMISSION', 'COURSE', 'FEEDBACK', 'DOCUMENT', 'LINK', 'NOTE');
CREATE TYPE "ReviewCycleType" AS ENUM ('MIDPOINT', 'FINAL', 'CUSTOM');
CREATE TYPE "ReviewCycleStatus" AS ENUM ('DRAFT', 'OPEN', 'IN_REVIEW', 'COMPLETED', 'ARCHIVED');
CREATE TYPE "ReviewRespondent" AS ENUM ('SELF', 'MANAGER', 'MENTOR', 'HR');
CREATE TYPE "ReviewQuestionType" AS ENUM ('TEXT', 'RATING', 'BOOLEAN', 'MULTI_SELECT');
CREATE TYPE "DevelopmentPlanStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');
CREATE TYPE "DevelopmentItemStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- Review workflow stages (DRAFT exists; SUBMITTED/ACKNOWLEDGED are the unused Phase 01 values).
ALTER TYPE "PerformanceReviewStatus" ADD VALUE 'SELF_REVIEW';
ALTER TYPE "PerformanceReviewStatus" ADD VALUE 'MANAGER_REVIEW';
ALTER TYPE "PerformanceReviewStatus" ADD VALUE 'MENTOR_REVIEW';
ALTER TYPE "PerformanceReviewStatus" ADD VALUE 'HR_REVIEW';
ALTER TYPE "PerformanceReviewStatus" ADD VALUE 'COMPLETED';

-- Feedback visibility uses the Phase 06 vocabulary (rows keep their meaning).
ALTER TYPE "FeedbackVisibility" RENAME VALUE 'RECIPIENT' TO 'SHARED_WITH_INTERN';
ALTER TYPE "FeedbackVisibility" RENAME VALUE 'MANAGERS' TO 'SHARED_WITH_MANAGER';
ALTER TYPE "FeedbackVisibility" RENAME VALUE 'HR' TO 'HR_ONLY';

-- ---------------------------------------------------------------------------
-- Courses: categories, difficulty, duration, requirement, completion rules
-- ---------------------------------------------------------------------------
CREATE TABLE "course_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "course_categories_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "course_categories_organization_id_slug_key" ON "course_categories"("organization_id", "slug");
ALTER TABLE "course_categories" ADD CONSTRAINT "course_categories_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "course_categories" ADD CONSTRAINT "course_categories_slug_chk" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

ALTER TABLE "courses"
  ADD COLUMN "category_id" UUID,
  ADD COLUMN "difficulty" "CourseDifficulty" NOT NULL DEFAULT 'BEGINNER',
  ADD COLUMN "estimated_minutes" INTEGER,
  ADD COLUMN "is_required" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "is_sequential" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "require_quizzes" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "require_assignments" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "published_at" TIMESTAMPTZ(3),
  ADD COLUMN "updated_by" UUID,
  ADD COLUMN "deleted_at" TIMESTAMPTZ(3);
ALTER TABLE "courses" ADD CONSTRAINT "courses_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "course_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "courses" ADD CONSTRAINT "courses_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "courses" ADD CONSTRAINT "courses_estimated_minutes_chk" CHECK ("estimated_minutes" IS NULL OR "estimated_minutes" BETWEEN 1 AND 100000);
CREATE INDEX "courses_category_id_idx" ON "courses"("category_id");
UPDATE "courses" SET "published_at" = "updated_at" WHERE "status" = 'PUBLISHED';

-- ---------------------------------------------------------------------------
-- Modules; lessons move into modules
-- ---------------------------------------------------------------------------
CREATE TABLE "course_modules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "course_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "course_modules_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "course_modules_course_id_position_idx" ON "course_modules"("course_id", "position");
ALTER TABLE "course_modules" ADD CONSTRAINT "course_modules_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every existing course gets one module holding its existing lessons.
INSERT INTO "course_modules" ("id", "course_id", "title", "position")
  SELECT gen_random_uuid(), c."id", 'Module 1', 0 FROM "courses" c;

ALTER TABLE "lessons"
  ADD COLUMN "module_id" UUID,
  ADD COLUMN "content_type" "LessonContentType" NOT NULL DEFAULT 'TEXT',
  ADD COLUMN "document_url" TEXT,
  ADD COLUMN "link_url" TEXT,
  ADD COLUMN "is_required" BOOLEAN NOT NULL DEFAULT true;
UPDATE "lessons" l SET "module_id" = m."id" FROM "course_modules" m WHERE m."course_id" = l."course_id";
ALTER TABLE "lessons" ALTER COLUMN "module_id" SET NOT NULL;
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "course_modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "lessons_module_id_sort_order_idx" ON "lessons"("module_id", "sort_order");
ALTER TABLE "lessons"
  ADD CONSTRAINT "lessons_urls_chk" CHECK (
    ("video_url" IS NULL OR "video_url" ~ '^https://') AND
    ("document_url" IS NULL OR "document_url" ~ '^https://') AND
    ("link_url" IS NULL OR "link_url" ~ '^https://')
  );

-- ---------------------------------------------------------------------------
-- Enrollments, lesson progress, paths, plans, required training
-- ---------------------------------------------------------------------------
CREATE TABLE "course_enrollments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "enrollment_type" "EnrollmentType" NOT NULL,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "progress_percentage" INTEGER NOT NULL DEFAULT 0,
    "assigned_by" UUID,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_date" DATE,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "learning_plan_id" UUID,
    "required_rule_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "course_enrollments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "course_enrollments_course_id_user_id_key" ON "course_enrollments"("course_id", "user_id");
CREATE INDEX "course_enrollments_organization_id_status_idx" ON "course_enrollments"("organization_id", "status");
CREATE INDEX "course_enrollments_user_id_status_idx" ON "course_enrollments"("user_id", "status");
CREATE INDEX "course_enrollments_due_date_idx" ON "course_enrollments"("due_date");
ALTER TABLE "course_enrollments" ADD CONSTRAINT "course_enrollments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "course_enrollments" ADD CONSTRAINT "course_enrollments_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "course_enrollments" ADD CONSTRAINT "course_enrollments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "course_enrollments" ADD CONSTRAINT "course_enrollments_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "course_enrollments" ADD CONSTRAINT "course_enrollments_progress_chk" CHECK ("progress_percentage" BETWEEN 0 AND 100);
ALTER TABLE "course_enrollments" ADD CONSTRAINT "course_enrollments_completed_chk" CHECK ("status" <> 'COMPLETED' OR "completed_at" IS NOT NULL);

ALTER TABLE "learning_progress"
  ADD COLUMN "started_at" TIMESTAMPTZ(3),
  ADD COLUMN "last_accessed_at" TIMESTAMPTZ(3),
  ADD COLUMN "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "learning_progress_user_id_course_id_idx" ON "learning_progress"("user_id", "course_id");
-- Course-level rows (lesson_id NULL) are unique per user and course too.
CREATE UNIQUE INDEX "learning_progress_course_level_key" ON "learning_progress"("user_id", "course_id") WHERE "lesson_id" IS NULL;

CREATE TABLE "learning_paths" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "department_id" UUID,
    "position_id" UUID,
    "status" "CourseStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),
    CONSTRAINT "learning_paths_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "learning_paths_organization_id_slug_key" ON "learning_paths"("organization_id", "slug");
ALTER TABLE "learning_paths" ADD CONSTRAINT "learning_paths_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "learning_paths" ADD CONSTRAINT "learning_paths_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "learning_paths" ADD CONSTRAINT "learning_paths_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "learning_paths" ADD CONSTRAINT "learning_paths_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "learning_path_courses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "learning_path_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "is_required" BOOLEAN NOT NULL DEFAULT true,
    "requires_previous" BOOLEAN NOT NULL DEFAULT false,
    "due_days" INTEGER,
    CONSTRAINT "learning_path_courses_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "learning_path_courses_learning_path_id_course_id_key" ON "learning_path_courses"("learning_path_id", "course_id");
ALTER TABLE "learning_path_courses" ADD CONSTRAINT "learning_path_courses_learning_path_id_fkey" FOREIGN KEY ("learning_path_id") REFERENCES "learning_paths"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "learning_path_courses" ADD CONSTRAINT "learning_path_courses_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "learning_path_courses" ADD CONSTRAINT "learning_path_courses_due_days_chk" CHECK ("due_days" IS NULL OR "due_days" BETWEEN 1 AND 365);

CREATE TABLE "learning_plans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "learning_path_id" UUID,
    "path_name" TEXT NOT NULL,
    "status" "LearningPlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "assigned_by" UUID,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_date" DATE,
    "completed_at" TIMESTAMPTZ(3),
    CONSTRAINT "learning_plans_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "learning_plans_user_id_idx" ON "learning_plans"("user_id");
CREATE INDEX "learning_plans_organization_id_status_idx" ON "learning_plans"("organization_id", "status");
-- One active plan per person and path.
CREATE UNIQUE INDEX "learning_plans_active_key" ON "learning_plans"("user_id", "learning_path_id") WHERE "status" = 'ACTIVE';
ALTER TABLE "learning_plans" ADD CONSTRAINT "learning_plans_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "learning_plans" ADD CONSTRAINT "learning_plans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "learning_plans" ADD CONSTRAINT "learning_plans_learning_path_id_fkey" FOREIGN KEY ("learning_path_id") REFERENCES "learning_paths"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "learning_plans" ADD CONSTRAINT "learning_plans_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The plan's own copy of the path (later path edits never change a plan).
CREATE TABLE "learning_plan_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "learning_plan_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "is_required" BOOLEAN NOT NULL DEFAULT true,
    "prerequisite_course_id" UUID,
    "due_date" DATE,
    CONSTRAINT "learning_plan_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "learning_plan_items_learning_plan_id_course_id_key" ON "learning_plan_items"("learning_plan_id", "course_id");
ALTER TABLE "learning_plan_items" ADD CONSTRAINT "learning_plan_items_learning_plan_id_fkey" FOREIGN KEY ("learning_plan_id") REFERENCES "learning_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "learning_plan_items" ADD CONSTRAINT "learning_plan_items_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "learning_plan_items" ADD CONSTRAINT "learning_plan_items_prerequisite_course_id_fkey" FOREIGN KEY ("prerequisite_course_id") REFERENCES "courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "required_training_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "target_type" "RequiredTrainingTarget" NOT NULL,
    "target_id" UUID,
    "due_days" INTEGER NOT NULL DEFAULT 14,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "required_training_rules_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "required_training_rules_organization_id_is_active_idx" ON "required_training_rules"("organization_id", "is_active");
ALTER TABLE "required_training_rules" ADD CONSTRAINT "required_training_rules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "required_training_rules" ADD CONSTRAINT "required_training_rules_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "required_training_rules" ADD CONSTRAINT "required_training_rules_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "required_training_rules"
  ADD CONSTRAINT "required_training_rules_target_chk" CHECK (("target_type" = 'EVERYONE') = ("target_id" IS NULL)),
  ADD CONSTRAINT "required_training_rules_due_chk" CHECK ("due_days" BETWEEN 1 AND 365);

ALTER TABLE "course_enrollments" ADD CONSTRAINT "course_enrollments_learning_plan_id_fkey" FOREIGN KEY ("learning_plan_id") REFERENCES "learning_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "course_enrollments" ADD CONSTRAINT "course_enrollments_required_rule_id_fkey" FOREIGN KEY ("required_rule_id") REFERENCES "required_training_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Quizzes: course/module placement, policy, questions, options, answers
-- ---------------------------------------------------------------------------
ALTER TABLE "quizzes"
  ADD COLUMN "course_id" UUID,
  ADD COLUMN "module_id" UUID,
  ADD COLUMN "description" TEXT,
  ADD COLUMN "attempt_limit" INTEGER,
  ADD COLUMN "time_limit_minutes" INTEGER,
  ADD COLUMN "answer_policy" "QuizAnswerPolicy" NOT NULL DEFAULT 'AFTER_SUBMISSION',
  ADD COLUMN "status" "CourseStatus" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "is_required" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
UPDATE "quizzes" q SET "course_id" = l."course_id", "module_id" = l."module_id" FROM "lessons" l WHERE l."id" = q."lesson_id";
ALTER TABLE "quizzes" ALTER COLUMN "course_id" SET NOT NULL, ALTER COLUMN "lesson_id" DROP NOT NULL;
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "course_modules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "quizzes_course_id_idx" ON "quizzes"("course_id");
ALTER TABLE "quizzes"
  ADD CONSTRAINT "quizzes_attempt_limit_chk" CHECK ("attempt_limit" IS NULL OR "attempt_limit" BETWEEN 1 AND 20),
  ADD CONSTRAINT "quizzes_time_limit_chk" CHECK ("time_limit_minutes" IS NULL OR "time_limit_minutes" BETWEEN 1 AND 600);

CREATE TABLE "quiz_questions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "quiz_id" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "question_type" "QuizQuestionType" NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 1,
    "position" INTEGER NOT NULL DEFAULT 0,
    "explanation" TEXT,
    -- SHORT_ANSWER: accepted answers (compared trimmed, case-insensitive). Never sent to learners before submission.
    "accepted_answers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "quiz_questions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "quiz_questions_quiz_id_position_idx" ON "quiz_questions"("quiz_id", "position");
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_quiz_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "quizzes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_points_chk" CHECK ("points" BETWEEN 1 AND 100);

CREATE TABLE "quiz_options" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "question_id" UUID NOT NULL,
    "option_text" TEXT NOT NULL,
    "is_correct" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "quiz_options_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "quiz_options_question_id_idx" ON "quiz_options"("question_id");
ALTER TABLE "quiz_options" ADD CONSTRAINT "quiz_options_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "quiz_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quiz_attempts"
  ADD COLUMN "attempt_number" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "status" "QuizAttemptStatus" NOT NULL DEFAULT 'SUBMITTED',
  ADD COLUMN "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "submitted_at" TIMESTAMPTZ(3),
  ADD COLUMN "max_score" INTEGER,
  ADD COLUMN "percentage" INTEGER;
UPDATE "quiz_attempts" SET "started_at" = "attempted_at", "submitted_at" = "attempted_at";
ALTER TABLE "quiz_attempts" ALTER COLUMN "score" DROP NOT NULL, ALTER COLUMN "passed" DROP NOT NULL;
-- score is now points earned (percentage is stored separately), so it is no longer capped at 100.
ALTER TABLE "quiz_attempts" DROP CONSTRAINT "quiz_attempts_score_chk";
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_score_chk" CHECK ("score" IS NULL OR "score" >= 0);
ALTER TABLE "quiz_attempts" ALTER COLUMN "status" SET DEFAULT 'IN_PROGRESS';
CREATE UNIQUE INDEX "quiz_attempts_quiz_id_user_id_attempt_number_key" ON "quiz_attempts"("quiz_id", "user_id", "attempt_number");
-- At most one open attempt per person and quiz.
CREATE UNIQUE INDEX "quiz_attempts_one_open_key" ON "quiz_attempts"("quiz_id", "user_id") WHERE "status" = 'IN_PROGRESS';
ALTER TABLE "quiz_attempts"
  ADD CONSTRAINT "quiz_attempts_submitted_chk" CHECK ("status" = 'IN_PROGRESS' OR ("submitted_at" IS NOT NULL AND "score" IS NOT NULL AND "passed" IS NOT NULL)),
  ADD CONSTRAINT "quiz_attempts_percentage_chk" CHECK ("percentage" IS NULL OR "percentage" BETWEEN 0 AND 100);

CREATE TABLE "quiz_answers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "attempt_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "selected_option_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    "text_answer" TEXT,
    "is_correct" BOOLEAN NOT NULL DEFAULT false,
    "points_awarded" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "quiz_answers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "quiz_answers_attempt_id_question_id_key" ON "quiz_answers"("attempt_id", "question_id");
ALTER TABLE "quiz_answers" ADD CONSTRAINT "quiz_answers_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "quiz_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quiz_answers" ADD CONSTRAINT "quiz_answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "quiz_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Learning assignments (same submit → review → versions pattern as tasks)
-- ---------------------------------------------------------------------------
CREATE TABLE "learning_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "course_id" UUID NOT NULL,
    "module_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "instructions" TEXT,
    "due_days" INTEGER,
    "max_points" INTEGER,
    "rubric" TEXT,
    "is_required" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "learning_assignments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "learning_assignments_course_id_idx" ON "learning_assignments"("course_id");
ALTER TABLE "learning_assignments" ADD CONSTRAINT "learning_assignments_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "learning_assignments" ADD CONSTRAINT "learning_assignments_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "course_modules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "learning_assignments"
  ADD CONSTRAINT "learning_assignments_points_chk" CHECK ("max_points" IS NULL OR ("max_points" BETWEEN 1 AND 1000 AND "rubric" IS NOT NULL)),
  ADD CONSTRAINT "learning_assignments_due_chk" CHECK ("due_days" IS NULL OR "due_days" BETWEEN 1 AND 365);

CREATE TABLE "learning_assignment_submissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'DRAFT',
    "draft_text" TEXT,
    "current_version" INTEGER NOT NULL DEFAULT 0,
    "points_awarded" INTEGER,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "review_comment" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "learning_assignment_submissions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "learning_assignment_submissions_assignment_id_user_id_key" ON "learning_assignment_submissions"("assignment_id", "user_id");
CREATE INDEX "learning_assignment_submissions_organization_id_status_idx" ON "learning_assignment_submissions"("organization_id", "status");
ALTER TABLE "learning_assignment_submissions" ADD CONSTRAINT "learning_assignment_submissions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "learning_assignment_submissions" ADD CONSTRAINT "learning_assignment_submissions_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "learning_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "learning_assignment_submissions" ADD CONSTRAINT "learning_assignment_submissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "learning_assignment_submissions" ADD CONSTRAINT "learning_assignment_submissions_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "learning_assignment_submissions" ADD CONSTRAINT "learning_assignment_submissions_points_chk" CHECK ("points_awarded" IS NULL OR "points_awarded" >= 0);

CREATE TABLE "learning_submission_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "submission_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "message" TEXT,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'SUBMITTED',
    "submitted_by" UUID,
    "submitted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "review_comment" TEXT,
    "points_awarded" INTEGER,
    CONSTRAINT "learning_submission_versions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "learning_submission_versions_submission_id_version_number_key" ON "learning_submission_versions"("submission_id", "version_number");
ALTER TABLE "learning_submission_versions" ADD CONSTRAINT "learning_submission_versions_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "learning_assignment_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "learning_submission_versions" ADD CONSTRAINT "learning_submission_versions_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "learning_submission_versions" ADD CONSTRAINT "learning_submission_versions_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "learning_submission_versions" ADD CONSTRAINT "learning_submission_versions_number_chk" CHECK ("version_number" >= 1);

CREATE TABLE "learning_submission_files" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "version_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "learning_submission_files_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "learning_submission_files_version_id_idx" ON "learning_submission_files"("version_id");
ALTER TABLE "learning_submission_files" ADD CONSTRAINT "learning_submission_files_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "learning_submission_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "learning_submission_files" ADD CONSTRAINT "learning_submission_files_size_chk" CHECK ("file_size" > 0);

-- ---------------------------------------------------------------------------
-- Feedback: context, type, requests
-- ---------------------------------------------------------------------------
ALTER TABLE "feedback"
  ADD COLUMN "context_type" "FeedbackContextType" NOT NULL DEFAULT 'GENERAL',
  ADD COLUMN "context_id" UUID,
  ADD COLUMN "feedback_type" "FeedbackType" NOT NULL DEFAULT 'GENERAL',
  ADD COLUMN "edited_at" TIMESTAMPTZ(3);
UPDATE "feedback" SET "feedback_type" = CASE "category" WHEN 'PRAISE' THEN 'POSITIVE'::"FeedbackType" WHEN 'IMPROVEMENT' THEN 'DEVELOPMENTAL'::"FeedbackType" ELSE 'GENERAL'::"FeedbackType" END;
CREATE INDEX "feedback_context_type_context_id_idx" ON "feedback"("context_type", "context_id");
ALTER TABLE "feedback"
  ADD CONSTRAINT "feedback_context_chk" CHECK (("context_type" = 'GENERAL') OR ("context_id" IS NOT NULL)),
  ADD CONSTRAINT "feedback_body_chk" CHECK (char_length("body") BETWEEN 1 AND 5000);

CREATE TABLE "feedback_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "requester_id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "intern_id" UUID,
    "context_type" "FeedbackContextType" NOT NULL DEFAULT 'GENERAL',
    "context_id" UUID,
    "question" TEXT NOT NULL,
    "due_date" DATE,
    "status" "FeedbackRequestStatus" NOT NULL DEFAULT 'OPEN',
    "feedback_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "feedback_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "feedback_requests_recipient_id_status_idx" ON "feedback_requests"("recipient_id", "status");
CREATE INDEX "feedback_requests_requester_id_idx" ON "feedback_requests"("requester_id");
ALTER TABLE "feedback_requests" ADD CONSTRAINT "feedback_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "feedback_requests" ADD CONSTRAINT "feedback_requests_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "feedback_requests" ADD CONSTRAINT "feedback_requests_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "feedback_requests" ADD CONSTRAINT "feedback_requests_intern_id_fkey" FOREIGN KEY ("intern_id") REFERENCES "interns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "feedback_requests" ADD CONSTRAINT "feedback_requests_feedback_id_fkey" FOREIGN KEY ("feedback_id") REFERENCES "feedback"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "feedback_requests"
  ADD CONSTRAINT "feedback_requests_question_chk" CHECK (char_length("question") BETWEEN 3 AND 1000),
  ADD CONSTRAINT "feedback_requests_self_chk" CHECK ("requester_id" <> "recipient_id");

-- ---------------------------------------------------------------------------
-- Weekly check-ins: status, organization, priorities, reviewer comment
-- ---------------------------------------------------------------------------
ALTER TABLE "weekly_checkins"
  ADD COLUMN "organization_id" UUID,
  ADD COLUMN "status" "CheckinStatus" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "next_week_priorities" TEXT,
  ADD COLUMN "review_comment" TEXT,
  ADD COLUMN "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "weekly_checkins" w SET "organization_id" = i."organization_id" FROM "interns" i WHERE i."id" = w."intern_id";
UPDATE "weekly_checkins" SET "status" = CASE WHEN "reviewed_at" IS NOT NULL THEN 'REVIEWED'::"CheckinStatus" WHEN "submitted_at" IS NOT NULL THEN 'SUBMITTED'::"CheckinStatus" ELSE 'DRAFT'::"CheckinStatus" END;
ALTER TABLE "weekly_checkins" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "weekly_checkins" ADD CONSTRAINT "weekly_checkins_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "weekly_checkins_organization_id_status_idx" ON "weekly_checkins"("organization_id", "status");
ALTER TABLE "weekly_checkins"
  ADD CONSTRAINT "weekly_checkins_submitted_chk" CHECK ("status" = 'DRAFT' OR "submitted_at" IS NOT NULL),
  ADD CONSTRAINT "weekly_checkins_reviewed_chk" CHECK ("status" <> 'REVIEWED' OR "reviewed_at" IS NOT NULL);

-- ---------------------------------------------------------------------------
-- Goals and evidence
-- ---------------------------------------------------------------------------
CREATE TABLE "performance_goals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "intern_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" "GoalCategory" NOT NULL DEFAULT 'OTHER',
    "status" "GoalStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "start_date" DATE,
    "target_date" DATE,
    "owner_id" UUID NOT NULL,
    "created_by" UUID,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "performance_goals_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "performance_goals_organization_id_status_idx" ON "performance_goals"("organization_id", "status");
CREATE INDEX "performance_goals_intern_id_idx" ON "performance_goals"("intern_id");
ALTER TABLE "performance_goals" ADD CONSTRAINT "performance_goals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "performance_goals" ADD CONSTRAINT "performance_goals_intern_id_fkey" FOREIGN KEY ("intern_id") REFERENCES "interns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "performance_goals" ADD CONSTRAINT "performance_goals_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "performance_goals" ADD CONSTRAINT "performance_goals_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "performance_goals"
  ADD CONSTRAINT "performance_goals_progress_chk" CHECK ("progress" IN (0, 25, 50, 75, 100)),
  ADD CONSTRAINT "performance_goals_dates_chk" CHECK ("start_date" IS NULL OR "target_date" IS NULL OR "target_date" >= "start_date"),
  ADD CONSTRAINT "performance_goals_title_chk" CHECK (char_length("title") BETWEEN 3 AND 200);

CREATE TABLE "goal_evidence" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "goal_id" UUID NOT NULL,
    "evidence_type" "GoalEvidenceType" NOT NULL,
    "reference_id" UUID,
    "url" TEXT,
    "note" TEXT,
    "added_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "goal_evidence_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "goal_evidence_goal_id_idx" ON "goal_evidence"("goal_id");
ALTER TABLE "goal_evidence" ADD CONSTRAINT "goal_evidence_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "performance_goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "goal_evidence" ADD CONSTRAINT "goal_evidence_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "goal_evidence"
  ADD CONSTRAINT "goal_evidence_shape_chk" CHECK (
    ("evidence_type" = 'LINK' AND "url" ~ '^https://') OR
    ("evidence_type" = 'NOTE' AND "note" IS NOT NULL) OR
    ("evidence_type" NOT IN ('LINK', 'NOTE') AND "reference_id" IS NOT NULL)
  );

-- ---------------------------------------------------------------------------
-- Review templates, cycles, reviews, answers, revisions
-- ---------------------------------------------------------------------------
CREATE TABLE "performance_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "performance_templates_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "performance_templates_organization_id_idx" ON "performance_templates"("organization_id");
ALTER TABLE "performance_templates" ADD CONSTRAINT "performance_templates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "performance_templates" ADD CONSTRAINT "performance_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "performance_sections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "template_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    -- Who answers this section (self-review, manager, mentor, HR).
    "respondents" "ReviewRespondent"[] NOT NULL DEFAULT ARRAY['MANAGER']::"ReviewRespondent"[],
    CONSTRAINT "performance_sections_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "performance_sections_template_id_position_idx" ON "performance_sections"("template_id", "position");
ALTER TABLE "performance_sections" ADD CONSTRAINT "performance_sections_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "performance_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "performance_sections" ADD CONSTRAINT "performance_sections_respondents_chk" CHECK (cardinality("respondents") > 0);

CREATE TABLE "performance_questions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "section_id" UUID NOT NULL,
    "prompt" TEXT NOT NULL,
    "question_type" "ReviewQuestionType" NOT NULL DEFAULT 'TEXT',
    "guidance" TEXT,
    "options" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "is_required" BOOLEAN NOT NULL DEFAULT true,
    "requires_evidence" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "performance_questions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "performance_questions_section_id_position_idx" ON "performance_questions"("section_id", "position");
ALTER TABLE "performance_questions" ADD CONSTRAINT "performance_questions_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "performance_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "performance_questions" ADD CONSTRAINT "performance_questions_options_chk" CHECK ("question_type" <> 'MULTI_SELECT' OR cardinality("options") >= 2);

CREATE TABLE "performance_cycles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "cycle_type" "ReviewCycleType" NOT NULL,
    "status" "ReviewCycleStatus" NOT NULL DEFAULT 'DRAFT',
    "template_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "department_id" UUID,
    "self_review_enabled" BOOLEAN NOT NULL DEFAULT true,
    "mentor_review_enabled" BOOLEAN NOT NULL DEFAULT true,
    "hr_review_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "opened_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "performance_cycles_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "performance_cycles_organization_id_status_idx" ON "performance_cycles"("organization_id", "status");
ALTER TABLE "performance_cycles" ADD CONSTRAINT "performance_cycles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "performance_cycles" ADD CONSTRAINT "performance_cycles_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "performance_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "performance_cycles" ADD CONSTRAINT "performance_cycles_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "performance_cycles" ADD CONSTRAINT "performance_cycles_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "performance_cycles" ADD CONSTRAINT "performance_cycles_dates_chk" CHECK ("due_date" >= "start_date");

ALTER TABLE "performance_reviews"
  ADD COLUMN "cycle_id" UUID,
  ADD COLUMN "template_id" UUID,
  ADD COLUMN "mentor_id" UUID,
  ADD COLUMN "due_date" DATE,
  ADD COLUMN "self_review_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "mentor_review_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "hr_review_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "stage_submitted" "ReviewRespondent"[] NOT NULL DEFAULT ARRAY[]::"ReviewRespondent"[],
  ADD COLUMN "completed_at" TIMESTAMPTZ(3),
  ADD COLUMN "completed_by" UUID,
  ADD COLUMN "locked_at" TIMESTAMPTZ(3),
  ADD COLUMN "reopened_at" TIMESTAMPTZ(3),
  ADD COLUMN "reopen_reason" TEXT;
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "performance_cycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "performance_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_mentor_id_fkey" FOREIGN KEY ("mentor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_completed_by_fkey" FOREIGN KEY ("completed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "performance_reviews_cycle_id_idx" ON "performance_reviews"("cycle_id");
-- One review per intern per cycle.
CREATE UNIQUE INDEX "performance_reviews_cycle_id_intern_id_key" ON "performance_reviews"("cycle_id", "intern_id") WHERE "cycle_id" IS NOT NULL;

CREATE TABLE "performance_review_answers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "review_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "respondent" "ReviewRespondent" NOT NULL,
    "author_id" UUID,
    "rating" INTEGER,
    "text_value" TEXT,
    "bool_value" BOOLEAN,
    "selected_options" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "evidence" TEXT,
    "evidence_refs" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "performance_review_answers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "performance_review_answers_review_question_respondent_key" ON "performance_review_answers"("review_id", "question_id", "respondent");
ALTER TABLE "performance_review_answers" ADD CONSTRAINT "performance_review_answers_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "performance_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "performance_review_answers" ADD CONSTRAINT "performance_review_answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "performance_questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "performance_review_answers" ADD CONSTRAINT "performance_review_answers_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "performance_review_answers" ADD CONSTRAINT "performance_review_answers_rating_chk" CHECK ("rating" IS NULL OR "rating" BETWEEN 1 AND 5);

-- Corrections to completed reviews keep the previous values.
CREATE TABLE "performance_review_revisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "review_id" UUID NOT NULL,
    "answer_id" UUID,
    "actor_id" UUID,
    "reason" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "performance_review_revisions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "performance_review_revisions_review_id_idx" ON "performance_review_revisions"("review_id");
ALTER TABLE "performance_review_revisions" ADD CONSTRAINT "performance_review_revisions_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "performance_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "performance_review_revisions" ADD CONSTRAINT "performance_review_revisions_answer_id_fkey" FOREIGN KEY ("answer_id") REFERENCES "performance_review_answers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "performance_review_revisions" ADD CONSTRAINT "performance_review_revisions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "performance_review_revisions" ADD CONSTRAINT "performance_review_revisions_reason_chk" CHECK (char_length("reason") >= 3);

-- ---------------------------------------------------------------------------
-- Development plans
-- ---------------------------------------------------------------------------
CREATE TABLE "development_plans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "intern_id" UUID NOT NULL,
    "review_id" UUID,
    "title" TEXT NOT NULL,
    "status" "DevelopmentPlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "development_plans_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "development_plans_intern_id_idx" ON "development_plans"("intern_id");
ALTER TABLE "development_plans" ADD CONSTRAINT "development_plans_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "development_plans" ADD CONSTRAINT "development_plans_intern_id_fkey" FOREIGN KEY ("intern_id") REFERENCES "interns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "development_plans" ADD CONSTRAINT "development_plans_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "performance_reviews"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "development_plans" ADD CONSTRAINT "development_plans_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "development_plan_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "plan_id" UUID NOT NULL,
    "area" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "owner_id" UUID,
    "target_date" DATE,
    "status" "DevelopmentItemStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "evidence" TEXT,
    "course_id" UUID,
    "goal_id" UUID,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "development_plan_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "development_plan_items_plan_id_idx" ON "development_plan_items"("plan_id");
ALTER TABLE "development_plan_items" ADD CONSTRAINT "development_plan_items_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "development_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "development_plan_items" ADD CONSTRAINT "development_plan_items_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "development_plan_items" ADD CONSTRAINT "development_plan_items_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "development_plan_items" ADD CONSTRAINT "development_plan_items_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "performance_goals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Row-level security for new tables
-- ---------------------------------------------------------------------------
ALTER TABLE "course_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "course_modules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "course_enrollments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "learning_paths" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "learning_path_courses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "learning_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "learning_plan_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "required_training_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quiz_questions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quiz_options" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quiz_answers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "learning_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "learning_assignment_submissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "learning_submission_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "learning_submission_files" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "feedback_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "performance_goals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "goal_evidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "performance_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "performance_sections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "performance_questions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "performance_cycles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "performance_review_answers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "performance_review_revisions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "development_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "development_plan_items" ENABLE ROW LEVEL SECURITY;

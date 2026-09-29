-- Phase 04: tasks, projects and work management.
-- Extends the Phase 01 work tables in place (renaming enum values keeps existing rows valid).

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
ALTER TYPE "ProjectStatus" RENAME VALUE 'PLANNED' TO 'PLANNING';
ALTER TYPE "ProjectStatus" ADD VALUE 'ARCHIVED';

ALTER TYPE "ProjectMemberRole" RENAME VALUE 'LEAD' TO 'MANAGER';
ALTER TYPE "ProjectMemberRole" RENAME VALUE 'MEMBER' TO 'CONTRIBUTOR';
ALTER TYPE "ProjectMemberRole" ADD VALUE 'MENTOR' BEFORE 'CONTRIBUTOR';

-- OVERDUE is derived from the due date at read time, never stored.
ALTER TYPE "MilestoneStatus" RENAME VALUE 'PLANNED' TO 'UPCOMING';
ALTER TYPE "MilestoneStatus" RENAME VALUE 'IN_PROGRESS' TO 'ACTIVE';

ALTER TYPE "SubmissionStatus" ADD VALUE 'RESUBMITTED' AFTER 'CHANGES_REQUESTED';

CREATE TYPE "TaskDependencyType" AS ENUM ('BLOCKS');

-- ---------------------------------------------------------------------------
-- Projects
-- ---------------------------------------------------------------------------
ALTER TABLE "projects"
  ADD COLUMN "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
  ADD COLUMN "manager_id" UUID,
  ADD COLUMN "created_by" UUID,
  ADD COLUMN "progress_percentage" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "projects" ADD CONSTRAINT "projects_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "projects_manager_id_idx" ON "projects"("manager_id");
ALTER TABLE "projects"
  ADD CONSTRAINT "projects_progress_chk" CHECK ("progress_percentage" BETWEEN 0 AND 100);

ALTER TABLE "project_members" ADD COLUMN "added_by" UUID;
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Milestones
-- ---------------------------------------------------------------------------
ALTER TABLE "milestones"
  ADD COLUMN "start_date" DATE,
  ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "completed_at" TIMESTAMPTZ(3);
ALTER TABLE "milestones"
  ADD CONSTRAINT "milestones_dates_chk" CHECK ("start_date" IS NULL OR "due_date" IS NULL OR "due_date" >= "start_date");
CREATE INDEX "milestones_project_id_position_idx" ON "milestones"("project_id", "position");

-- ---------------------------------------------------------------------------
-- Tasks: calendar-date deadlines, ordering, lifecycle bookkeeping
-- ---------------------------------------------------------------------------
ALTER TABLE "tasks" ALTER COLUMN "due_date" TYPE DATE USING (("due_date" AT TIME ZONE 'Asia/Kolkata')::date);
ALTER TABLE "tasks"
  ADD COLUMN "start_date" DATE,
  ADD COLUMN "updated_by" UUID,
  ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "previous_status" "TaskStatus",
  ADD COLUMN "blocked_reason" TEXT,
  ADD COLUMN "started_at" TIMESTAMPTZ(3),
  ADD COLUMN "is_recurring" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "recurrence_rule" TEXT;
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_dates_chk" CHECK ("start_date" IS NULL OR "due_date" IS NULL OR "due_date" >= "start_date"),
  ADD CONSTRAINT "tasks_blocked_reason_chk" CHECK ("blocked_reason" IS NULL OR char_length("blocked_reason") <= 500),
  ADD CONSTRAINT "tasks_recurrence_chk" CHECK ("is_recurring" OR "recurrence_rule" IS NULL);
CREATE INDEX "tasks_organization_id_priority_idx" ON "tasks"("organization_id", "priority");
CREATE INDEX "tasks_project_id_status_position_idx" ON "tasks"("project_id", "status", "position");

-- ---------------------------------------------------------------------------
-- Comments: threads and mentions
-- ---------------------------------------------------------------------------
ALTER TABLE "task_comments"
  ADD COLUMN "parent_id" UUID,
  ADD COLUMN "edited_at" TIMESTAMPTZ(3);
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "task_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "task_comments_parent_id_idx" ON "task_comments"("parent_id");
ALTER TABLE "task_comments"
  ADD CONSTRAINT "task_comments_body_chk" CHECK (char_length("body") BETWEEN 1 AND 5000);

CREATE TABLE "task_comment_mentions" (
    "comment_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    CONSTRAINT "task_comment_mentions_pkey" PRIMARY KEY ("comment_id","user_id")
);
CREATE INDEX "task_comment_mentions_user_id_idx" ON "task_comment_mentions"("user_id");
ALTER TABLE "task_comment_mentions" ADD CONSTRAINT "task_comment_mentions_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "task_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_comment_mentions" ADD CONSTRAINT "task_comment_mentions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Submissions: every version keeps its own message, files and review result
-- ---------------------------------------------------------------------------
ALTER TABLE "submission_versions"
  ADD COLUMN "status" "SubmissionStatus" NOT NULL DEFAULT 'SUBMITTED',
  ADD COLUMN "submitted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "reviewed_by" UUID,
  ADD COLUMN "reviewed_at" TIMESTAMPTZ(3),
  ADD COLUMN "review_comment" TEXT;
ALTER TABLE "submission_versions" ADD CONSTRAINT "submission_versions_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "task_attachments" ADD COLUMN "submission_version_id" UUID;
ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_submission_version_id_fkey" FOREIGN KEY ("submission_version_id") REFERENCES "submission_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "task_attachments_submission_version_id_idx" ON "task_attachments"("submission_version_id");

-- ---------------------------------------------------------------------------
-- Checklists, dependencies, time entries, project files
-- ---------------------------------------------------------------------------
CREATE TABLE "task_checklist_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "task_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "is_completed" BOOLEAN NOT NULL DEFAULT false,
    "completed_by" UUID,
    "completed_at" TIMESTAMPTZ(3),
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "task_checklist_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "task_checklist_items_task_id_position_idx" ON "task_checklist_items"("task_id", "position");
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_completed_by_fkey" FOREIGN KEY ("completed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "task_checklist_items"
  ADD CONSTRAINT "task_checklist_items_title_chk" CHECK (char_length("title") BETWEEN 1 AND 200),
  ADD CONSTRAINT "task_checklist_items_completion_chk" CHECK ("is_completed" = ("completed_at" IS NOT NULL));

CREATE TABLE "task_dependencies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "task_id" UUID NOT NULL,
    "depends_on_task_id" UUID NOT NULL,
    "dependency_type" "TaskDependencyType" NOT NULL DEFAULT 'BLOCKS',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "task_dependencies_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "task_dependencies_task_id_depends_on_task_id_key" ON "task_dependencies"("task_id", "depends_on_task_id");
CREATE INDEX "task_dependencies_depends_on_task_id_idx" ON "task_dependencies"("depends_on_task_id");
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_depends_on_task_id_fkey" FOREIGN KEY ("depends_on_task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "task_dependencies"
  ADD CONSTRAINT "task_dependencies_not_self_chk" CHECK ("task_id" <> "depends_on_task_id");

CREATE TABLE "task_time_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "task_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "duration_minutes" INTEGER NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "task_time_entries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "task_time_entries_task_id_idx" ON "task_time_entries"("task_id");
CREATE INDEX "task_time_entries_user_id_created_at_idx" ON "task_time_entries"("user_id", "created_at");
ALTER TABLE "task_time_entries" ADD CONSTRAINT "task_time_entries_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_time_entries" ADD CONSTRAINT "task_time_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_time_entries"
  ADD CONSTRAINT "task_time_entries_duration_chk" CHECK ("duration_minutes" BETWEEN 1 AND 1440),
  ADD CONSTRAINT "task_time_entries_range_chk" CHECK ("started_at" IS NULL OR "ended_at" IS NULL OR "ended_at" > "started_at");

CREATE TABLE "project_attachments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "uploaded_by" UUID,
    "file_name" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),
    CONSTRAINT "project_attachments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "project_attachments_organization_id_idx" ON "project_attachments"("organization_id");
CREATE INDEX "project_attachments_project_id_idx" ON "project_attachments"("project_id");
ALTER TABLE "project_attachments" ADD CONSTRAINT "project_attachments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_attachments" ADD CONSTRAINT "project_attachments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_attachments" ADD CONSTRAINT "project_attachments_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "project_attachments"
  ADD CONSTRAINT "project_attachments_size_chk" CHECK ("file_size" > 0);

-- Project activity timeline reads project-related audit entries by metadata.projectId.
CREATE INDEX "audit_logs_project_activity_idx" ON "audit_logs"("organization_id", ("metadata"->>'projectId'), "created_at" DESC);

-- ---------------------------------------------------------------------------
-- Row-level security: deny-by-default for Supabase's public API (the app uses
-- its own server-side role; see 20260928122400_constraints_and_rls).
-- ---------------------------------------------------------------------------
ALTER TABLE "task_comment_mentions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "task_checklist_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "task_dependencies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "task_time_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "project_attachments" ENABLE ROW LEVEL SECURITY;

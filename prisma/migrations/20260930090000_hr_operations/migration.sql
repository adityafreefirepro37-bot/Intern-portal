-- Phase 05: HR operations — attendance, leave, documents, HR requests, holidays,
-- announcements targeting and offboarding preparation.
-- Extends the Phase 01 HR tables in place; new tables only where nothing equivalent exists.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
ALTER TYPE "AttendanceStatus" RENAME VALUE 'LEAVE' TO 'ON_LEAVE';
ALTER TYPE "AttendanceStatus" ADD VALUE 'WEEKEND';
ALTER TYPE "AttendanceStatus" ADD VALUE 'MISSING';

CREATE TYPE "CorrectionCategory" AS ENUM ('FORGOT_CHECK_IN', 'FORGOT_CHECK_OUT', 'WRONG_TIME', 'SYSTEM_ISSUE', 'OTHER');
CREATE TYPE "DocumentStatus" AS ENUM ('UPLOADED', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'EXPIRED');
CREATE TYPE "HrRequestCategory" AS ENUM ('ATTENDANCE_CORRECTION', 'LEAVE', 'DOCUMENT_UPDATE', 'CERTIFICATE', 'EXPERIENCE_LETTER', 'PROFILE_CHANGE', 'OTHER');
CREATE TYPE "HrRequestStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'WAITING_FOR_USER', 'APPROVED', 'REJECTED', 'RESOLVED', 'CANCELLED');
CREATE TYPE "AnnouncementCategory" AS ENUM ('COMPANY', 'HR', 'HOLIDAY', 'POLICY', 'INTERNSHIP', 'DEADLINE');
CREATE TYPE "AnnouncementStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "AnnouncementAudience" AS ENUM ('EVERYONE', 'DEPARTMENT', 'TEAM', 'INTERNS', 'MANAGERS', 'MENTORS', 'SPECIFIC');
CREATE TYPE "OffboardingItemStatus" AS ENUM ('PENDING', 'DONE', 'SKIPPED');

-- ---------------------------------------------------------------------------
-- Attendance: breaks, lateness, provenance
-- ---------------------------------------------------------------------------
ALTER TABLE "attendance"
  ADD COLUMN "break_minutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "is_late" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "late_minutes" INTEGER,
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'SELF',
  ADD COLUMN "updated_by" UUID;
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "attendance"
  ADD CONSTRAINT "attendance_break_minutes_chk" CHECK ("break_minutes" >= 0),
  ADD CONSTRAINT "attendance_source_chk" CHECK ("source" IN ('SELF', 'CORRECTION', 'HR'));

CREATE TABLE "attendance_breaks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "attendance_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "attendance_breaks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "attendance_breaks_attendance_id_idx" ON "attendance_breaks"("attendance_id");
ALTER TABLE "attendance_breaks" ADD CONSTRAINT "attendance_breaks_attendance_id_fkey" FOREIGN KEY ("attendance_id") REFERENCES "attendance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_breaks"
  ADD CONSTRAINT "attendance_breaks_range_chk" CHECK ("ended_at" IS NULL OR "ended_at" >= "started_at");
-- At most one open break per attendance record.
CREATE UNIQUE INDEX "attendance_breaks_one_open_idx" ON "attendance_breaks"("attendance_id") WHERE "ended_at" IS NULL;

-- Corrections keep the original values and can exist for a day with no record yet.
ALTER TABLE "attendance_corrections"
  ADD COLUMN "organization_id" UUID,
  ADD COLUMN "user_id" UUID,
  ADD COLUMN "date" DATE,
  ADD COLUMN "category" "CorrectionCategory" NOT NULL DEFAULT 'OTHER',
  ADD COLUMN "original_check_in" TIMESTAMPTZ(3),
  ADD COLUMN "original_check_out" TIMESTAMPTZ(3);
UPDATE "attendance_corrections" c
  SET "organization_id" = a."organization_id", "user_id" = c."requested_by", "date" = a."date",
      "original_check_in" = a."check_in_at", "original_check_out" = a."check_out_at"
  FROM "attendance" a WHERE a."id" = c."attendance_id";
ALTER TABLE "attendance_corrections"
  ALTER COLUMN "organization_id" SET NOT NULL,
  ALTER COLUMN "user_id" SET NOT NULL,
  ALTER COLUMN "date" SET NOT NULL,
  ALTER COLUMN "attendance_id" DROP NOT NULL;
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "attendance_corrections_organization_id_status_idx" ON "attendance_corrections"("organization_id", "status");
CREATE INDEX "attendance_corrections_user_id_date_idx" ON "attendance_corrections"("user_id", "date");
ALTER TABLE "attendance_corrections"
  ADD CONSTRAINT "attendance_corrections_reason_chk" CHECK (char_length("reason") BETWEEN 3 AND 1000);

-- ---------------------------------------------------------------------------
-- Leave: quotas, balances, working-day counts, overrides
-- ---------------------------------------------------------------------------
ALTER TABLE "leave_types"
  ADD COLUMN "quota_days" INTEGER,
  ADD COLUMN "requires_attachment" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "leave_types"
  ADD CONSTRAINT "leave_types_quota_chk" CHECK ("quota_days" IS NULL OR "quota_days" BETWEEN 0 AND 366);

ALTER TABLE "leave_requests"
  ADD COLUMN "days" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "created_by" UUID,
  ADD COLUMN "cancelled_at" TIMESTAMPTZ(3),
  ADD COLUMN "cancelled_by" UUID,
  ADD COLUMN "overlap_override" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "override_reason" TEXT;
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "leave_requests_organization_id_start_date_end_date_idx" ON "leave_requests"("organization_id", "start_date", "end_date");
ALTER TABLE "leave_requests"
  ADD CONSTRAINT "leave_requests_days_chk" CHECK ("days" >= 0),
  ADD CONSTRAINT "leave_requests_override_chk" CHECK (NOT "overlap_override" OR "override_reason" IS NOT NULL);

CREATE TABLE "leave_balances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "leave_type_id" UUID NOT NULL,
    "allocated_days" INTEGER NOT NULL,
    "notes" TEXT,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "leave_balances_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "leave_balances_user_id_leave_type_id_key" ON "leave_balances"("user_id", "leave_type_id");
CREATE INDEX "leave_balances_organization_id_idx" ON "leave_balances"("organization_id");
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "leave_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_allocated_chk" CHECK ("allocated_days" BETWEEN 0 AND 366);

-- ---------------------------------------------------------------------------
-- Documents: configurable types, review status, versions, expiry
-- ---------------------------------------------------------------------------
CREATE TABLE "document_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "is_sensitive" BOOLEAN NOT NULL DEFAULT false,
    "has_expiry" BOOLEAN NOT NULL DEFAULT false,
    "legacy_type" "DocumentType" NOT NULL DEFAULT 'OTHER',
    "default_visibility" "DocumentVisibility" NOT NULL DEFAULT 'HR',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_types_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "document_types_organization_id_slug_key" ON "document_types"("organization_id", "slug");
ALTER TABLE "document_types" ADD CONSTRAINT "document_types_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "document_types" ADD CONSTRAINT "document_types_slug_chk" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

ALTER TABLE "internship_documents"
  ADD COLUMN "document_type_id" UUID,
  ADD COLUMN "status" "DocumentStatus" NOT NULL DEFAULT 'UPLOADED',
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "previous_version_id" UUID,
  ADD COLUMN "is_current" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "verified_by" UUID,
  ADD COLUMN "verified_at" TIMESTAMPTZ(3),
  ADD COLUMN "rejection_reason" TEXT,
  ADD COLUMN "expires_at" DATE,
  ADD COLUMN "notes" TEXT;
ALTER TABLE "internship_documents" ADD CONSTRAINT "internship_documents_document_type_id_fkey" FOREIGN KEY ("document_type_id") REFERENCES "document_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "internship_documents" ADD CONSTRAINT "internship_documents_previous_version_id_fkey" FOREIGN KEY ("previous_version_id") REFERENCES "internship_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "internship_documents" ADD CONSTRAINT "internship_documents_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "internship_documents_intern_id_document_type_id_is_current_idx" ON "internship_documents"("intern_id", "document_type_id", "is_current");
CREATE INDEX "internship_documents_organization_id_status_idx" ON "internship_documents"("organization_id", "status");
CREATE INDEX "internship_documents_expires_at_idx" ON "internship_documents"("expires_at");
ALTER TABLE "internship_documents"
  ADD CONSTRAINT "internship_documents_version_chk" CHECK ("version" >= 1),
  ADD CONSTRAINT "internship_documents_rejection_chk" CHECK ("status" <> 'REJECTED' OR "rejection_reason" IS NOT NULL);

-- ---------------------------------------------------------------------------
-- Holidays
-- ---------------------------------------------------------------------------
CREATE TABLE "holidays" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_optional" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "holidays_organization_id_date_key" ON "holidays"("organization_id", "date");
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_name_chk" CHECK (char_length("name") BETWEEN 2 AND 120);

-- ---------------------------------------------------------------------------
-- HR requests
-- ---------------------------------------------------------------------------
CREATE TABLE "hr_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "requester_id" UUID NOT NULL,
    "category" "HrRequestCategory" NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "HrRequestStatus" NOT NULL DEFAULT 'OPEN',
    "assigned_to" UUID,
    "resolution" TEXT,
    "resolved_at" TIMESTAMPTZ(3),
    "resolved_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),
    CONSTRAINT "hr_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "hr_requests_organization_id_status_idx" ON "hr_requests"("organization_id", "status");
CREATE INDEX "hr_requests_requester_id_idx" ON "hr_requests"("requester_id");
CREATE INDEX "hr_requests_assigned_to_idx" ON "hr_requests"("assigned_to");
ALTER TABLE "hr_requests" ADD CONSTRAINT "hr_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hr_requests" ADD CONSTRAINT "hr_requests_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hr_requests" ADD CONSTRAINT "hr_requests_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hr_requests" ADD CONSTRAINT "hr_requests_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hr_requests"
  ADD CONSTRAINT "hr_requests_subject_chk" CHECK (char_length("subject") BETWEEN 3 AND 200),
  ADD CONSTRAINT "hr_requests_description_chk" CHECK (char_length("description") BETWEEN 1 AND 5000);

CREATE TABLE "hr_request_comments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "request_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "hr_request_comments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "hr_request_comments_request_id_created_at_idx" ON "hr_request_comments"("request_id", "created_at");
ALTER TABLE "hr_request_comments" ADD CONSTRAINT "hr_request_comments_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "hr_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hr_request_comments" ADD CONSTRAINT "hr_request_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hr_request_comments" ADD CONSTRAINT "hr_request_comments_body_chk" CHECK (char_length("body") BETWEEN 1 AND 5000);

CREATE TABLE "hr_request_attachments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "request_id" UUID NOT NULL,
    "uploaded_by" UUID,
    "file_name" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),
    CONSTRAINT "hr_request_attachments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "hr_request_attachments_request_id_idx" ON "hr_request_attachments"("request_id");
ALTER TABLE "hr_request_attachments" ADD CONSTRAINT "hr_request_attachments_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "hr_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hr_request_attachments" ADD CONSTRAINT "hr_request_attachments_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hr_request_attachments" ADD CONSTRAINT "hr_request_attachments_size_chk" CHECK ("file_size" > 0);

-- ---------------------------------------------------------------------------
-- Announcements: category, lifecycle, audience
-- ---------------------------------------------------------------------------
ALTER TABLE "announcements"
  ADD COLUMN "category" "AnnouncementCategory" NOT NULL DEFAULT 'COMPANY',
  ADD COLUMN "status" "AnnouncementStatus" NOT NULL DEFAULT 'PUBLISHED',
  ADD COLUMN "audience" "AnnouncementAudience" NOT NULL DEFAULT 'EVERYONE',
  ADD COLUMN "audience_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  ADD COLUMN "archived_at" TIMESTAMPTZ(3),
  ADD COLUMN "notified_at" TIMESTAMPTZ(3),
  ADD COLUMN "created_by" UUID;
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "announcements_organization_id_status_idx" ON "announcements"("organization_id", "status");
-- Existing announcements were published when created; don't re-notify them.
UPDATE "announcements" SET "notified_at" = COALESCE("published_at", "created_at");
ALTER TABLE "announcements"
  ADD CONSTRAINT "announcements_targets_chk" CHECK ("audience" NOT IN ('DEPARTMENT', 'TEAM', 'SPECIFIC') OR cardinality("audience_ids") > 0);

-- ---------------------------------------------------------------------------
-- Offboarding preparation
-- ---------------------------------------------------------------------------
CREATE TABLE "offboarding_checklists" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "intern_id" UUID NOT NULL,
    "internship_id" UUID,
    "started_by" UUID,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),
    "notes" TEXT,
    CONSTRAINT "offboarding_checklists_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "offboarding_checklists_intern_id_key" ON "offboarding_checklists"("intern_id");
CREATE INDEX "offboarding_checklists_organization_id_idx" ON "offboarding_checklists"("organization_id");
ALTER TABLE "offboarding_checklists" ADD CONSTRAINT "offboarding_checklists_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "offboarding_checklists" ADD CONSTRAINT "offboarding_checklists_intern_id_fkey" FOREIGN KEY ("intern_id") REFERENCES "interns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "offboarding_checklists" ADD CONSTRAINT "offboarding_checklists_internship_id_fkey" FOREIGN KEY ("internship_id") REFERENCES "internships"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "offboarding_checklists" ADD CONSTRAINT "offboarding_checklists_started_by_fkey" FOREIGN KEY ("started_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "offboarding_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "checklist_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "owner_role" "OnboardingAssigneeRole" NOT NULL DEFAULT 'HR',
    "assigned_to" UUID,
    "due_date" DATE,
    "status" "OffboardingItemStatus" NOT NULL DEFAULT 'PENDING',
    "completed_by" UUID,
    "completed_at" TIMESTAMPTZ(3),
    "note" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "offboarding_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "offboarding_items_checklist_id_sort_order_idx" ON "offboarding_items"("checklist_id", "sort_order");
ALTER TABLE "offboarding_items" ADD CONSTRAINT "offboarding_items_checklist_id_fkey" FOREIGN KEY ("checklist_id") REFERENCES "offboarding_checklists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "offboarding_items" ADD CONSTRAINT "offboarding_items_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "offboarding_items" ADD CONSTRAINT "offboarding_items_completed_by_fkey" FOREIGN KEY ("completed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Internship compensation (restricted), personal-data additions
-- ---------------------------------------------------------------------------
ALTER TABLE "internships"
  ADD COLUMN "stipend_amount" DECIMAL(12,2),
  ADD COLUMN "stipend_currency" CHAR(3),
  ADD COLUMN "stipend_frequency" TEXT,
  ADD COLUMN "stipend_notes" TEXT;
ALTER TABLE "internships"
  ADD CONSTRAINT "internships_stipend_chk" CHECK ("stipend_amount" IS NULL OR "stipend_amount" >= 0),
  ADD CONSTRAINT "internships_stipend_frequency_chk" CHECK ("stipend_frequency" IS NULL OR "stipend_frequency" IN ('MONTHLY', 'ONE_TIME', 'NONE'));

ALTER TABLE "intern_profiles" ADD COLUMN "preferred_name" TEXT;
ALTER TABLE "emergency_contacts" ADD COLUMN "alternate_phone" TEXT;

-- ---------------------------------------------------------------------------
-- Row-level security for new tables (deny-by-default for the public API)
-- ---------------------------------------------------------------------------
ALTER TABLE "attendance_breaks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_balances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_types" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "holidays" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hr_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hr_request_comments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hr_request_attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "offboarding_checklists" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "offboarding_items" ENABLE ROW LEVEL SECURITY;

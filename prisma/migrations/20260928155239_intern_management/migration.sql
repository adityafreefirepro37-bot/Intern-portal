-- CreateEnum
CREATE TYPE "OnboardingAssigneeRole" AS ENUM ('INTERN', 'MANAGER', 'MENTOR', 'HR');

-- CreateEnum
CREATE TYPE "LifecycleEventType" AS ENUM ('CREATED', 'INVITATION_SENT', 'INVITATION_ACCEPTED', 'ONBOARDING_STARTED', 'ONBOARDING_COMPLETED', 'STATUS_CHANGED', 'MANAGER_ASSIGNED', 'MENTOR_ASSIGNED', 'DETAILS_UPDATED', 'DATES_CHANGED', 'DOCUMENT_UPLOADED', 'DOCUMENT_DELETED');

-- AlterEnum
ALTER TYPE "OnboardingItemStatus" ADD VALUE 'BLOCKED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OnboardingItemType" ADD VALUE 'ACKNOWLEDGEMENT';
ALTER TYPE "OnboardingItemType" ADD VALUE 'FORM';
ALTER TYPE "OnboardingItemType" ADD VALUE 'CHECKLIST';

-- AlterTable
ALTER TABLE "onboarding_items" ADD COLUMN     "assigned_role" "OnboardingAssigneeRole" NOT NULL DEFAULT 'INTERN',
ADD COLUMN     "blocked_reason" TEXT,
ADD COLUMN     "document_id" UUID,
ADD COLUMN     "onboarding_id" UUID,
ADD COLUMN     "policy_id" UUID,
ADD COLUMN     "required_document_type" "DocumentType",
ADD COLUMN     "template_item_id" UUID;

-- CreateTable
CREATE TABLE "onboardings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "internship_id" UUID NOT NULL,
    "template_id" UUID,
    "template_name" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboardings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "department_id" UUID,
    "position_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "onboarding_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_template_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "template_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" "OnboardingItemType" NOT NULL DEFAULT 'TASK',
    "required" BOOLEAN NOT NULL DEFAULT true,
    "due_days_after_start" INTEGER NOT NULL DEFAULT 0,
    "assigned_role" "OnboardingAssigneeRole" NOT NULL DEFAULT 'INTERN',
    "assigned_user_id" UUID,
    "required_document_type" "DocumentType",
    "policy_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboarding_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "body" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_acknowledgements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "policy_id" UUID NOT NULL,
    "policy_version" INTEGER NOT NULL,
    "acknowledged_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "document_acknowledgements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intern_lifecycle_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "intern_id" UUID NOT NULL,
    "event_type" "LifecycleEventType" NOT NULL,
    "description" TEXT NOT NULL,
    "actor_user_id" UUID,
    "metadata" JSONB,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intern_lifecycle_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_counters" (
    "organization_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "code_counters_pkey" PRIMARY KEY ("organization_id","key")
);

-- CreateIndex
CREATE UNIQUE INDEX "onboardings_internship_id_key" ON "onboardings"("internship_id");

-- CreateIndex
CREATE INDEX "onboardings_organization_id_completed_at_idx" ON "onboardings"("organization_id", "completed_at");

-- CreateIndex
CREATE INDEX "onboarding_templates_organization_id_is_active_idx" ON "onboarding_templates"("organization_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_templates_organization_id_name_key" ON "onboarding_templates"("organization_id", "name");

-- CreateIndex
CREATE INDEX "onboarding_template_items_template_id_sort_order_idx" ON "onboarding_template_items"("template_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "policies_organization_id_slug_version_key" ON "policies"("organization_id", "slug", "version");

-- CreateIndex
CREATE INDEX "document_acknowledgements_organization_id_idx" ON "document_acknowledgements"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_acknowledgements_user_id_policy_id_policy_version_key" ON "document_acknowledgements"("user_id", "policy_id", "policy_version");

-- CreateIndex
CREATE UNIQUE INDEX "intern_lifecycle_events_idempotency_key_key" ON "intern_lifecycle_events"("idempotency_key");

-- CreateIndex
CREATE INDEX "intern_lifecycle_events_intern_id_created_at_idx" ON "intern_lifecycle_events"("intern_id", "created_at");

-- CreateIndex
CREATE INDEX "intern_lifecycle_events_organization_id_event_type_idx" ON "intern_lifecycle_events"("organization_id", "event_type");

-- CreateIndex
CREATE INDEX "onboarding_items_onboarding_id_idx" ON "onboarding_items"("onboarding_id");

-- AddForeignKey
ALTER TABLE "onboarding_items" ADD CONSTRAINT "onboarding_items_onboarding_id_fkey" FOREIGN KEY ("onboarding_id") REFERENCES "onboardings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_items" ADD CONSTRAINT "onboarding_items_template_item_id_fkey" FOREIGN KEY ("template_item_id") REFERENCES "onboarding_template_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_items" ADD CONSTRAINT "onboarding_items_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "internship_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_items" ADD CONSTRAINT "onboarding_items_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboardings" ADD CONSTRAINT "onboardings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboardings" ADD CONSTRAINT "onboardings_internship_id_fkey" FOREIGN KEY ("internship_id") REFERENCES "internships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboardings" ADD CONSTRAINT "onboardings_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "onboarding_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboardings" ADD CONSTRAINT "onboardings_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_templates" ADD CONSTRAINT "onboarding_templates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_templates" ADD CONSTRAINT "onboarding_templates_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_templates" ADD CONSTRAINT "onboarding_templates_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_templates" ADD CONSTRAINT "onboarding_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_template_items" ADD CONSTRAINT "onboarding_template_items_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "onboarding_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_template_items" ADD CONSTRAINT "onboarding_template_items_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_template_items" ADD CONSTRAINT "onboarding_template_items_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_acknowledgements" ADD CONSTRAINT "document_acknowledgements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_acknowledgements" ADD CONSTRAINT "document_acknowledgements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_acknowledgements" ADD CONSTRAINT "document_acknowledgements_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intern_lifecycle_events" ADD CONSTRAINT "intern_lifecycle_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intern_lifecycle_events" ADD CONSTRAINT "intern_lifecycle_events_intern_id_fkey" FOREIGN KEY ("intern_id") REFERENCES "interns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intern_lifecycle_events" ADD CONSTRAINT "intern_lifecycle_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_counters" ADD CONSTRAINT "code_counters_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Integrity rules and row-level security for the new tables.
-- ---------------------------------------------------------------------------
ALTER TABLE "onboarding_template_items"
  ADD CONSTRAINT "onboarding_template_items_due_days_chk" CHECK ("due_days_after_start" BETWEEN -365 AND 365);

ALTER TABLE "policies"
  ADD CONSTRAINT "policies_version_chk" CHECK ("version" >= 1),
  ADD CONSTRAINT "policies_slug_format_chk" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

ALTER TABLE "document_acknowledgements"
  ADD CONSTRAINT "document_acknowledgements_version_chk" CHECK ("policy_version" >= 1);

ALTER TABLE "code_counters"
  ADD CONSTRAINT "code_counters_value_chk" CHECK ("value" >= 1);

ALTER TABLE "onboardings"
  ADD CONSTRAINT "onboardings_completed_chk" CHECK ("completed_at" IS NULL OR "completed_at" >= "started_at");

ALTER TABLE "onboardings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "onboarding_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "onboarding_template_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_acknowledgements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "intern_lifecycle_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "code_counters" ENABLE ROW LEVEL SECURITY;

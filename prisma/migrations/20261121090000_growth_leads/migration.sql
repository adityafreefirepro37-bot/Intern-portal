-- Growth: lead sourcing, auto-audit and scoring (industries, searches, leads, suppression list,
-- paid-API usage counters) and a generic background job queue for the scheduled worker.

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('GOOGLE_PLACES', 'OPENSTREETMAP', 'MANUAL');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'REVIEWED', 'READY', 'NOT_A_FIT', 'DO_NOT_CONTACT');

-- CreateEnum
CREATE TYPE "LeadTier" AS ENUM ('HOT', 'WARM', 'SKIP');

-- CreateEnum
CREATE TYPE "LeadResearchStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "BackgroundJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');

-- AlterEnum
ALTER TYPE "AiFeature" ADD VALUE 'LEADS';

-- CreateTable
CREATE TABLE "lead_industries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "search_terms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "osm_tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "checks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "priority" INTEGER NOT NULL DEFAULT 2,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_industries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_searches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "industry_id" UUID NOT NULL,
    "city" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "source" "LeadSource" NOT NULL DEFAULT 'GOOGLE_PLACES',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "page_token" TEXT,
    "pages_fetched" INTEGER NOT NULL DEFAULT 0,
    "exhausted" BOOLEAN NOT NULL DEFAULT false,
    "found" INTEGER NOT NULL DEFAULT 0,
    "added" INTEGER NOT NULL DEFAULT 0,
    "last_run_at" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_searches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "source" "LeadSource" NOT NULL,
    "external_id" TEXT NOT NULL,
    "industry_id" UUID,
    "search_id" UUID,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "address" TEXT,
    "city" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "email" TEXT,
    "maps_url" TEXT,
    "rating" DOUBLE PRECISION,
    "review_count" INTEGER,
    "business_status" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "tier" "LeadTier",
    "need_score" INTEGER,
    "fit_score" INTEGER,
    "score_reasons" JSONB,
    "research_status" "LeadResearchStatus" NOT NULL DEFAULT 'PENDING',
    "research_error" TEXT,
    "researched_at" TIMESTAMPTZ(3),
    "audit" JSONB,
    "summary" JSONB,
    "summary_source" TEXT,
    "checklist" JSONB,
    "notes" TEXT,
    "assigned_to" UUID,
    "audit_token" TEXT,
    "audit_expires_at" TIMESTAMPTZ(3),
    "audit_views" INTEGER NOT NULL DEFAULT 0,
    "audit_first_viewed_at" TIMESTAMPTZ(3),
    "audit_last_viewed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_suppressions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_suppressions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_api_usage" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "api" TEXT NOT NULL,
    "calls" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "lead_api_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "background_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "dedupe_key" TEXT,
    "status" "BackgroundJobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "run_after" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "background_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lead_industries_organization_id_key_key" ON "lead_industries"("organization_id", "key");

-- CreateIndex
CREATE INDEX "lead_searches_organization_id_active_exhausted_last_run_at_idx" ON "lead_searches"("organization_id", "active", "exhausted", "last_run_at");

-- CreateIndex
CREATE UNIQUE INDEX "lead_searches_organization_id_industry_id_city_term_source_key" ON "lead_searches"("organization_id", "industry_id", "city", "term", "source");

-- CreateIndex
CREATE UNIQUE INDEX "leads_audit_token_key" ON "leads"("audit_token");

-- CreateIndex
CREATE INDEX "leads_organization_id_tier_status_idx" ON "leads"("organization_id", "tier", "status");

-- CreateIndex
CREATE INDEX "leads_organization_id_industry_id_idx" ON "leads"("organization_id", "industry_id");

-- CreateIndex
CREATE INDEX "leads_organization_id_research_status_idx" ON "leads"("organization_id", "research_status");

-- CreateIndex
CREATE INDEX "leads_assigned_to_idx" ON "leads"("assigned_to");

-- CreateIndex
CREATE UNIQUE INDEX "leads_organization_id_source_external_id_key" ON "leads"("organization_id", "source", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "lead_suppressions_organization_id_kind_value_key" ON "lead_suppressions"("organization_id", "kind", "value");

-- CreateIndex
CREATE UNIQUE INDEX "lead_api_usage_organization_id_day_api_key" ON "lead_api_usage"("organization_id", "day", "api");

-- CreateIndex
CREATE INDEX "background_jobs_status_run_after_idx" ON "background_jobs"("status", "run_after");

-- CreateIndex
CREATE INDEX "background_jobs_dedupe_key_idx" ON "background_jobs"("dedupe_key");

-- AddForeignKey
ALTER TABLE "lead_industries" ADD CONSTRAINT "lead_industries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_searches" ADD CONSTRAINT "lead_searches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_searches" ADD CONSTRAINT "lead_searches_industry_id_fkey" FOREIGN KEY ("industry_id") REFERENCES "lead_industries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_searches" ADD CONSTRAINT "lead_searches_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_industry_id_fkey" FOREIGN KEY ("industry_id") REFERENCES "lead_industries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_search_id_fkey" FOREIGN KEY ("search_id") REFERENCES "lead_searches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_suppressions" ADD CONSTRAINT "lead_suppressions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_api_usage" ADD CONSTRAINT "lead_api_usage_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- No access through Supabase's public API (the app uses the server role).
ALTER TABLE "lead_industries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead_searches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead_suppressions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead_api_usage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "background_jobs" ENABLE ROW LEVEL SECURITY;

-- At most one open job per dedupe key (not expressible in the Prisma schema).
CREATE UNIQUE INDEX "background_jobs_dedupe_open_key" ON "background_jobs"("dedupe_key") WHERE "dedupe_key" IS NOT NULL AND "status" IN ('QUEUED', 'RUNNING');

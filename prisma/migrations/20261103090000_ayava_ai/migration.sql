-- Phase 07 (Prompt 07): AYAVA AI — conversations with context, message metadata and
-- feedback, usage events, confirm-before-execute action requests, and the knowledge base
-- (versioned, permission-scoped documents; chunks with portable embeddings + full-text search).

-- CreateEnum
CREATE TYPE "AiContextType" AS ENUM ('GLOBAL', 'TASK', 'PROJECT', 'LEARNING', 'HR', 'PERFORMANCE', 'ONBOARDING', 'DOCUMENT');

-- CreateEnum
CREATE TYPE "AiFeedbackRating" AS ENUM ('HELPFUL', 'NOT_HELPFUL');

-- CreateEnum
CREATE TYPE "AiFeature" AS ENUM ('CHAT', 'EMBEDDING', 'INGESTION', 'KNOWLEDGE_SEARCH', 'ACTION');

-- CreateEnum
CREATE TYPE "AiActionStatus" AS ENUM ('PROPOSED', 'CONFIRMED', 'CANCELLED', 'EXECUTED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "KnowledgeCategory" AS ENUM ('HR', 'ONBOARDING', 'POLICIES', 'SOP', 'SECURITY', 'BRAND', 'MARKETING', 'ENGINEERING', 'DESIGN', 'LEARNING', 'PROJECT', 'GENERAL');

-- CreateEnum
CREATE TYPE "KnowledgeSourceType" AS ENUM ('UPLOAD', 'TEXT');

-- CreateEnum
CREATE TYPE "KnowledgeVisibility" AS ENUM ('ORGANIZATION', 'DEPARTMENT', 'TEAM', 'ROLE', 'PROJECT', 'PRIVATE');

-- AlterTable
ALTER TABLE "ai_conversations" ADD COLUMN "archived_at" TIMESTAMPTZ(3),
ADD COLUMN "context_id" UUID;
UPDATE "ai_conversations" SET "context_type" = 'GLOBAL'
  WHERE "context_type" IS NULL
     OR upper("context_type") NOT IN ('GLOBAL', 'TASK', 'PROJECT', 'LEARNING', 'HR', 'PERFORMANCE', 'ONBOARDING', 'DOCUMENT');
ALTER TABLE "ai_conversations"
  ALTER COLUMN "context_type" TYPE "AiContextType" USING upper("context_type")::"AiContextType",
  ALTER COLUMN "context_type" SET DEFAULT 'GLOBAL',
  ALTER COLUMN "context_type" SET NOT NULL;

-- AlterTable
ALTER TABLE "ai_messages" ADD COLUMN     "feedback" "AiFeedbackRating",
ADD COLUMN     "feedback_at" TIMESTAMPTZ(3),
ADD COLUMN     "feedback_reason" TEXT,
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "provider" TEXT,
ADD COLUMN     "tokens_input" INTEGER,
ADD COLUMN     "tokens_output" INTEGER;

-- AlterTable
ALTER TABLE "knowledge_documents" ADD COLUMN     "archived_at" TIMESTAMPTZ(3),
ADD COLUMN     "category" "KnowledgeCategory" NOT NULL DEFAULT 'GENERAL',
ADD COLUMN     "chunk_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "content" TEXT,
ADD COLUMN     "department_id" UUID,
ADD COLUMN     "effective_date" DATE,
ADD COLUMN     "embedding_model" TEXT,
ADD COLUMN     "error_message" TEXT,
ADD COLUMN     "family_id" UUID NOT NULL DEFAULT gen_random_uuid(),
ADD COLUMN     "file_size" INTEGER,
ADD COLUMN     "is_current" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "processed_at" TIMESTAMPTZ(3),
ADD COLUMN     "project_id" UUID,
ADD COLUMN     "role_id" UUID,
ADD COLUMN     "source_type" "KnowledgeSourceType" NOT NULL DEFAULT 'UPLOAD',
ADD COLUMN     "team_id" UUID,
ADD COLUMN     "updated_by" UUID,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "visibility" "KnowledgeVisibility" NOT NULL DEFAULT 'ORGANIZATION',
ALTER COLUMN "file_name" DROP NOT NULL,
ALTER COLUMN "storage_path" DROP NOT NULL,
ALTER COLUMN "mime_type" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ai_usage_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "user_id" UUID,
    "conversation_id" UUID,
    "feature" "AiFeature" NOT NULL,
    "intent" TEXT,
    "context_type" TEXT,
    "role_slug" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "tokens_input" INTEGER NOT NULL DEFAULT 0,
    "tokens_output" INTEGER NOT NULL DEFAULT 0,
    "latency_ms" INTEGER,
    "success" BOOLEAN NOT NULL,
    "error_code" TEXT,
    "tools" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "retrieved_chunks" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_action_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "conversation_id" UUID,
    "message_id" UUID,
    "action_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "AiActionStatus" NOT NULL DEFAULT 'PROPOSED',
    "result" JSONB,
    "error" TEXT,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "confirmed_at" TIMESTAMPTZ(3),
    "executed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_action_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_chunks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "heading" TEXT,
    "page" INTEGER,
    "content" TEXT NOT NULL,
    "token_count" INTEGER NOT NULL,
    "embedding" REAL[] DEFAULT ARRAY[]::REAL[],
    "embedding_model" TEXT,
    "search" tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce("heading", '') || ' ' || "content")) STORED,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_usage_events_organization_id_created_at_idx" ON "ai_usage_events"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_usage_events_user_id_created_at_idx" ON "ai_usage_events"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_action_requests_user_id_status_idx" ON "ai_action_requests"("user_id", "status");

-- CreateIndex
CREATE INDEX "ai_action_requests_organization_id_created_at_idx" ON "ai_action_requests"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "knowledge_chunks_organization_id_idx" ON "knowledge_chunks"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_chunks_document_id_chunk_index_key" ON "knowledge_chunks"("document_id", "chunk_index");

-- CreateIndex
CREATE INDEX "knowledge_documents_organization_id_is_current_status_idx" ON "knowledge_documents"("organization_id", "is_current", "status");

-- CreateIndex
CREATE INDEX "knowledge_documents_family_id_version_idx" ON "knowledge_documents"("family_id", "version");

-- AddForeignKey
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_action_requests" ADD CONSTRAINT "ai_action_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_action_requests" ADD CONSTRAINT "ai_action_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_action_requests" ADD CONSTRAINT "ai_action_requests_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_action_requests" ADD CONSTRAINT "ai_action_requests_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "ai_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Retrieval support
-- ---------------------------------------------------------------------------
CREATE INDEX "knowledge_chunks_search_idx" ON "knowledge_chunks" USING GIN ("search");
CREATE INDEX "knowledge_chunks_document_id_idx" ON "knowledge_chunks"("document_id");

-- Cosine similarity over real[] embeddings, so semantic search works on any
-- PostgreSQL (the local development database has no pgvector). Returns NULL for
-- missing or mismatched vectors. Candidates are permission-filtered before scoring.
CREATE OR REPLACE FUNCTION ayava_cosine_similarity(a REAL[], b REAL[])
RETURNS DOUBLE PRECISION
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN a IS NULL OR b IS NULL OR cardinality(a) = 0 OR cardinality(a) <> cardinality(b) THEN NULL
    ELSE (
      SELECT sum(x::double precision * y) / NULLIF(sqrt(sum(x::double precision * x)) * sqrt(sum(y::double precision * y)), 0)
      FROM unnest(a, b) AS t(x, y)
    )
  END
$$;

-- ---------------------------------------------------------------------------
-- Integrity
-- ---------------------------------------------------------------------------
ALTER TABLE "knowledge_documents"
  ADD CONSTRAINT "knowledge_documents_version_chk" CHECK ("version" >= 1),
  ADD CONSTRAINT "knowledge_documents_upload_chk" CHECK ("source_type" <> 'UPLOAD' OR "storage_path" IS NOT NULL),
  ADD CONSTRAINT "knowledge_documents_text_chk" CHECK ("source_type" <> 'TEXT' OR "content" IS NOT NULL);
ALTER TABLE "ai_usage_events"
  ADD CONSTRAINT "ai_usage_events_tokens_chk" CHECK ("tokens_input" >= 0 AND "tokens_output" >= 0);

-- ---------------------------------------------------------------------------
-- Row-level security: no access through Supabase's public API (the app uses the server role).
-- ---------------------------------------------------------------------------
ALTER TABLE "ai_usage_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_action_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "knowledge_chunks" ENABLE ROW LEVEL SECURITY;

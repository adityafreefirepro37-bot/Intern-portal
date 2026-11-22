-- CreateEnum
CREATE TYPE "LeadRoute" AS ENUM ('AUTO', 'TEAM');

-- CreateEnum
CREATE TYPE "OutreachStatus" AS ENUM ('NONE', 'AWAITING_APPROVAL', 'ACTIVE', 'REPLIED', 'BOUNCED', 'UNSUBSCRIBED', 'COMPLETED', 'STOPPED');

-- CreateEnum
CREATE TYPE "OutreachMessageStatus" AS ENUM ('AWAITING_APPROVAL', 'SCHEDULED', 'SENDING', 'SENT', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "outreach_replied_at" TIMESTAMPTZ(3),
ADD COLUMN     "outreach_started_at" TIMESTAMPTZ(3),
ADD COLUMN     "outreach_status" "OutreachStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "route" "LeadRoute",
ADD COLUMN     "route_reasons" JSONB;

-- CreateTable
CREATE TABLE "lead_serps" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "query" TEXT NOT NULL,
    "domains" JSONB NOT NULL,
    "checked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_serps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outreach_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "step" INTEGER NOT NULL,
    "status" "OutreachMessageStatus" NOT NULL,
    "to_email" TEXT NOT NULL,
    "mailbox" TEXT,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "scheduled_for" TIMESTAMPTZ(3) NOT NULL,
    "sent_at" TIMESTAMPTZ(3),
    "message_id" TEXT,
    "error" TEXT,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outreach_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outreach_mailboxes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "warmup_started_at" TIMESTAMPTZ(3),
    "last_sent_at" TIMESTAMPTZ(3),
    "last_inbox_check_at" TIMESTAMPTZ(3),
    "last_inbox_uid" INTEGER,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outreach_mailboxes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lead_serps_organization_id_query_key" ON "lead_serps"("organization_id", "query");

-- CreateIndex
CREATE UNIQUE INDEX "outreach_messages_message_id_key" ON "outreach_messages"("message_id");

-- CreateIndex
CREATE INDEX "outreach_messages_organization_id_status_scheduled_for_idx" ON "outreach_messages"("organization_id", "status", "scheduled_for");

-- CreateIndex
CREATE INDEX "outreach_messages_mailbox_sent_at_idx" ON "outreach_messages"("mailbox", "sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "outreach_messages_lead_id_step_key" ON "outreach_messages"("lead_id", "step");

-- CreateIndex
CREATE UNIQUE INDEX "outreach_mailboxes_organization_id_email_key" ON "outreach_mailboxes"("organization_id", "email");

-- CreateIndex
CREATE INDEX "leads_organization_id_outreach_status_idx" ON "leads"("organization_id", "outreach_status");

-- AddForeignKey
ALTER TABLE "lead_serps" ADD CONSTRAINT "lead_serps_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_messages" ADD CONSTRAINT "outreach_messages_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_mailboxes" ADD CONSTRAINT "outreach_mailboxes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-level security: the app connects as the owner; nothing is exposed through Supabase's public API.
ALTER TABLE "lead_serps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outreach_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outreach_mailboxes" ENABLE ROW LEVEL SECURITY;

-- Phase 09 (Prompt 09, part 1): Certificates — frozen certificate text (recipient,
-- programme, period, signatory, organization), course certificates, who created /
-- issued / revoked and why. PDFs are rendered on demand from these columns.

-- AlterTable
ALTER TABLE "certificates" ADD COLUMN     "citation" TEXT,
ADD COLUMN     "course_id" UUID,
ADD COLUMN     "created_by" UUID,
ADD COLUMN     "department_name" TEXT,
ADD COLUMN     "issued_by" UUID,
ADD COLUMN     "organization_name" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "period_end" DATE,
ADD COLUMN     "period_start" DATE,
ADD COLUMN     "program_title" TEXT,
ADD COLUMN     "recipient_name" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "revoke_reason" TEXT,
ADD COLUMN     "revoked_at" TIMESTAMPTZ(3),
ADD COLUMN     "revoked_by" UUID,
ADD COLUMN     "signatory_name" TEXT,
ADD COLUMN     "signatory_title" TEXT;

-- CreateIndex
CREATE INDEX "certificates_course_id_idx" ON "certificates"("course_id");

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_issued_by_fkey" FOREIGN KEY ("issued_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing rows: freeze the recipient and organization names from the live records.
UPDATE "certificates" c
SET "recipient_name" = trim(coalesce(u."display_name", u."first_name" || ' ' || u."last_name")),
    "organization_name" = o."name"
FROM "interns" i
JOIN "users" u ON u."id" = i."user_id"
JOIN "organizations" o ON o."id" = i."organization_id"
WHERE i."id" = c."intern_id" AND c."recipient_name" = '';

-- One live certificate per intern and course (a revoked one can be replaced).
CREATE UNIQUE INDEX "certificates_course_live_key" ON "certificates" ("intern_id", "course_id")
  WHERE "course_id" IS NOT NULL AND "status" <> 'REVOKED';

-- Verification codes are unguessable and public: no public API access to these tables.
ALTER TABLE "certificates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "certificate_verifications" ENABLE ROW LEVEL SECURITY;

import 'server-only'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/client'

/** Metadata only — file bytes live in the storage service, never in the database. */
const documentSelect = {
  id: true,
  organization_id: true,
  intern_id: true,
  document_type: true,
  file_name: true,
  mime_type: true,
  file_size: true,
  visibility: true,
  uploaded_by: true,
  created_at: true,
  document_type_id: true,
  status: true,
  version: true,
  is_current: true,
  previous_version_id: true,
  expires_at: true,
  rejection_reason: true,
  verified_at: true,
  notes: true,
  uploader: { select: { first_name: true, last_name: true, display_name: true } },
  verifier: { select: { first_name: true, last_name: true, display_name: true } },
  type: { select: { id: true, name: true, is_sensitive: true, is_required: true, has_expiry: true } },
} as const

export { documentSelect }

export const documentRepository = {
  create(data: Prisma.InternshipDocumentUncheckedCreateInput) {
    return prisma.internshipDocument.create({ data, select: documentSelect })
  },

  listForIntern(internId: string) {
    return prisma.internshipDocument.findMany({
      where: { intern_id: internId, deleted_at: null },
      orderBy: [{ is_current: 'desc' }, { created_at: 'desc' }],
      select: documentSelect,
    })
  },

  /** Includes the storage path — for the download route only; never returned to the browser. */
  findWithStorage(organizationId: string, id: string) {
    return prisma.internshipDocument.findFirst({
      where: { id, organization_id: organizationId, deleted_at: null },
      select: { ...documentSelect, storage_path: true },
    })
  },

  softDelete(id: string) {
    return prisma.internshipDocument.update({ where: { id }, data: { deleted_at: new Date() }, select: { id: true } })
  },
}

export type DocumentRecord = Awaited<ReturnType<typeof documentRepository.listForIntern>>[number]

export const policyRepository = {
  findActive(organizationId: string, id: string) {
    return prisma.policy.findFirst({
      where: { id, organization_id: organizationId, is_active: true },
      select: { id: true, title: true, version: true, body: true, slug: true },
    })
  },

  listActive(organizationId: string) {
    return prisma.policy.findMany({
      where: { organization_id: organizationId, is_active: true },
      orderBy: { title: 'asc' },
      select: { id: true, title: true, version: true, slug: true },
    })
  },

  findAcknowledgement(userId: string, policyId: string, version: number) {
    return prisma.documentAcknowledgement.findUnique({
      where: { user_id_policy_id_policy_version: { user_id: userId, policy_id: policyId, policy_version: version } },
      select: { id: true, acknowledged_at: true },
    })
  },
}

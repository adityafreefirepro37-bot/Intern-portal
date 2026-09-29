import type { DocumentType, DocumentVisibility } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import type { RequestMeta } from '@/lib/http/request-meta'
import { getStorageService } from '@/lib/storage'
import { parseInput } from '@/lib/validation'
import type { RequestContext } from '../context'
import { domainEvents } from '../events/domain-events'
import { documentRepository, type DocumentRecord } from '../repositories/document.repository'
import { lifecycleRepository } from '../repositories/lifecycle.repository'
import { AUDIT_ACTIONS } from './audit-actions'
import { auditService } from './audit.service'
import { resolveInternAccess, type InternAccess } from './intern-access'
import { afterItemChange, onboardingService } from './onboarding.service'

export const DOCUMENT_TYPES: readonly DocumentType[] = [
  'RESUME',
  'OFFER_LETTER',
  'NDA',
  'ID_DOCUMENT',
  'CERTIFICATE',
  'EXPERIENCE_LETTER',
  'OTHER',
]
export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  RESUME: 'Résumé / CV',
  OFFER_LETTER: 'Offer letter',
  NDA: 'NDA',
  ID_DOCUMENT: 'ID document',
  CERTIFICATE: 'Certificate',
  EXPERIENCE_LETTER: 'Experience letter',
  OTHER: 'Other',
}
export const VISIBILITY_LABELS: Record<DocumentVisibility, string> = {
  INTERN: 'Intern, manager & HR',
  MANAGER: 'Manager & HR',
  HR: 'HR only',
  ADMIN: 'Admins only',
}

/**
 * Which visibility levels this viewer may see for this intern:
 *  - the intern: INTERN
 *  - managers/leads with scoped document access: INTERN, MANAGER
 *  - organization-wide (HR/Admin): + HR, and ADMIN only with document.restricted
 * Uploaders always see documents they uploaded. Mentors have no document access.
 */
export function visibleLevels(ctx: RequestContext, access: InternAccess): DocumentVisibility[] {
  if (!access.can.viewDocuments) return []
  if (access.isSelf) return ['INTERN']
  const orgWide = ctx.actor.permissions.get('document.read') === 'ORGANIZATION'
  if (!orgWide) return ['INTERN', 'MANAGER']
  return ctx.actor.permissions.has('document.restricted')
    ? ['INTERN', 'MANAGER', 'HR', 'ADMIN']
    : ['INTERN', 'MANAGER', 'HR']
}

function canSee(
  ctx: RequestContext,
  levels: DocumentVisibility[],
  doc: Pick<DocumentRecord, 'visibility' | 'uploaded_by'>,
) {
  return doc.uploaded_by === ctx.actor.userId || levels.includes(doc.visibility)
}

/** Server-side default for interns' own uploads (they can't choose visibility). */
function defaultVisibility(type: DocumentType): DocumentVisibility {
  return type === 'ID_DOCUMENT' ? 'HR' : 'INTERN'
}

const uploadSchema = z.strictObject({
  internId: z.uuid(),
  documentType: z.enum(DOCUMENT_TYPES as [DocumentType, ...DocumentType[]]),
  visibility: z
    .string()
    .optional()
    .transform((value) => value || undefined)
    .pipe(z.enum(['INTERN', 'MANAGER', 'HR', 'ADMIN']).optional()),
  onboardingItemId: z
    .string()
    .optional()
    .transform((value) => value || undefined)
    .pipe(z.uuid().optional()),
})

export interface UploadFile {
  name: string
  type: string
  bytes: Uint8Array
}

export const documentService = {
  async listForIntern(ctx: RequestContext, internId: string) {
    const access = await resolveInternAccess(ctx, parseInput(z.uuid(), internId))
    const levels = visibleLevels(ctx, access)
    if (levels.length === 0) throw new ForbiddenError()
    const documents = await documentRepository.listForIntern(access.record.id)
    return {
      documents: documents
        .filter((doc) => canSee(ctx, levels, doc))
        .map((doc) => ({ ...doc, canDelete: access.can.deleteDocuments })),
      canUpload: access.can.uploadDocuments,
      /** Levels the viewer may assign when uploading (empty for interns: server default). */
      assignable: access.isSelf ? [] : levels,
    }
  },

  /**
   * Validates (type, size, magic bytes), stores privately under a
   * server-generated key and records metadata. Optionally completes a
   * DOCUMENT onboarding item; if that fails the upload is rolled back.
   */
  async upload(ctx: RequestContext, input: unknown, file: UploadFile, meta: RequestMeta) {
    const data = parseInput(uploadSchema, input)
    const access = await resolveInternAccess(ctx, data.internId)
    if (!access.can.uploadDocuments) throw new ForbiddenError('You can’t upload documents for this intern')
    if (!file.bytes.byteLength) throw new ValidationError('Choose a file to upload', { file: 'Required' })

    let visibility: DocumentVisibility
    if (access.isSelf) {
      visibility = defaultVisibility(data.documentType)
    } else {
      const allowed = visibleLevels(ctx, access)
      visibility = data.visibility ?? (allowed.includes('HR') ? 'HR' : 'MANAGER')
      if (!allowed.includes(visibility)) throw new ForbiddenError('You can’t use that visibility level')
    }

    const storage = getStorageService()
    const stored = await storage.upload({
      organizationId: ctx.organization.id,
      category: 'document',
      fileName: file.name,
      mimeType: file.type,
      data: file.bytes,
    })
    const internship = access.record.internships[0]
    let document: DocumentRecord
    try {
      document = await documentRepository.create({
        organization_id: ctx.organization.id,
        intern_id: access.record.id,
        internship_id: internship?.id ?? null,
        document_type: data.documentType,
        file_name: stored.fileName,
        storage_path: stored.storagePath,
        mime_type: stored.mimeType,
        file_size: stored.fileSize,
        uploaded_by: ctx.actor.userId,
        visibility,
      })
    } catch (error) {
      await storage.delete(stored.storagePath).catch(() => undefined)
      throw error
    }

    if (data.onboardingItemId) {
      try {
        await onboardingService.attachDocument(ctx, data.onboardingItemId, document.id, data.documentType)
      } catch (error) {
        await documentRepository.softDelete(document.id)
        await storage.delete(stored.storagePath).catch(() => undefined)
        throw error
      }
    }

    await lifecycleRepository.record(prisma, {
      organizationId: ctx.organization.id,
      internId: access.record.id,
      type: 'DOCUMENT_UPLOADED',
      description: `${DOCUMENT_TYPE_LABELS[data.documentType]} uploaded`,
      actorUserId: ctx.actor.userId,
      metadata: { documentId: document.id },
    })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.DOCUMENT_UPLOADED,
      resourceType: 'document',
      resourceId: document.id,
      metadata: { internId: access.record.id, type: data.documentType, visibility, size: stored.fileSize },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    })
    await domainEvents.emit('document.uploaded', {
      organizationId: ctx.organization.id,
      actorUserId: ctx.actor.userId,
      payload: { internId: access.record.id, documentId: document.id, documentType: data.documentType },
    })
    return { id: document.id }
  },

  /** Authorizes and returns the bytes for the download route. Hidden documents are 404. */
  async download(ctx: RequestContext, documentId: string) {
    const id = parseInput(z.uuid(), documentId)
    const doc = await documentRepository.findWithStorage(ctx.organization.id, id)
    if (!doc) throw new NotFoundError('Document')
    let access: InternAccess
    try {
      access = await resolveInternAccess(ctx, doc.intern_id)
    } catch {
      throw new NotFoundError('Document')
    }
    if (!canSee(ctx, visibleLevels(ctx, access), doc)) throw new NotFoundError('Document')
    const bytes = await getStorageService().download(doc.storage_path)
    return { bytes, fileName: doc.file_name, mimeType: doc.mime_type }
  },

  /** Soft delete (file kept for recovery). Reopens an onboarding item that depended on it. */
  async remove(ctx: RequestContext, documentId: string, meta: RequestMeta) {
    const id = parseInput(z.uuid(), documentId)
    const doc = await documentRepository.findWithStorage(ctx.organization.id, id)
    if (!doc) throw new NotFoundError('Document')
    const access = await resolveInternAccess(ctx, doc.intern_id).catch(() => {
      throw new NotFoundError('Document')
    })
    if (!canSee(ctx, visibleLevels(ctx, access), doc)) throw new NotFoundError('Document')
    if (!access.can.deleteDocuments) throw new ForbiddenError('You can’t delete documents')

    const linked = await prisma.onboardingItem.findMany({
      where: { document_id: doc.id },
      select: { id: true, onboarding_id: true },
    })
    await prisma.$transaction([
      prisma.internshipDocument.update({ where: { id: doc.id }, data: { deleted_at: new Date() } }),
      prisma.onboardingItem.updateMany({
        where: { document_id: doc.id },
        data: { document_id: null, status: 'PENDING', completed_at: null, completed_by: null },
      }),
    ])
    for (const onboardingId of new Set(linked.map((item) => item.onboarding_id))) {
      await afterItemChange(ctx, onboardingId, doc.intern_id)
    }
    await lifecycleRepository.record(prisma, {
      organizationId: ctx.organization.id,
      internId: doc.intern_id,
      type: 'DOCUMENT_DELETED',
      description: `${DOCUMENT_TYPE_LABELS[doc.document_type]} deleted`,
      actorUserId: ctx.actor.userId,
      metadata: { documentId: doc.id },
    })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.DOCUMENT_DELETED,
      resourceType: 'document',
      resourceId: doc.id,
      metadata: { internId: doc.intern_id, type: doc.document_type, reopenedItems: linked.length },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    })
    await domainEvents.emit('document.deleted', {
      organizationId: ctx.organization.id,
      actorUserId: ctx.actor.userId,
      payload: { internId: doc.intern_id, documentId: doc.id },
    })
  },
}

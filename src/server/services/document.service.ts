import type { DocumentStatus, DocumentType, DocumentVisibility, Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import {
  canDecide,
  decisionTarget,
  documentCompletion,
  effectiveDocumentStatus,
  isExpiringSoon,
  type DocumentCompletion,
  type DocumentDecision,
  type RequirementStatus,
} from '@/lib/hr/documents'
import { toCsv } from '@/lib/hr/operations'
import { dayKey } from '@/lib/hr/time'
import type { RequestMeta } from '@/lib/http/request-meta'
import { addDays, parseDateOnly, todayIn } from '@/lib/interns/dates'
import { getStorageService } from '@/lib/storage'
import { fullName } from '@/lib/utils/format'
import { isoDateSchema, parseInput } from '@/lib/validation'
import type { RequestContext } from '../context'
import { domainEvents } from '../events/domain-events'
import { documentRepository, documentSelect, type DocumentRecord } from '../repositories/document.repository'
import { lifecycleRepository } from '../repositories/lifecycle.repository'
import { internScope } from '../repositories/scope'
import { AUDIT_ACTIONS } from './audit-actions'
import { auditService } from './audit.service'
import { authorizationService } from './authorization.service'
import { optionalText, optionalUuid, personSelect, TRACKED_STATUSES } from './hr-shared'
import { resolveInternAccess, scopeCovers, type InternAccess } from './intern-access'
import { afterItemChange, onboardingService } from './onboarding.service'
import { skipTake, toPage } from './pagination'
import { settingsService } from './settings.service'

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

/**
 * Visibility level, plus sensitive types (e.g. ID proof): only the intern, the
 * uploader and holders of document.sensitive see those — whatever the level.
 */
function canSee(
  ctx: RequestContext,
  levels: DocumentVisibility[],
  doc: Pick<DocumentRecord, 'visibility' | 'uploaded_by'> & { type: { is_sensitive: boolean } | null },
  isSelf: boolean,
) {
  if (doc.uploaded_by === ctx.actor.userId) return true
  if (doc.type?.is_sensitive && !isSelf && !ctx.actor.permissions.has('document.sensitive')) return false
  return levels.includes(doc.visibility)
}

/** Server-side default for interns' own uploads (they can't choose visibility). */
function defaultVisibility(type: DocumentType): DocumentVisibility {
  return type === 'ID_DOCUMENT' ? 'HR' : 'INTERN'
}

const uploadSchema = z
  .strictObject({
    internId: z.uuid(),
    documentTypeId: optionalUuid,
    documentType: z
      .string()
      .optional()
      .transform((value) => value || undefined)
      .pipe(z.enum(DOCUMENT_TYPES as [DocumentType, ...DocumentType[]]).optional()),
    visibility: z
      .string()
      .optional()
      .transform((value) => value || undefined)
      .pipe(z.enum(['INTERN', 'MANAGER', 'HR', 'ADMIN']).optional()),
    expiresAt: z
      .string()
      .optional()
      .transform((value) => value || undefined)
      .pipe(isoDateSchema.optional()),
    notes: optionalText(500),
    onboardingItemId: optionalUuid,
  })
  .refine((value) => value.documentTypeId || value.documentType, {
    message: 'Choose a document type',
    path: ['documentTypeId'],
  })

const reviewSchema = z
  .strictObject({
    documentId: z.uuid(),
    decision: z.enum(['START_REVIEW', 'VERIFY', 'REJECT', 'REQUEST_REPLACEMENT']),
    reason: optionalText(1000),
  })
  .refine((value) => !['REJECT', 'REQUEST_REPLACEMENT'].includes(value.decision) || value.reason, {
    message: 'Give a reason so the intern knows what to fix',
    path: ['reason'],
  })

const typeSchema = z.strictObject({
  documentTypeId: optionalUuid,
  name: z.string().trim().min(2, 'Enter a name').max(80),
  description: optionalText(300),
  legacyType: z.enum(DOCUMENT_TYPES as [DocumentType, ...DocumentType[]]).default('OTHER'),
  defaultVisibility: z.enum(['INTERN', 'MANAGER', 'HR', 'ADMIN']).default('HR'),
  isRequired: z.preprocess((value) => value === 'on' || value === 'true' || value === true, z.boolean()),
  isSensitive: z.preprocess((value) => value === 'on' || value === 'true' || value === true, z.boolean()),
  hasExpiry: z.preprocess((value) => value === 'on' || value === 'true' || value === true, z.boolean()),
  isActive: z.preprocess((value) => value === 'on' || value === 'true' || value === true, z.boolean()),
})

export const documentQuerySchema = z.object({
  q: z.string().trim().max(100).optional().catch(undefined),
  status: z
    .enum(['UPLOADED', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'EXPIRED', 'PENDING'])
    .optional()
    .catch(undefined),
  type: z.uuid().optional().catch(undefined),
  expiring: z.enum(['1']).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).default(1).catch(1),
})

export interface UploadFile {
  name: string
  type: string
  bytes: Uint8Array
}

function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
}

function activeTypes(organizationId: string) {
  return prisma.hrDocumentType.findMany({
    where: { organization_id: organizationId, is_active: true },
    orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      is_required: true,
      is_sensitive: true,
      has_expiry: true,
      legacy_type: true,
      default_visibility: true,
    },
  })
}

/** Completion per intern against the organization's required document types (current versions only). */
export async function completionByIntern(
  organizationId: string,
  internIds: readonly string[],
  today: Date,
): Promise<Map<string, DocumentCompletion>> {
  const result = new Map<string, DocumentCompletion>()
  if (internIds.length === 0) return result
  const [required, docs] = await Promise.all([
    prisma.hrDocumentType.findMany({
      where: { organization_id: organizationId, is_active: true, is_required: true },
      select: { id: true },
    }),
    prisma.internshipDocument.findMany({
      where: {
        organization_id: organizationId,
        intern_id: { in: [...internIds] },
        is_current: true,
        deleted_at: null,
        document_type_id: { not: null },
      },
      select: { intern_id: true, document_type_id: true, status: true, expires_at: true },
    }),
  ])
  const requiredIds = required.map((t) => t.id)
  const byIntern = new Map<string, Map<string, DocumentStatus>>()
  for (const doc of docs) {
    const map = byIntern.get(doc.intern_id) ?? new Map()
    map.set(doc.document_type_id!, effectiveDocumentStatus(doc.status, doc.expires_at, today))
    byIntern.set(doc.intern_id, map)
  }
  for (const id of internIds) result.set(id, documentCompletion(requiredIds, byIntern.get(id) ?? new Map()))
  return result
}

export const documentService = {
  activeTypes(ctx: RequestContext) {
    return activeTypes(ctx.organization.id)
  },

  async allTypes(ctx: RequestContext) {
    authorizationService.require(ctx, 'document.manage')
    return prisma.hrDocumentType.findMany({
      where: { organization_id: ctx.organization.id },
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        description: true,
        is_required: true,
        is_sensitive: true,
        has_expiry: true,
        is_active: true,
        legacy_type: true,
        default_visibility: true,
        _count: { select: { documents: { where: { deleted_at: null } } } },
      },
    })
  },

  async saveType(ctx: RequestContext, input: unknown) {
    authorizationService.require(ctx, 'document.manage')
    const data = parseInput(typeSchema, input)
    const org = ctx.organization.id
    const values = {
      name: data.name,
      description: data.description ?? null,
      legacy_type: data.legacyType,
      default_visibility: data.defaultVisibility,
      is_required: data.isRequired,
      is_sensitive: data.isSensitive,
      has_expiry: data.hasExpiry,
      is_active: data.isActive,
    }
    let before: unknown = null
    let id: string
    if (data.documentTypeId) {
      const existing = await prisma.hrDocumentType.findFirst({
        where: { id: data.documentTypeId, organization_id: org },
        select: { id: true, name: true, is_required: true, is_sensitive: true, has_expiry: true, is_active: true },
      })
      if (!existing) throw new NotFoundError('Document type')
      before = existing
      id = (await prisma.hrDocumentType.update({ where: { id: existing.id }, data: values, select: { id: true } })).id
    } else {
      const slug = slugify(data.name)
      if (!slug) throw new ValidationError('Use letters or numbers in the name', { name: 'Invalid' })
      if (await prisma.hrDocumentType.count({ where: { organization_id: org, slug } })) {
        throw new ConflictError('A document type with that name already exists')
      }
      const last = await prisma.hrDocumentType.aggregate({
        where: { organization_id: org },
        _max: { sort_order: true },
      })
      id = (
        await prisma.hrDocumentType.create({
          data: { ...values, organization_id: org, slug, sort_order: (last._max.sort_order ?? 0) + 1 },
          select: { id: true },
        })
      ).id
    }
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.DOCUMENT_TYPE_SAVED,
      resourceType: 'document_type',
      resourceId: id,
      metadata: { before, after: values },
    })
  },

  /**
   * One intern's documents: requirement checklist (required types with the
   * status of their current version, REQUIRED when missing), current
   * documents, earlier versions and completion — filtered by what the viewer may see.
   */
  async listForIntern(ctx: RequestContext, internId: string) {
    const access = await resolveInternAccess(ctx, parseInput(z.uuid(), internId))
    const levels = visibleLevels(ctx, access)
    if (levels.length === 0) throw new ForbiddenError()
    const today = todayIn(ctx.organization.timezone)
    const [documents, types] = await Promise.all([
      documentRepository.listForIntern(access.record.id),
      activeTypes(ctx.organization.id),
    ])
    const canVerify = !access.isSelf && scopeCovers(ctx, 'document.verify', access.record)
    const visible = documents
      .filter((doc) => canSee(ctx, levels, doc, access.isSelf))
      .map((doc) => ({
        ...doc,
        status: effectiveDocumentStatus(doc.status, doc.expires_at, today),
        typeName: doc.type?.name ?? DOCUMENT_TYPE_LABELS[doc.document_type],
        canDelete: access.can.deleteDocuments,
        canVerify,
      }))
    const current = visible.filter((doc) => doc.is_current)
    const currentByType = new Map(current.filter((d) => d.document_type_id).map((d) => [d.document_type_id!, d]))
    const requirements = types
      .filter((type) => type.is_required)
      .map((type) => {
        const doc = currentByType.get(type.id) ?? null
        return { type, document: doc, status: (doc?.status ?? 'REQUIRED') as RequirementStatus }
      })
    const completion = (await completionByIntern(ctx.organization.id, [access.record.id], today)).get(access.record.id)!
    return {
      requirements,
      documents: current,
      history: visible.filter((doc) => !doc.is_current),
      completion,
      canUpload: access.can.uploadDocuments,
      canVerify,
      types,
      /** Levels the viewer may assign when uploading (empty for interns: server default). */
      assignable: access.isSelf ? [] : levels,
    }
  },

  /**
   * Validates (type, size, magic bytes), stores privately under a
   * server-generated key and records metadata. Uploading a type that already
   * has a document creates a new version — earlier versions are kept, never
   * overwritten. Optionally completes a DOCUMENT onboarding item.
   */
  async upload(ctx: RequestContext, input: unknown, file: UploadFile, meta: RequestMeta) {
    const data = parseInput(uploadSchema, input)
    const access = await resolveInternAccess(ctx, data.internId)
    if (!access.can.uploadDocuments) throw new ForbiddenError('You can’t upload documents for this intern')
    if (!file.bytes.byteLength) throw new ValidationError('Choose a file to upload', { file: 'Required' })

    const types = await activeTypes(ctx.organization.id)
    const type = data.documentTypeId
      ? types.find((t) => t.id === data.documentTypeId)
      : types.find((t) => t.legacy_type === data.documentType)
    if (data.documentTypeId && !type)
      throw new ValidationError('Choose a document type', { documentTypeId: 'Unknown type' })
    const legacyType: DocumentType = type?.legacy_type ?? data.documentType ?? 'OTHER'
    if (data.expiresAt && !type?.has_expiry) {
      throw new ValidationError('This document type has no expiry date', { expiresAt: 'Not used for this type' })
    }

    let visibility: DocumentVisibility
    if (access.isSelf) {
      visibility = type?.default_visibility ?? defaultVisibility(legacyType)
    } else {
      const allowed = visibleLevels(ctx, access)
      visibility = data.visibility ?? type?.default_visibility ?? (allowed.includes('HR') ? 'HR' : 'MANAGER')
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
    let document: { id: string; version: number }
    try {
      document = await prisma.$transaction(async (tx) => {
        const previous = type
          ? await tx.internshipDocument.findFirst({
              where: { intern_id: access.record.id, document_type_id: type.id, is_current: true, deleted_at: null },
              orderBy: { version: 'desc' },
              select: { id: true, version: true },
            })
          : null
        if (previous) {
          await tx.internshipDocument.update({ where: { id: previous.id }, data: { is_current: false } })
        }
        return tx.internshipDocument.create({
          data: {
            organization_id: ctx.organization.id,
            intern_id: access.record.id,
            internship_id: internship?.id ?? null,
            document_type: legacyType,
            document_type_id: type?.id ?? null,
            file_name: stored.fileName,
            storage_path: stored.storagePath,
            mime_type: stored.mimeType,
            file_size: stored.fileSize,
            uploaded_by: ctx.actor.userId,
            visibility,
            status: 'UPLOADED',
            version: (previous?.version ?? 0) + 1,
            previous_version_id: previous?.id ?? null,
            expires_at: data.expiresAt ? parseDateOnly(data.expiresAt) : null,
            notes: data.notes ?? null,
          },
          select: { id: true, version: true },
        })
      })
    } catch (error) {
      await storage.delete(stored.storagePath).catch(() => undefined)
      throw error
    }

    if (data.onboardingItemId) {
      try {
        await onboardingService.attachDocument(ctx, data.onboardingItemId, document.id, legacyType)
      } catch (error) {
        await documentRepository.softDelete(document.id)
        await storage.delete(stored.storagePath).catch(() => undefined)
        throw error
      }
    }

    const label = type?.name ?? DOCUMENT_TYPE_LABELS[legacyType]
    await lifecycleRepository.record(prisma, {
      organizationId: ctx.organization.id,
      internId: access.record.id,
      type: 'DOCUMENT_UPLOADED',
      description: document.version > 1 ? `${label} uploaded (version ${document.version})` : `${label} uploaded`,
      actorUserId: ctx.actor.userId,
      metadata: { documentId: document.id },
    })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.DOCUMENT_UPLOADED,
      resourceType: 'document',
      resourceId: document.id,
      metadata: {
        internId: access.record.id,
        type: label,
        version: document.version,
        visibility,
        size: stored.fileSize,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    })
    await domainEvents.emit('document.uploaded', {
      organizationId: ctx.organization.id,
      actorUserId: ctx.actor.userId,
      payload: { internId: access.record.id, documentId: document.id, documentType: label },
    })
    return { id: document.id, version: document.version }
  },

  /** Start review, verify, reject or request a replacement (document.verify; never your own documents). */
  async review(ctx: RequestContext, input: unknown) {
    authorizationService.require(ctx, 'document.verify')
    const data = parseInput(reviewSchema, input)
    const doc = await prisma.internshipDocument.findFirst({
      where: { id: data.documentId, organization_id: ctx.organization.id, deleted_at: null },
      select: {
        id: true,
        intern_id: true,
        status: true,
        expires_at: true,
        is_current: true,
        visibility: true,
        uploaded_by: true,
        type: { select: { name: true, is_sensitive: true } },
        document_type: true,
      },
    })
    if (!doc) throw new NotFoundError('Document')
    const access = await resolveInternAccess(ctx, doc.intern_id).catch(() => {
      throw new NotFoundError('Document')
    })
    if (!canSee(ctx, visibleLevels(ctx, access), doc, access.isSelf)) throw new NotFoundError('Document')
    if (access.isSelf || !scopeCovers(ctx, 'document.verify', access.record)) {
      throw new ForbiddenError('You can’t review your own documents')
    }
    const today = todayIn(ctx.organization.timezone)
    const status = effectiveDocumentStatus(doc.status, doc.expires_at, today)
    const decision = data.decision as DocumentDecision
    if (!canDecide(decision, status))
      throw new ConflictError(`A ${status.toLowerCase().replace('_', ' ')} document can’t be changed that way`)
    const target = decisionTarget(decision)
    await prisma.internshipDocument.update({
      where: { id: doc.id },
      data: {
        status: target,
        ...(target === 'VERIFIED'
          ? { verified_by: ctx.actor.userId, verified_at: new Date(), rejection_reason: null }
          : {}),
        ...(target === 'REJECTED' ? { rejection_reason: data.reason, verified_by: null, verified_at: null } : {}),
      },
    })
    const label = doc.type?.name ?? DOCUMENT_TYPE_LABELS[doc.document_type]
    const action =
      decision === 'VERIFY'
        ? AUDIT_ACTIONS.DOCUMENT_VERIFIED
        : decision === 'START_REVIEW'
          ? AUDIT_ACTIONS.DOCUMENT_REVIEW_STARTED
          : decision === 'REJECT'
            ? AUDIT_ACTIONS.DOCUMENT_REJECTED
            : AUDIT_ACTIONS.DOCUMENT_REPLACEMENT_REQUESTED
    await auditService.logForContext(ctx, {
      action,
      resourceType: 'document',
      resourceId: doc.id,
      metadata: { internId: doc.intern_id, type: label, before: status, after: target, reason: data.reason },
    })
    if (target !== 'UNDER_REVIEW') {
      await lifecycleRepository.record(prisma, {
        organizationId: ctx.organization.id,
        internId: doc.intern_id,
        type: 'DOCUMENT_REVIEWED',
        description:
          target === 'VERIFIED'
            ? `${label} verified`
            : decision === 'REQUEST_REPLACEMENT'
              ? `${label}: replacement requested`
              : `${label} rejected`,
        actorUserId: ctx.actor.userId,
        metadata: { documentId: doc.id, status: target },
      })
    }
    await domainEvents.emit('document.reviewed', {
      organizationId: ctx.organization.id,
      actorUserId: ctx.actor.userId,
      payload: {
        internId: doc.intern_id,
        documentId: doc.id,
        decision: target as 'UNDER_REVIEW' | 'VERIFIED' | 'REJECTED',
        replacementRequested: decision === 'REQUEST_REPLACEMENT',
      },
    })
  },

  /** HR document queue: current documents of interns in scope, filtered and paginated. */
  async queue(ctx: RequestContext, rawQuery: unknown) {
    const scope = authorizationService.require(ctx, 'document.verify')
    const query = documentQuerySchema.parse(rawQuery ?? {})
    const today = todayIn(ctx.organization.timezone)
    const warn = await settingsService.documentExpiryWarningDays(ctx.organization.id)
    const sensitive = ctx.actor.permissions.has('document.sensitive')
    const restricted = ctx.actor.permissions.has('document.restricted')
    const where: Prisma.InternshipDocumentWhereInput = {
      organization_id: ctx.organization.id,
      deleted_at: null,
      is_current: true,
      intern: {
        AND: [
          internScope(ctx.actor, scope),
          { deleted_at: null },
          query.q
            ? {
                OR: [
                  { employee_code: { contains: query.q, mode: 'insensitive' } },
                  { user: { first_name: { contains: query.q, mode: 'insensitive' } } },
                  { user: { last_name: { contains: query.q, mode: 'insensitive' } } },
                ],
              }
            : {},
        ],
      },
      ...(restricted ? {} : { visibility: { not: 'ADMIN' } }),
      ...(query.type ? { document_type_id: query.type } : {}),
      AND: [
        sensitive ? {} : { OR: [{ type: null }, { type: { is_sensitive: false } }] },
        query.status === 'PENDING'
          ? { status: { in: ['UPLOADED', 'UNDER_REVIEW'] }, OR: [{ expires_at: null }, { expires_at: { gte: today } }] }
          : query.status === 'EXPIRED'
            ? { OR: [{ status: 'EXPIRED' }, { expires_at: { lt: today }, status: { not: 'REJECTED' } }] }
            : query.status
              ? { status: query.status, OR: [{ expires_at: null }, { expires_at: { gte: today } }] }
              : {},
        query.expiring ? { expires_at: { gte: today, lte: addDays(today, warn) } } : {},
      ],
    }
    const pagination = { page: query.page, pageSize: 25 }
    const [rows, total, counts] = await Promise.all([
      prisma.internshipDocument.findMany({
        where,
        orderBy: [{ created_at: 'desc' }],
        ...skipTake(pagination),
        select: {
          ...documentSelect,
          intern: { select: { id: true, employee_code: true, user: { select: personSelect } } },
        },
      }),
      prisma.internshipDocument.count({ where }),
      prisma.internshipDocument.groupBy({
        by: ['status'],
        where: {
          organization_id: ctx.organization.id,
          deleted_at: null,
          is_current: true,
          intern: { AND: [internScope(ctx.actor, scope), { deleted_at: null }] },
        },
        _count: { _all: true },
      }),
    ])
    const count = (status: DocumentStatus) => counts.find((c) => c.status === status)?._count._all ?? 0
    return {
      query,
      warnDays: warn,
      stats: {
        pending: count('UPLOADED') + count('UNDER_REVIEW'),
        verified: count('VERIFIED'),
        rejected: count('REJECTED'),
        expired: count('EXPIRED'),
      },
      page: toPage(
        rows.map((doc) => ({
          ...doc,
          status: effectiveDocumentStatus(doc.status, doc.expires_at, today),
          typeName: doc.type?.name ?? DOCUMENT_TYPE_LABELS[doc.document_type],
          expiringSoon: isExpiringSoon(doc.expires_at, today, warn),
          internName: fullName(doc.intern.user),
          canVerify: true,
        })),
        total,
        pagination,
      ),
    }
  },

  /** Required-document completion for tracked interns in scope (who is missing what). */
  async completionOverview(ctx: RequestContext) {
    const scope = authorizationService.scopeOf(ctx, 'document.read')
    if (!scope) throw new ForbiddenError()
    const today = todayIn(ctx.organization.timezone)
    const interns = await prisma.intern.findMany({
      where: {
        AND: [internScope(ctx.actor, scope), { deleted_at: null, status: { in: [...TRACKED_STATUSES, 'SELECTED'] } }],
      },
      orderBy: { user: { first_name: 'asc' } },
      select: { id: true, employee_code: true, status: true, user: { select: personSelect } },
    })
    const completion = await completionByIntern(
      ctx.organization.id,
      interns.map((i) => i.id),
      today,
    )
    const rows = interns.map((intern) => ({
      ...intern,
      name: fullName(intern.user),
      completion: completion.get(intern.id)!,
    }))
    return {
      rows,
      stats: {
        complete: rows.filter((r) => r.completion.complete).length,
        incomplete: rows.filter((r) => !r.completion.complete).length,
        missing: rows.reduce((sum, r) => sum + r.completion.missing, 0),
      },
    }
  },

  /** Counts for the HR action centre. */
  async counts(ctx: RequestContext) {
    const scope = authorizationService.scopeOf(ctx, 'document.verify')
    if (!scope) return null
    const today = todayIn(ctx.organization.timezone)
    const warn = await settingsService.documentExpiryWarningDays(ctx.organization.id)
    const base: Prisma.InternshipDocumentWhereInput = {
      organization_id: ctx.organization.id,
      deleted_at: null,
      is_current: true,
      intern: { AND: [internScope(ctx.actor, scope), { deleted_at: null }] },
    }
    const [pendingReview, expiring, expired] = await Promise.all([
      prisma.internshipDocument.count({ where: { ...base, status: { in: ['UPLOADED', 'UNDER_REVIEW'] } } }),
      prisma.internshipDocument.count({
        where: { ...base, status: { not: 'REJECTED' }, expires_at: { gte: today, lte: addDays(today, warn) } },
      }),
      prisma.internshipDocument.count({
        where: { ...base, OR: [{ status: 'EXPIRED' }, { status: { not: 'REJECTED' }, expires_at: { lt: today } }] },
      }),
    ])
    return { pendingReview, expiring, expired }
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
    if (!canSee(ctx, visibleLevels(ctx, access), doc, access.isSelf)) throw new NotFoundError('Document')
    if (doc.type?.is_sensitive && !access.isSelf) {
      await auditService.logForContext(ctx, {
        action: AUDIT_ACTIONS.SENSITIVE_DOCUMENT_ACCESSED,
        resourceType: 'document',
        resourceId: doc.id,
        metadata: { internId: doc.intern_id, type: doc.type.name },
      })
    }
    const bytes = await getStorageService().download(doc.storage_path)
    return { bytes, fileName: doc.file_name, mimeType: doc.mime_type }
  },

  /**
   * Soft delete (file kept for recovery). Deleting the current version makes
   * the previous version current again. Reopens a dependent onboarding item.
   */
  async remove(ctx: RequestContext, documentId: string, meta: RequestMeta) {
    const id = parseInput(z.uuid(), documentId)
    const doc = await documentRepository.findWithStorage(ctx.organization.id, id)
    if (!doc) throw new NotFoundError('Document')
    const access = await resolveInternAccess(ctx, doc.intern_id).catch(() => {
      throw new NotFoundError('Document')
    })
    if (!canSee(ctx, visibleLevels(ctx, access), doc, access.isSelf)) throw new NotFoundError('Document')
    if (!access.can.deleteDocuments) throw new ForbiddenError('You can’t delete documents')

    const linked = await prisma.onboardingItem.findMany({
      where: { document_id: doc.id },
      select: { id: true, onboarding_id: true },
    })
    await prisma.$transaction([
      prisma.internshipDocument.update({ where: { id: doc.id }, data: { deleted_at: new Date(), is_current: false } }),
      ...(doc.is_current && doc.previous_version_id
        ? [
            prisma.internshipDocument.updateMany({
              where: { id: doc.previous_version_id, deleted_at: null },
              data: { is_current: true },
            }),
          ]
        : []),
      prisma.onboardingItem.updateMany({
        where: { document_id: doc.id },
        data: { document_id: null, status: 'PENDING', completed_at: null, completed_by: null },
      }),
    ])
    for (const onboardingId of new Set(linked.map((item) => item.onboarding_id))) {
      await afterItemChange(ctx, onboardingId, doc.intern_id)
    }
    const label = doc.type?.name ?? DOCUMENT_TYPE_LABELS[doc.document_type]
    await lifecycleRepository.record(prisma, {
      organizationId: ctx.organization.id,
      internId: doc.intern_id,
      type: 'DOCUMENT_DELETED',
      description: `${label} deleted`,
      actorUserId: ctx.actor.userId,
      metadata: { documentId: doc.id },
    })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.DOCUMENT_DELETED,
      resourceType: 'document',
      resourceId: doc.id,
      metadata: { internId: doc.intern_id, type: label, version: doc.version, reopenedItems: linked.length },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    })
    await domainEvents.emit('document.deleted', {
      organizationId: ctx.organization.id,
      actorUserId: ctx.actor.userId,
      payload: { internId: doc.intern_id, documentId: doc.id },
    })
  },

  async exportCsv(ctx: RequestContext) {
    authorizationService.require(ctx, 'document.export')
    const overview = await this.completionOverview(ctx)
    const csv = toCsv(
      [
        'Employee code',
        'Name',
        'Status',
        'Required',
        'Verified',
        'Awaiting review',
        'Missing',
        'Rejected',
        'Expired',
        'Complete %',
      ],
      overview.rows.map((r) => [
        r.employee_code,
        r.name,
        r.status,
        r.completion.required,
        r.completion.verified,
        r.completion.submitted,
        r.completion.missing,
        r.completion.rejected,
        r.completion.expired,
        r.completion.percent,
      ]),
    )
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.EXPORT_GENERATED,
      resourceType: 'document',
      metadata: { kind: 'document_completion', rows: overview.rows.length },
    })
    return { csv, fileName: `document-completion-${dayKey(todayIn(ctx.organization.timezone))}.csv` }
  },
}

/**
 * Daily: marks documents whose expiry date has passed as EXPIRED and emits
 * expiring-soon events at the warning threshold and 7 days before. Idempotent
 * per day (EXPIRED is set once; warnings fire only on those exact days).
 */
export const documentJobs = {
  async run(now = new Date()) {
    const orgs = await prisma.organization.findMany({ select: { id: true, timezone: true } })
    let expired = 0
    let warned = 0
    for (const org of orgs) {
      const today = todayIn(org.timezone, now)
      const warn = await settingsService.documentExpiryWarningDays(org.id)
      const lapsed = await prisma.internshipDocument.findMany({
        where: {
          organization_id: org.id,
          deleted_at: null,
          is_current: true,
          expires_at: { lt: today },
          status: { notIn: ['EXPIRED', 'REJECTED'] },
        },
        select: { id: true, intern_id: true, expires_at: true, status: true },
      })
      for (const doc of lapsed) {
        const { count } = await prisma.internshipDocument.updateMany({
          where: { id: doc.id, status: doc.status },
          data: { status: 'EXPIRED' },
        })
        if (!count) continue
        expired++
        await auditService.log({
          organizationId: org.id,
          action: AUDIT_ACTIONS.DOCUMENT_EXPIRED,
          resourceType: 'document',
          resourceId: doc.id,
          metadata: { internId: doc.intern_id, before: doc.status, after: 'EXPIRED' },
        })
        await domainEvents.emit('document.expiring', {
          organizationId: org.id,
          actorUserId: null,
          payload: { internId: doc.intern_id, documentId: doc.id, expiresAt: dayKey(doc.expires_at!), expired: true },
        })
      }
      const soon = await prisma.internshipDocument.findMany({
        where: {
          organization_id: org.id,
          deleted_at: null,
          is_current: true,
          status: { notIn: ['EXPIRED', 'REJECTED'] },
          expires_at: { in: [...new Set([warn, 7])].map((d) => addDays(today, d)) },
        },
        select: { id: true, intern_id: true, expires_at: true },
      })
      for (const doc of soon) {
        warned++
        await domainEvents.emit('document.expiring', {
          organizationId: org.id,
          actorUserId: null,
          payload: { internId: doc.intern_id, documentId: doc.id, expiresAt: dayKey(doc.expires_at!), expired: false },
        })
      }
    }
    return { expired, warned }
  },
}

export type InternDocuments = Awaited<ReturnType<typeof documentService.listForIntern>>
export type DocumentQueue = Awaited<ReturnType<typeof documentService.queue>>

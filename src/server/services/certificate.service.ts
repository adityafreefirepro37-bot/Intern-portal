import { randomBytes, randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { config } from '@/lib/config'
import { prisma } from '@/lib/db/client'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors'
import {
  CERTIFICATE_TYPES,
  certificateNumber,
  formatVerificationCode,
  normalizeVerificationCode,
  type CertificateTypeValue,
} from '@/lib/certificates/content'
import { parseDateOnly } from '@/lib/interns/dates'
import { fullName } from '@/lib/utils/format'
import { isoDateSchema, parseInput } from '@/lib/validation'
import type { RequestContext } from '../context'
import { renderCertificatePdf, type PartnerLogo } from '../certificates/pdf'
import { domainEvents } from '../events/domain-events'
import { counterRepository } from '../repositories/lifecycle.repository'
import { internScope } from '../repositories/scope'
import { AUDIT_ACTIONS } from './audit-actions'
import { auditService } from './audit.service'
import { authorizationService } from './authorization.service'
import { optionalText, optionalUuid } from './hr-shared'
import { rateLimitService } from './rate-limit.service'

/**
 * Certificates: HR prepares a draft (text taken from the intern's record and
 * editable), previews it, and issues it — issuing assigns the permanent number
 * and a public verification code and freezes the text. Issued certificates can
 * be revoked with a reason; nothing is ever deleted except drafts.
 *
 * Access: certificate.read at ORGANIZATION scope (HR, admins) sees everything;
 * interns hold it at OWN scope and see only their own issued or revoked
 * certificates (never drafts). create / revoke follow their own scopes.
 *
 * Course certificates are issued automatically when an intern completes a
 * course (if enabled in certificate settings).
 */

const SETTINGS_KEY = 'certificate.settings'
const ELIGIBLE_WINDOW_DAYS = 30

export interface CertificateSettings {
  signatoryName: string | null
  signatoryTitle: string | null
  autoCourse: boolean
  /**
   * Government programme marks. Each can be shown only with the reference of the
   * written approval to use it (letter / permission number), kept for the record.
   */
  msmeLogo: { enabled: boolean; approvalRef: string | null }
  digitalIndiaLogo: { enabled: boolean; approvalRef: string | null }
}

function partnerLogos(settings: CertificateSettings): PartnerLogo[] {
  return [
    ...(settings.msmeLogo.enabled && settings.msmeLogo.approvalRef ? (['msme'] as const) : []),
    ...(settings.digitalIndiaLogo.enabled && settings.digitalIndiaLogo.approvalRef ? (['digitalIndia'] as const) : []),
  ]
}

const optionalDate = z
  .string()
  .optional()
  .transform((v) => v || undefined)
  .pipe(isoDateSchema.optional())

const draftSchema = z.strictObject({
  certificateId: optionalUuid,
  internId: optionalUuid,
  type: z.enum(CERTIFICATE_TYPES),
  recipientName: z.string().trim().min(2, 'Enter the name').max(120).optional(),
  programTitle: optionalText(120),
  departmentName: optionalText(120),
  periodStart: optionalDate,
  periodEnd: optionalDate,
  citation: optionalText(300),
  signatoryName: optionalText(120),
  signatoryTitle: optionalText(160),
})

const checkbox = z.preprocess((value) => value === 'on' || value === 'true' || value === true, z.boolean())
const settingsSchema = z
  .strictObject({
    signatoryName: optionalText(120),
    signatoryTitle: optionalText(160),
    autoCourse: checkbox,
    msmeLogo: checkbox,
    msmeApprovalRef: optionalText(200),
    digitalIndiaLogo: checkbox,
    digitalIndiaApprovalRef: optionalText(200),
  })
  .superRefine((data, ctx) => {
    if (data.msmeLogo && !data.msmeApprovalRef) {
      ctx.addIssue({ code: 'custom', path: ['msmeApprovalRef'], message: 'Enter the approval reference before showing the MSME logo' })
    }
    if (data.digitalIndiaLogo && !data.digitalIndiaApprovalRef) {
      ctx.addIssue({ code: 'custom', path: ['digitalIndiaApprovalRef'], message: 'Enter the approval reference before showing the Digital India logo' })
    }
  })

const revokeSchema = z.strictObject({
  certificateId: z.uuid(),
  reason: z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(500),
})

const listSchema = z.object({
  status: z.enum(['DRAFT', 'ISSUED', 'REVOKED']).optional().catch(undefined),
  type: z.enum(CERTIFICATE_TYPES).optional().catch(undefined),
  q: z.string().trim().max(100).optional().catch(undefined),
})

const certificateSelect = {
  id: true,
  intern_id: true,
  internship_id: true,
  course_id: true,
  certificate_number: true,
  certificate_type: true,
  recipient_name: true,
  program_title: true,
  department_name: true,
  period_start: true,
  period_end: true,
  citation: true,
  signatory_name: true,
  signatory_title: true,
  organization_name: true,
  status: true,
  issued_at: true,
  revoked_at: true,
  revoke_reason: true,
  created_at: true,
  updated_at: true,
  course: { select: { id: true, title: true } },
  intern: { select: { id: true, user_id: true, employee_code: true } },
  issuer: { select: { first_name: true, last_name: true, display_name: true } },
  revoker: { select: { first_name: true, last_name: true, display_name: true } },
  verifications: { select: { verification_code: true, verification_count: true, last_verified_at: true }, take: 1 },
} satisfies Prisma.CertificateSelect

type CertificateRow = Prisma.CertificateGetPayload<{ select: typeof certificateSelect }>

function verificationUrl(code: string) {
  return new URL(`/verify/${code}`, config.app.url).toString()
}

/** Certificates whose intern is within `permission`'s scope; OWN scope never sees drafts. */
function scopedWhere(ctx: RequestContext, permission: 'certificate.read' | 'certificate.create' | 'certificate.revoke') {
  const scope = authorizationService.scopeOf(ctx, permission)
  if (!scope) return null
  const where: Prisma.CertificateWhereInput = {
    organization_id: ctx.organization.id,
    intern: internScope(ctx.actor, scope),
  }
  if (scope === 'OWN') where.status = { not: 'DRAFT' }
  return where
}

function present(ctx: RequestContext, row: CertificateRow) {
  const verification = row.verifications[0] ?? null
  const canCreate = Boolean(authorizationService.scopeOf(ctx, 'certificate.create'))
  return {
    ...row,
    verificationCode: verification?.verification_code ?? null,
    verificationUrl: verification ? verificationUrl(verification.verification_code) : null,
    verificationCount: verification?.verification_count ?? 0,
    lastVerifiedAt: verification?.last_verified_at ?? null,
    isMine: row.intern.user_id === ctx.actor.userId,
    canEdit: row.status === 'DRAFT' && canCreate,
    canIssue: row.status === 'DRAFT' && canCreate,
    canRevoke: row.status === 'ISSUED' && Boolean(authorizationService.scopeOf(ctx, 'certificate.revoke')),
  }
}
export type CertificateView = ReturnType<typeof present>

async function readSettings(organizationId: string): Promise<CertificateSettings> {
  const row = await prisma.setting.findUnique({
    where: { organization_id_key: { organization_id: organizationId, key: SETTINGS_KEY } },
    select: { value: true },
  })
  const value = (row?.value ?? {}) as Partial<CertificateSettings>
  return {
    signatoryName: value.signatoryName ?? null,
    signatoryTitle: value.signatoryTitle ?? null,
    autoCourse: value.autoCourse ?? true,
    msmeLogo: { enabled: Boolean(value.msmeLogo?.enabled), approvalRef: value.msmeLogo?.approvalRef ?? null },
    digitalIndiaLogo: { enabled: Boolean(value.digitalIndiaLogo?.enabled), approvalRef: value.digitalIndiaLogo?.approvalRef ?? null },
  }
}

/** Live facts about an intern used to prefill a certificate. */
async function internFacts(organizationId: string, internId: string) {
  const intern = await prisma.intern.findFirst({
    where: { id: internId, organization_id: organizationId, deleted_at: null },
    select: {
      id: true,
      status: true,
      joining_date: true,
      expected_end_date: true,
      actual_end_date: true,
      user: { select: { first_name: true, last_name: true, display_name: true } },
      department: { select: { name: true } },
      position: { select: { title: true } },
      organization: { select: { name: true } },
      internships: {
        orderBy: { start_date: 'desc' },
        take: 1,
        select: {
          id: true,
          title: true,
          start_date: true,
          expected_end_date: true,
          actual_end_date: true,
          department: { select: { name: true } },
          position: { select: { title: true } },
        },
      },
    },
  })
  if (!intern) return null
  const internship = intern.internships[0] ?? null
  return {
    intern,
    internshipId: internship?.id ?? null,
    recipientName: fullName(intern.user),
    programTitle: internship?.position?.title ?? intern.position?.title ?? internship?.title ?? null,
    departmentName: internship?.department?.name ?? intern.department?.name ?? null,
    periodStart: internship?.start_date ?? intern.joining_date ?? null,
    periodEnd:
      internship?.actual_end_date ??
      intern.actual_end_date ??
      internship?.expected_end_date ??
      intern.expected_end_date ??
      null,
    organizationName: intern.organization.name,
  }
}

/** Assigns the permanent number and verification code, inside a transaction. */
async function assignIdentity(tx: Prisma.TransactionClient, organizationId: string, certificateId: string, issuedAt: Date) {
  const year = issuedAt.getUTCFullYear()
  const sequence = await counterRepository.next(tx, organizationId, `certificate:${year}`, 1)
  const number = certificateNumber(year, sequence)
  // Codes are random; retry on the (astronomically unlikely) collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = formatVerificationCode(randomBytes(12))
    const clash = await tx.certificateVerification.findUnique({ where: { verification_code: code }, select: { id: true } })
    if (clash) continue
    await tx.certificateVerification.create({ data: { certificate_id: certificateId, verification_code: code } })
    return { number, code }
  }
  throw new ConflictError('Could not create a verification code, try again')
}

export const certificateService = {
  async list(ctx: RequestContext, filters: Record<string, string | undefined> = {}) {
    const where = scopedWhere(ctx, 'certificate.read')
    authorizationService.require(ctx, 'certificate.read')
    const f = listSchema.parse(filters)
    const rows = await prisma.certificate.findMany({
      where: {
        ...where!,
        ...(f.status ? { status: f.status } : {}),
        ...(f.type ? { certificate_type: f.type } : {}),
        ...(f.q
          ? {
              OR: [
                { recipient_name: { contains: f.q, mode: 'insensitive' } },
                { certificate_number: { contains: f.q, mode: 'insensitive' } },
                { program_title: { contains: f.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: [{ updated_at: 'desc' }],
      take: 300,
      select: certificateSelect,
    })
    return rows.map((row) => present(ctx, row))
  },

  async counts(ctx: RequestContext) {
    const where = scopedWhere(ctx, 'certificate.read')
    if (!where) return { DRAFT: 0, ISSUED: 0, REVOKED: 0 }
    const groups = await prisma.certificate.groupBy({ by: ['status'], where, _count: { _all: true } })
    const count = (s: string) => groups.find((g) => g.status === s)?._count._all ?? 0
    return { DRAFT: count('DRAFT'), ISSUED: count('ISSUED'), REVOKED: count('REVOKED') }
  },

  async get(ctx: RequestContext, certificateId: string) {
    authorizationService.require(ctx, 'certificate.read')
    const id = parseInput(z.uuid(), certificateId)
    const row = await prisma.certificate.findFirst({ where: { id, ...scopedWhere(ctx, 'certificate.read')! }, select: certificateSelect })
    if (!row) throw new NotFoundError('Certificate')
    return present(ctx, row)
  },

  /** An intern's certificates for their profile (HR) or their own pages. */
  async forIntern(ctx: RequestContext, internId: string) {
    const where = scopedWhere(ctx, 'certificate.read')
    if (!where) return []
    const rows = await prisma.certificate.findMany({
      where: { ...where, intern_id: parseInput(z.uuid(), internId) },
      orderBy: { created_at: 'desc' },
      select: certificateSelect,
    })
    return rows.map((row) => present(ctx, row))
  },

  /** The signed-in person's own issued certificates. */
  async mine(ctx: RequestContext) {
    if (!authorizationService.can(ctx, 'certificate.read')) return []
    const rows = await prisma.certificate.findMany({
      where: { organization_id: ctx.organization.id, intern: { user_id: ctx.actor.userId }, status: { not: 'DRAFT' } },
      orderBy: { issued_at: 'desc' },
      select: certificateSelect,
    })
    return rows.map((row) => present(ctx, row))
  },

  /**
   * Interns who are due an internship certificate: completed, alumni, or ending
   * within 30 days, without a live (draft or issued) completion/experience certificate.
   */
  async candidates(ctx: RequestContext) {
    const scope = authorizationService.scopeOf(ctx, 'certificate.create')
    if (!scope) return []
    const soon = new Date(Date.now() + ELIGIBLE_WINDOW_DAYS * 86_400_000)
    const interns = await prisma.intern.findMany({
      where: {
        AND: [
          internScope(ctx.actor, scope),
          { deleted_at: null },
          {
            OR: [
              { status: { in: ['COMPLETED', 'ALUMNI', 'ENDING_SOON'] } },
              { status: 'ACTIVE', expected_end_date: { lte: soon } },
            ],
          },
          {
            certificates: {
              none: { status: { not: 'REVOKED' }, course_id: null, certificate_type: { in: ['COMPLETION', 'EXPERIENCE'] } },
            },
          },
        ],
      },
      orderBy: [{ expected_end_date: 'asc' }],
      take: 200,
      select: {
        id: true,
        status: true,
        expected_end_date: true,
        actual_end_date: true,
        user: { select: { first_name: true, last_name: true, display_name: true } },
        department: { select: { name: true } },
        position: { select: { title: true } },
      },
    })
    return interns.map((i) => ({
      internId: i.id,
      name: fullName(i.user),
      status: i.status,
      endDate: i.actual_end_date ?? i.expected_end_date,
      department: i.department?.name ?? null,
      position: i.position?.title ?? null,
    }))
  },

  /** Interns HR can prepare any certificate for (the form's picker). */
  async internOptions(ctx: RequestContext) {
    const scope = authorizationService.scopeOf(ctx, 'certificate.create')
    if (!scope) return []
    const rows = await prisma.intern.findMany({
      where: { AND: [internScope(ctx.actor, scope), { deleted_at: null, status: { not: 'SELECTED' } }] },
      orderBy: { user: { first_name: 'asc' } },
      take: 1000,
      select: { id: true, employee_code: true, status: true, user: { select: { first_name: true, last_name: true, display_name: true } } },
    })
    return rows.map((r) => ({ id: r.id, name: fullName(r.user), detail: r.employee_code }))
  },

  /** Creates a draft prefilled from the intern's record, or updates a draft's text. */
  async saveDraft(ctx: RequestContext, input: unknown) {
    const data = parseInput(draftSchema, input)
    authorizationService.require(ctx, 'certificate.create')
    const createWhere = scopedWhere(ctx, 'certificate.create')!

    if (data.certificateId) {
      const existing = await prisma.certificate.findFirst({
        where: { id: data.certificateId, ...createWhere },
        select: { id: true, status: true },
      })
      if (!existing) throw new NotFoundError('Certificate')
      if (existing.status !== 'DRAFT') throw new ValidationError('Issued certificates can’t be edited — revoke and issue a new one')
      await prisma.certificate.update({
        where: { id: existing.id },
        data: {
          certificate_type: data.type,
          ...(data.recipientName ? { recipient_name: data.recipientName } : {}),
          program_title: data.programTitle ?? null,
          department_name: data.departmentName ?? null,
          period_start: data.periodStart ? parseDateOnly(data.periodStart) : null,
          period_end: data.periodEnd ? parseDateOnly(data.periodEnd) : null,
          citation: data.citation ?? null,
          signatory_name: data.signatoryName ?? null,
          signatory_title: data.signatoryTitle ?? null,
        },
      })
      await auditService.logForContext(ctx, {
        action: AUDIT_ACTIONS.CERTIFICATE_DRAFT_SAVED,
        resourceType: 'certificate',
        resourceId: existing.id,
        metadata: { created: false, type: data.type },
      })
      return { id: existing.id }
    }

    if (!data.internId) throw new ValidationError('Choose an intern', { internId: 'Required' })
    const inScope = await prisma.intern.findFirst({
      where: { AND: [{ id: data.internId }, internScope(ctx.actor, authorizationService.scopeOf(ctx, 'certificate.create')!)] },
      select: { id: true },
    })
    const facts = inScope ? await internFacts(ctx.organization.id, data.internId) : null
    if (!facts) throw new NotFoundError('Intern')
    const settings = await readSettings(ctx.organization.id)
    const created = await prisma.certificate.create({
      data: {
        organization_id: ctx.organization.id,
        intern_id: facts.intern.id,
        internship_id: facts.internshipId,
        certificate_number: `DRAFT-${randomUUID()}`,
        certificate_type: data.type,
        recipient_name: data.recipientName ?? facts.recipientName,
        program_title: data.programTitle ?? facts.programTitle,
        department_name: data.departmentName ?? facts.departmentName,
        period_start: data.periodStart ? parseDateOnly(data.periodStart) : facts.periodStart,
        period_end: data.periodEnd ? parseDateOnly(data.periodEnd) : facts.periodEnd,
        citation: data.citation ?? null,
        signatory_name: data.signatoryName ?? settings.signatoryName,
        signatory_title: data.signatoryTitle ?? settings.signatoryTitle,
        organization_name: facts.organizationName,
        created_by: ctx.actor.userId,
      },
      select: { id: true },
    })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.CERTIFICATE_DRAFT_SAVED,
      resourceType: 'certificate',
      resourceId: created.id,
      metadata: { created: true, type: data.type, internId: facts.intern.id },
    })
    return { id: created.id }
  },

  async deleteDraft(ctx: RequestContext, certificateId: string) {
    authorizationService.require(ctx, 'certificate.create')
    const id = parseInput(z.uuid(), certificateId)
    const { count } = await prisma.certificate.deleteMany({
      where: { id, status: 'DRAFT', ...scopedWhere(ctx, 'certificate.create')! },
    })
    if (count === 0) throw new NotFoundError('Draft certificate')
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.CERTIFICATE_DRAFT_DELETED,
      resourceType: 'certificate',
      resourceId: id,
    })
  },

  /** Issues a draft: permanent number, verification code, text frozen, intern notified. */
  async issue(ctx: RequestContext, certificateId: string) {
    authorizationService.require(ctx, 'certificate.create')
    const id = parseInput(z.uuid(), certificateId)
    const draft = await prisma.certificate.findFirst({
      where: { id, ...scopedWhere(ctx, 'certificate.create')! },
      select: { id: true, status: true, recipient_name: true, intern: { select: { user_id: true } } },
    })
    if (!draft) throw new NotFoundError('Certificate')
    if (draft.status !== 'DRAFT') throw new ValidationError('This certificate has already been issued')
    if (!draft.recipient_name.trim()) throw new ValidationError('The certificate needs the recipient’s name')
    const issuedAt = new Date()
    const { number } = await prisma.$transaction(async (tx) => {
      const identity = await assignIdentity(tx, ctx.organization.id, id, issuedAt)
      await tx.certificate.update({
        where: { id },
        data: { status: 'ISSUED', certificate_number: identity.number, issued_at: issuedAt, issued_by: ctx.actor.userId },
      })
      return identity
    })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.CERTIFICATE_ISSUED,
      resourceType: 'certificate',
      resourceId: id,
      metadata: { number },
    })
    await domainEvents.emit('certificate.issued', {
      organizationId: ctx.organization.id,
      actorUserId: ctx.actor.userId,
      payload: { certificateId: id, recipientUserId: draft.intern.user_id, number },
    })
    return { id, number }
  },

  async revoke(ctx: RequestContext, input: unknown) {
    authorizationService.require(ctx, 'certificate.revoke')
    const data = parseInput(revokeSchema, input)
    const certificate = await prisma.certificate.findFirst({
      where: { id: data.certificateId, ...scopedWhere(ctx, 'certificate.revoke')! },
      select: { id: true, status: true, certificate_number: true, intern: { select: { user_id: true } } },
    })
    if (!certificate) throw new NotFoundError('Certificate')
    if (certificate.status !== 'ISSUED') throw new ValidationError('Only issued certificates can be revoked')
    await prisma.certificate.update({
      where: { id: certificate.id },
      data: { status: 'REVOKED', revoked_at: new Date(), revoked_by: ctx.actor.userId, revoke_reason: data.reason },
    })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.CERTIFICATE_REVOKED,
      resourceType: 'certificate',
      resourceId: certificate.id,
      metadata: { number: certificate.certificate_number },
    })
    await domainEvents.emit('certificate.revoked', {
      organizationId: ctx.organization.id,
      actorUserId: ctx.actor.userId,
      payload: { certificateId: certificate.id, recipientUserId: certificate.intern.user_id, number: certificate.certificate_number },
    })
  },

  /** The PDF. Drafts carry a DRAFT watermark; revoked certificates a REVOKED one (and only HR can download them). */
  async pdf(ctx: RequestContext, certificateId: string) {
    const [certificate, settings] = await Promise.all([this.get(ctx, certificateId), readSettings(ctx.organization.id)])
    if (certificate.status === 'REVOKED' && !authorizationService.can(ctx, 'certificate.revoke')) {
      throw new NotFoundError('Certificate')
    }
    const bytes = await renderCertificatePdf({
      type: certificate.certificate_type as CertificateTypeValue,
      recipientName: certificate.recipient_name,
      programTitle: certificate.program_title,
      departmentName: certificate.department_name,
      organizationName: certificate.organization_name,
      courseTitle: certificate.course?.title ?? null,
      periodStart: certificate.period_start,
      periodEnd: certificate.period_end,
      citation: certificate.citation,
      certificateNumber: certificate.status === 'DRAFT' ? 'DRAFT' : certificate.certificate_number,
      issuedAt: certificate.issued_at,
      signatoryName: certificate.signatory_name,
      signatoryTitle: certificate.signatory_title,
      verificationUrl: certificate.verificationUrl,
      watermark: certificate.status === 'DRAFT' ? 'DRAFT' : certificate.status === 'REVOKED' ? 'REVOKED' : null,
      // Current settings, not frozen at issue: if an approval is withdrawn, the marks disappear from every download.
      partnerLogos: partnerLogos(settings),
    })
    const safeName = certificate.recipient_name.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'certificate'
    const filename = certificate.status === 'DRAFT' ? `${safeName}-certificate-draft.pdf` : `${safeName}-${certificate.certificate_number}.pdf`
    return { bytes, filename }
  },

  /**
   * Public check by verification code (no sign-in). Returns only what the
   * certificate itself states — never contact details or internal notes.
   */
  async verify(codeInput: string, ipAddress: string | null) {
    await rateLimitService.consume('certificateVerify', ipAddress ?? 'unknown')
    const code = normalizeVerificationCode(codeInput)
    if (!code) return null
    const verification = await prisma.certificateVerification.findUnique({
      where: { verification_code: code },
      select: {
        id: true,
        certificate: {
          select: {
            status: true,
            certificate_number: true,
            certificate_type: true,
            recipient_name: true,
            program_title: true,
            department_name: true,
            organization_name: true,
            period_start: true,
            period_end: true,
            issued_at: true,
            revoked_at: true,
            course: { select: { title: true } },
          },
        },
      },
    })
    if (!verification || verification.certificate.status === 'DRAFT') return null
    await prisma.certificateVerification.update({
      where: { id: verification.id },
      data: { verification_count: { increment: 1 }, last_verified_at: new Date() },
    })
    const c = verification.certificate
    return {
      code,
      valid: c.status === 'ISSUED',
      status: c.status as 'ISSUED' | 'REVOKED',
      number: c.certificate_number,
      type: c.certificate_type as CertificateTypeValue,
      recipientName: c.recipient_name,
      programTitle: c.program_title,
      departmentName: c.department_name,
      courseTitle: c.course?.title ?? null,
      organizationName: c.organization_name,
      periodStart: c.period_start,
      periodEnd: c.period_end,
      issuedAt: c.issued_at,
      revokedAt: c.revoked_at,
    }
  },

  /** Which approved partner marks certificates show (for the on-page preview). */
  async partnerLogos(ctx: RequestContext): Promise<PartnerLogo[]> {
    authorizationService.require(ctx, 'certificate.read')
    return partnerLogos(await readSettings(ctx.organization.id))
  },

  async settings(ctx: RequestContext) {
    authorizationService.require(ctx, 'certificate.create')
    return readSettings(ctx.organization.id)
  },

  async saveSettings(ctx: RequestContext, input: unknown) {
    authorizationService.require(ctx, 'certificate.create')
    const data = parseInput(settingsSchema, input)
    const value: CertificateSettings = {
      signatoryName: data.signatoryName ?? null,
      signatoryTitle: data.signatoryTitle ?? null,
      autoCourse: data.autoCourse,
      msmeLogo: { enabled: data.msmeLogo, approvalRef: data.msmeApprovalRef ?? null },
      digitalIndiaLogo: { enabled: data.digitalIndiaLogo, approvalRef: data.digitalIndiaApprovalRef ?? null },
    }
    await prisma.setting.upsert({
      where: { organization_id_key: { organization_id: ctx.organization.id, key: SETTINGS_KEY } },
      update: { value: value as unknown as Prisma.InputJsonValue },
      create: { organization_id: ctx.organization.id, key: SETTINGS_KEY, value: value as unknown as Prisma.InputJsonValue },
    })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.CERTIFICATE_SETTINGS_UPDATED,
      resourceType: 'organization',
      resourceId: ctx.organization.id,
      metadata: {
        autoCourse: value.autoCourse,
        hasSignatory: Boolean(value.signatoryName),
        msmeLogo: value.msmeLogo,
        digitalIndiaLogo: value.digitalIndiaLogo,
      },
    })
  },
}

/**
 * System jobs (no request context): the course certificate issued when an
 * intern completes a course. Idempotent — one live certificate per intern and
 * course (also enforced by a partial unique index).
 */
export const certificateJobs = {
  async issueCourseCertificate(organizationId: string, input: { userId: string; courseId: string; completedAt?: Date }) {
    const settings = await readSettings(organizationId)
    if (!settings.autoCourse) return null
    const [intern, course] = await Promise.all([
      prisma.intern.findFirst({
        where: { user_id: input.userId, organization_id: organizationId, deleted_at: null },
        select: { id: true },
      }),
      prisma.course.findFirst({ where: { id: input.courseId, organization_id: organizationId }, select: { id: true, title: true } }),
    ])
    if (!intern || !course) return null
    const existing = await prisma.certificate.findFirst({
      where: { intern_id: intern.id, course_id: course.id, status: { not: 'REVOKED' } },
      select: { id: true },
    })
    if (existing) return null
    const facts = await internFacts(organizationId, intern.id)
    if (!facts) return null
    const issuedAt = new Date()
    const completed = input.completedAt ?? issuedAt
    try {
      const result = await prisma.$transaction(async (tx) => {
        const created = await tx.certificate.create({
          data: {
            organization_id: organizationId,
            intern_id: intern.id,
            course_id: course.id,
            certificate_number: `DRAFT-${randomUUID()}`,
            certificate_type: 'COMPLETION',
            recipient_name: facts.recipientName,
            program_title: course.title,
            department_name: facts.departmentName,
            period_end: new Date(Date.UTC(completed.getUTCFullYear(), completed.getUTCMonth(), completed.getUTCDate())),
            signatory_name: settings.signatoryName,
            signatory_title: settings.signatoryTitle,
            organization_name: facts.organizationName,
          },
          select: { id: true },
        })
        const identity = await assignIdentity(tx, organizationId, created.id, issuedAt)
        await tx.certificate.update({
          where: { id: created.id },
          data: { status: 'ISSUED', certificate_number: identity.number, issued_at: issuedAt },
        })
        return { id: created.id, number: identity.number }
      })
      await auditService.log({
        organizationId,
        actorUserId: null,
        action: AUDIT_ACTIONS.CERTIFICATE_ISSUED,
        resourceType: 'certificate',
        resourceId: result.id,
        metadata: { number: result.number, automatic: true, courseId: course.id },
      })
      await domainEvents.emit('certificate.issued', {
        organizationId,
        actorUserId: null,
        payload: { certificateId: result.id, recipientUserId: input.userId, number: result.number },
      })
      return result
    } catch (error) {
      // Completed twice at the same moment: the partial unique index keeps one.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return null
      throw error
    }
  },
}

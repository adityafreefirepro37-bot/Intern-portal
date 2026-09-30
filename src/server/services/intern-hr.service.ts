import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { ForbiddenError, NotFoundError } from '@/lib/errors'
import { parseDateOnly } from '@/lib/interns/dates'
import { maskValue } from '@/lib/security/masking'
import { isoDateSchema, parseInput } from '@/lib/validation'
import type { RequestContext } from '../context'
import { lifecycleRepository } from '../repositories/lifecycle.repository'
import { AUDIT_ACTIONS } from './audit-actions'
import { auditService } from './audit.service'
import { optionalText, optionalUuid } from './hr-shared'
import { resolveInternAccess, scopeCovers } from './intern-access'

/**
 * The HR record on an intern profile: personal information, emergency
 * contacts and compensation. Personal data is visible to the intern and to
 * organization-wide profile readers (HR/Admin); compensation needs
 * compensation.read. Nothing restricted is sent to other viewers.
 */

const phone = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || undefined)
  .pipe(
    z
      .string()
      .max(20)
      .regex(/^\+?[0-9 ()-]{7,20}$/, 'Enter a valid phone number')
      .optional(),
  )

const personalSchema = z.strictObject({
  internId: z.uuid(),
  preferredName: optionalText(80),
  dateOfBirth: z
    .string()
    .optional()
    .transform((value) => value || undefined)
    .pipe(isoDateSchema.optional()),
  gender: optionalText(40),
  addressLine1: optionalText(160),
  addressLine2: optionalText(160),
  city: optionalText(80),
  state: optionalText(80),
  postalCode: optionalText(20),
  country: optionalText(80),
})

const contactSchema = z.strictObject({
  internId: z.uuid(),
  contactId: optionalUuid,
  name: z.string().trim().min(2, 'Enter a name').max(120),
  relationship: z.string().trim().min(2, 'Enter the relationship').max(60),
  phone: z
    .string()
    .trim()
    .max(20)
    .regex(/^\+?[0-9 ()-]{7,20}$/, 'Enter a valid phone number'),
  alternatePhone: phone,
  email: z
    .string()
    .trim()
    .optional()
    .transform((value) => value || undefined)
    .pipe(z.email('Enter a valid email').max(254).optional()),
})

const compensationSchema = z.strictObject({
  internId: z.uuid(),
  amount: z
    .string()
    .optional()
    .transform((value) => (value ? Number(value) : null))
    .pipe(z.number().min(0).max(10_000_000).nullable()),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .optional()
    .transform((value) => value || null)
    .pipe(
      z
        .string()
        .regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code')
        .nullable(),
    ),
  frequency: z
    .string()
    .optional()
    .transform((value) => value || null)
    .pipe(z.enum(['MONTHLY', 'ONE_TIME', 'NONE']).nullable()),
  notes: optionalText(500),
})

/** HR-side editing of an intern's personal data (org-wide profile update, never your own record here). */
async function requireHrEdit(ctx: RequestContext, internId: string) {
  const access = await resolveInternAccess(ctx, internId)
  const orgWide = ctx.actor.permissions.get('intern_profile.update') === 'ORGANIZATION'
  if (access.isSelf || !orgWide) throw new ForbiddenError('Only HR can edit personal records')
  return access
}

export const internHrService = {
  async record(ctx: RequestContext, internId: string) {
    const access = await resolveInternAccess(ctx, parseInput(z.uuid(), internId))
    if (!access.can.seeSensitive) throw new ForbiddenError()
    const canCompensation = !access.isSelf && scopeCovers(ctx, 'compensation.read', access.record)
    const internship = access.record.internships[0]
    const [profile, contacts, pay] = await Promise.all([
      prisma.internProfile.findUnique({
        where: { intern_id: access.record.id },
        select: {
          preferred_name: true,
          date_of_birth: true,
          gender: true,
          address_line_1: true,
          address_line_2: true,
          city: true,
          state: true,
          postal_code: true,
          country: true,
        },
      }),
      prisma.emergencyContact.findMany({
        where: { intern_id: access.record.id },
        orderBy: { created_at: 'asc' },
        select: { id: true, name: true, relationship: true, phone: true, alternate_phone: true, email: true },
      }),
      canCompensation && internship
        ? prisma.internship.findUnique({
            where: { id: internship.id },
            select: { stipend_amount: true, stipend_currency: true, stipend_frequency: true, stipend_notes: true },
          })
        : Promise.resolve(null),
    ])
    const canEdit = !access.isSelf && ctx.actor.permissions.get('intern_profile.update') === 'ORGANIZATION'
    return {
      personal: profile,
      contacts,
      compensation: canCompensation
        ? {
            amount: pay?.stipend_amount ? Number(pay.stipend_amount) : null,
            currency: pay?.stipend_currency ?? null,
            frequency: pay?.stipend_frequency ?? null,
            notes: pay?.stipend_notes ?? null,
          }
        : null,
      can: {
        edit: canEdit,
        editCompensation:
          canCompensation && scopeCovers(ctx, 'compensation.update', access.record) && Boolean(internship),
      },
    }
  },

  async updatePersonal(ctx: RequestContext, input: unknown) {
    const data = parseInput(personalSchema, input)
    const access = await requireHrEdit(ctx, data.internId)
    const values = {
      preferred_name: data.preferredName ?? null,
      date_of_birth: data.dateOfBirth ? parseDateOnly(data.dateOfBirth) : null,
      gender: data.gender ?? null,
      address_line_1: data.addressLine1 ?? null,
      address_line_2: data.addressLine2 ?? null,
      city: data.city ?? null,
      state: data.state ?? null,
      postal_code: data.postalCode ?? null,
      country: data.country ?? null,
    }
    const before = await prisma.internProfile.findUnique({
      where: { intern_id: access.record.id },
      select: personalFields,
    })
    await prisma.internProfile.upsert({
      where: { intern_id: access.record.id },
      create: { intern_id: access.record.id, ...values },
      update: values,
    })
    const changed = Object.keys(values).filter(
      (key) => String(before?.[key as keyof typeof values] ?? '') !== String(values[key as keyof typeof values] ?? ''),
    )
    await lifecycleRepository.record(prisma, {
      organizationId: ctx.organization.id,
      internId: access.record.id,
      type: 'HR_RECORD_UPDATED',
      description: 'Personal information updated',
      actorUserId: ctx.actor.userId,
      metadata: { fields: changed },
    })
    // Personal values are confidential: the audit trail records which fields changed, not their contents.
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.PERSONAL_INFO_UPDATED,
      resourceType: 'intern',
      resourceId: access.record.id,
      metadata: { fields: changed },
    })
  },

  async saveContact(ctx: RequestContext, input: unknown) {
    const data = parseInput(contactSchema, input)
    const access = await requireHrEdit(ctx, data.internId)
    const values = {
      name: data.name,
      relationship: data.relationship,
      phone: data.phone,
      alternate_phone: data.alternatePhone ?? null,
      email: data.email ?? null,
    }
    if (data.contactId) {
      const { count } = await prisma.emergencyContact.updateMany({
        where: { id: data.contactId, intern_id: access.record.id },
        data: values,
      })
      if (!count) throw new NotFoundError('Contact')
    } else {
      if ((await prisma.emergencyContact.count({ where: { intern_id: access.record.id } })) >= 5) {
        throw new ForbiddenError('Up to 5 emergency contacts can be recorded')
      }
      await prisma.emergencyContact.create({ data: { ...values, intern_id: access.record.id } })
    }
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.PERSONAL_INFO_UPDATED,
      resourceType: 'intern',
      resourceId: access.record.id,
      metadata: { emergencyContact: data.contactId ? 'updated' : 'added', phone: maskValue(data.phone) },
    })
  },

  async removeContact(ctx: RequestContext, input: { internId?: string; contactId?: string }) {
    const internId = parseInput(z.uuid(), input.internId)
    const contactId = parseInput(z.uuid(), input.contactId)
    const access = await requireHrEdit(ctx, internId)
    const { count } = await prisma.emergencyContact.deleteMany({
      where: { id: contactId, intern_id: access.record.id },
    })
    if (!count) throw new NotFoundError('Contact')
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.PERSONAL_INFO_UPDATED,
      resourceType: 'intern',
      resourceId: access.record.id,
      metadata: { emergencyContact: 'removed' },
    })
  },

  async updateCompensation(ctx: RequestContext, input: unknown) {
    const data = parseInput(compensationSchema, input)
    const access = await resolveInternAccess(ctx, data.internId)
    if (access.isSelf || !scopeCovers(ctx, 'compensation.update', access.record)) throw new ForbiddenError()
    const internship = access.record.internships[0]
    if (!internship) throw new NotFoundError('Internship')
    const before = await prisma.internship.findUnique({
      where: { id: internship.id },
      select: { stipend_amount: true, stipend_currency: true, stipend_frequency: true },
    })
    await prisma.internship.update({
      where: { id: internship.id },
      data: {
        stipend_amount: data.amount,
        stipend_currency: data.amount === null ? null : (data.currency ?? 'INR'),
        stipend_frequency: data.frequency,
        stipend_notes: data.notes ?? null,
      },
    })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.COMPENSATION_UPDATED,
      resourceType: 'internship',
      resourceId: internship.id,
      metadata: {
        internId: access.record.id,
        before: {
          amount: before?.stipend_amount ? Number(before.stipend_amount) : null,
          currency: before?.stipend_currency ?? null,
          frequency: before?.stipend_frequency ?? null,
        },
        after: {
          amount: data.amount,
          currency: data.amount === null ? null : (data.currency ?? 'INR'),
          frequency: data.frequency,
        },
      },
    })
  },
}

const personalFields = {
  preferred_name: true,
  date_of_birth: true,
  gender: true,
  address_line_1: true,
  address_line_2: true,
  city: true,
  state: true,
  postal_code: true,
  country: true,
} as const

export type InternHrRecord = Awaited<ReturnType<typeof internHrService.record>>

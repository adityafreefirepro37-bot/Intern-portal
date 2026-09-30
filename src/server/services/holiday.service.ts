import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { ConflictError, NotFoundError } from '@/lib/errors'
import { dayKey } from '@/lib/hr/time'
import { parseDateOnly } from '@/lib/interns/dates'
import { isoDateSchema, parseInput } from '@/lib/validation'
import type { RequestContext } from '../context'
import { AUDIT_ACTIONS } from './audit-actions'
import { auditService } from './audit.service'
import { authorizationService } from './authorization.service'
import { optionalText, optionalUuid } from './hr-shared'

const holidaySchema = z.strictObject({
  holidayId: optionalUuid,
  date: isoDateSchema,
  name: z.string().trim().min(2, 'Enter a name').max(120),
  description: optionalText(500),
  isOptional: z.preprocess((value) => value === 'on' || value === 'true' || value === true, z.boolean()),
})

/** Organization holiday calendar (one holiday per date — enforced by a unique index). */
export const holidayService = {
  /** Anyone signed in may read the holiday calendar (it drives their own leave and attendance). */
  async list(ctx: RequestContext, year?: number) {
    const y = year && year > 2000 && year < 2100 ? year : new Date().getUTCFullYear()
    return prisma.holiday.findMany({
      where: {
        organization_id: ctx.organization.id,
        date: { gte: new Date(Date.UTC(y, 0, 1)), lte: new Date(Date.UTC(y, 11, 31)) },
      },
      orderBy: { date: 'asc' },
      select: { id: true, date: true, name: true, description: true, is_optional: true },
    })
  },

  async upcoming(ctx: RequestContext, from: Date, take = 5) {
    return prisma.holiday.findMany({
      where: { organization_id: ctx.organization.id, date: { gte: from } },
      orderBy: { date: 'asc' },
      take,
      select: { id: true, date: true, name: true, is_optional: true },
    })
  },

  async save(ctx: RequestContext, input: unknown) {
    authorizationService.require(ctx, 'holiday.manage')
    const data = parseInput(holidaySchema, input)
    const date = parseDateOnly(data.date)
    const clash = await prisma.holiday.findFirst({
      where: { organization_id: ctx.organization.id, date, ...(data.holidayId ? { id: { not: data.holidayId } } : {}) },
      select: { name: true },
    })
    if (clash) throw new ConflictError(`${dayKey(date)} is already a holiday (${clash.name})`)
    const values = {
      date,
      name: data.name,
      description: data.description ?? null,
      is_optional: data.isOptional,
    }
    let id: string
    let before: unknown = null
    if (data.holidayId) {
      const existing = await prisma.holiday.findFirst({
        where: { id: data.holidayId, organization_id: ctx.organization.id },
        select: { id: true, date: true, name: true, is_optional: true },
      })
      if (!existing) throw new NotFoundError('Holiday')
      before = { date: dayKey(existing.date), name: existing.name, optional: existing.is_optional }
      id = (await prisma.holiday.update({ where: { id: existing.id }, data: values, select: { id: true } })).id
    } else {
      id = (
        await prisma.holiday.create({
          data: { ...values, organization_id: ctx.organization.id, created_by: ctx.actor.userId },
          select: { id: true },
        })
      ).id
    }
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.HOLIDAY_SAVED,
      resourceType: 'holiday',
      resourceId: id,
      metadata: { before, after: { date: data.date, name: data.name, optional: data.isOptional } },
    })
    return { id }
  },

  async remove(ctx: RequestContext, holidayId: string) {
    authorizationService.require(ctx, 'holiday.manage')
    const id = parseInput(z.uuid(), holidayId)
    const holiday = await prisma.holiday.findFirst({
      where: { id, organization_id: ctx.organization.id },
      select: { id: true, date: true, name: true },
    })
    if (!holiday) throw new NotFoundError('Holiday')
    await prisma.holiday.delete({ where: { id: holiday.id } })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.HOLIDAY_DELETED,
      resourceType: 'holiday',
      resourceId: holiday.id,
      metadata: { before: { date: dayKey(holiday.date), name: holiday.name } },
    })
  },
}

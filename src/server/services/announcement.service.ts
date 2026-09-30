import type { AnnouncementAudience, AnnouncementCategory, AnnouncementPriority, Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors'
import { canApply, inAudience, isLive, TARGETED_AUDIENCES, type AudienceFacts } from '@/lib/hr/announcements'
import { instantAt } from '@/lib/hr/time'
import { parseDateOnly } from '@/lib/interns/dates'
import { fullName } from '@/lib/utils/format'
import { parseInput } from '@/lib/validation'
import type { RequestContext } from '../context'
import { domainEvents } from '../events/domain-events'
import { AUDIT_ACTIONS } from './audit-actions'
import { auditService } from './audit.service'
import { authorizationService } from './authorization.service'
import { optionalUuid, personSelect } from './hr-shared'

/**
 * Announcements with categories, audience targeting and a draft → scheduled
 * → published → archived lifecycle. Viewers only ever receive announcements
 * addressed to them; publishing notifies exactly that audience.
 */

const CATEGORIES = ['COMPANY', 'HR', 'HOLIDAY', 'POLICY', 'INTERNSHIP', 'DEADLINE'] as const
const AUDIENCES = ['EVERYONE', 'DEPARTMENT', 'TEAM', 'INTERNS', 'MANAGERS', 'MENTORS', 'SPECIFIC'] as const
const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const
const localDateTime = z
  .string()
  .optional()
  .transform((value) => value || undefined)
  .pipe(
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Choose a date and time')
      .optional(),
  )

const saveSchema = z
  .strictObject({
    announcementId: optionalUuid,
    title: z.string().trim().min(3, 'Add a title').max(160),
    body: z.string().trim().min(1, 'Write the announcement').max(10_000),
    category: z.enum(CATEGORIES),
    priority: z.enum(PRIORITIES).default('NORMAL'),
    audience: z.enum(AUDIENCES),
    audienceIds: z
      .string()
      .optional()
      .transform((value) => (value ? value.split(',').filter(Boolean) : []))
      .pipe(z.array(z.uuid()).max(200)),
    intent: z.enum(['DRAFT', 'PUBLISH', 'SCHEDULE']),
    publishAt: localDateTime,
    expiresAt: localDateTime,
  })
  .refine((value) => !TARGETED_AUDIENCES.includes(value.audience) || value.audienceIds.length > 0, {
    message: 'Choose who should receive it',
    path: ['audienceIds'],
  })
  .refine((value) => value.intent !== 'SCHEDULE' || value.publishAt, {
    message: 'Choose when to publish',
    path: ['publishAt'],
  })

const statusSchema = z.strictObject({ announcementId: z.uuid(), action: z.enum(['PUBLISH', 'ARCHIVE', 'UNARCHIVE']) })

const announcementSelect = {
  id: true,
  title: true,
  body: true,
  priority: true,
  category: true,
  status: true,
  audience: true,
  audience_ids: true,
  published_at: true,
  expires_at: true,
  archived_at: true,
  created_at: true,
  publisher: { select: personSelect },
  creator: { select: personSelect },
} as const satisfies Prisma.AnnouncementSelect

function toInstant(value: string, timeZone: string) {
  const [date, clock] = value.split('T')
  return instantAt(parseDateOnly(date), clock, timeZone)
}

/** Relationship facts that decide which announcements reach this viewer. */
export async function audienceFacts(ctx: RequestContext): Promise<AudienceFacts> {
  const [intern, managed, mentored] = await Promise.all([
    prisma.intern.findFirst({
      where: { user_id: ctx.actor.userId, organization_id: ctx.organization.id, deleted_at: null },
      select: { department_id: true, team_id: true },
    }),
    prisma.intern.count({ where: { manager_id: ctx.actor.userId, deleted_at: null } }),
    prisma.intern.count({ where: { mentor_id: ctx.actor.userId, deleted_at: null } }),
  ])
  return {
    userId: ctx.actor.userId,
    isIntern: Boolean(intern),
    managesInterns: managed > 0,
    mentorsInterns: mentored > 0,
    departmentIds: [intern?.department_id, ...ctx.actor.headedDepartmentIds].filter((id): id is string => Boolean(id)),
    teamIds: [intern?.team_id, ...ctx.actor.ledTeamIds].filter((id): id is string => Boolean(id)),
  }
}

/** User ids an announcement is addressed to (active members only). */
export async function audienceRecipients(
  organizationId: string,
  announcement: { audience: AnnouncementAudience; audience_ids: string[] },
): Promise<string[]> {
  const active = { organization_id: organizationId, status: 'ACTIVE' as const, deleted_at: null }
  const ids = announcement.audience_ids
  let where: Prisma.UserWhereInput
  switch (announcement.audience) {
    case 'EVERYONE':
      where = active
      break
    case 'INTERNS':
      where = { ...active, intern: { is: { deleted_at: null } } }
      break
    case 'MANAGERS':
      where = { ...active, interns_managed: { some: { deleted_at: null } } }
      break
    case 'MENTORS':
      where = { ...active, interns_mentored: { some: { deleted_at: null } } }
      break
    case 'DEPARTMENT':
      where = {
        ...active,
        OR: [
          { intern: { is: { department_id: { in: ids }, deleted_at: null } } },
          { departments_led: { some: { id: { in: ids } } } },
        ],
      }
      break
    case 'TEAM':
      where = {
        ...active,
        OR: [
          { intern: { is: { team_id: { in: ids }, deleted_at: null } } },
          { teams_led: { some: { id: { in: ids } } } },
        ],
      }
      break
    case 'SPECIFIC':
      where = { ...active, id: { in: ids } }
      break
  }
  const users = await prisma.user.findMany({ where, select: { id: true } })
  return users.map((u) => u.id)
}

async function markPublished(ctx: RequestContext | null, organizationId: string, id: string) {
  // notified_at makes the notification fan-out happen exactly once.
  const { count } = await prisma.announcement.updateMany({
    where: { id, notified_at: null },
    data: { notified_at: new Date() },
  })
  if (count) {
    await domainEvents.emit('announcement.published', {
      organizationId,
      actorUserId: ctx?.actor.userId ?? null,
      payload: { announcementId: id },
    })
  }
}

export const announcementService = {
  /** Live announcements addressed to the viewer. */
  async listActive(ctx: RequestContext, take = 10, now = new Date()) {
    authorizationService.require(ctx, 'announcement.read')
    const [facts, rows] = await Promise.all([
      audienceFacts(ctx),
      prisma.announcement.findMany({
        where: {
          organization_id: ctx.organization.id,
          status: { in: ['PUBLISHED', 'SCHEDULED'] },
          published_at: { not: null, lte: now },
          OR: [{ expires_at: null }, { expires_at: { gt: now } }],
        },
        orderBy: [{ priority: 'desc' }, { published_at: 'desc' }],
        take: 200,
        select: announcementSelect,
      }),
    ])
    return rows
      .filter((row) => isLive(row, now) && inAudience(row, facts))
      .slice(0, take)
      .map((row) => ({ ...row, audience_ids: undefined }))
  },

  /** Everything, including drafts, scheduled and archived (announcement.create or update). */
  async manageList(ctx: RequestContext) {
    if (!authorizationService.canAny(ctx, ['announcement.create', 'announcement.update'])) return null
    const rows = await prisma.announcement.findMany({
      where: { organization_id: ctx.organization.id },
      orderBy: [{ updated_at: 'desc' }],
      take: 100,
      select: announcementSelect,
    })
    return rows.map((row) => ({
      ...row,
      authorName: row.creator ? fullName(row.creator) : row.publisher ? fullName(row.publisher) : null,
    }))
  },

  /** Targets for the audience picker. */
  async audienceOptions(ctx: RequestContext) {
    const [departments, teams, people] = await Promise.all([
      prisma.department.findMany({
        where: { organization_id: ctx.organization.id, is_active: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
      prisma.team.findMany({
        where: { organization_id: ctx.organization.id, is_active: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
      prisma.user.findMany({
        where: { organization_id: ctx.organization.id, status: 'ACTIVE', deleted_at: null },
        orderBy: [{ first_name: 'asc' }, { last_name: 'asc' }],
        select: personSelect,
      }),
    ])
    return {
      departments,
      teams,
      people: people.map((p) => ({ id: p.id, name: fullName(p) })),
    }
  },

  async save(ctx: RequestContext, input: unknown) {
    const data = parseInput(saveSchema, input)
    authorizationService.require(ctx, data.announcementId ? 'announcement.update' : 'announcement.create')
    const tz = ctx.organization.timezone
    const now = new Date()
    const publishAt = data.publishAt ? toInstant(data.publishAt, tz) : null
    const expiresAt = data.expiresAt ? toInstant(data.expiresAt, tz) : null
    if (data.intent === 'SCHEDULE' && publishAt! <= now) {
      throw new ValidationError('Choose a time in the future', { publishAt: 'Must be in the future' })
    }
    const goesLive = data.intent === 'PUBLISH' ? now : data.intent === 'SCHEDULE' ? publishAt : null
    if (expiresAt && goesLive && expiresAt <= goesLive) {
      throw new ValidationError('The expiry must be after publishing', { expiresAt: 'Must be later' })
    }
    const values = {
      title: data.title,
      body: data.body,
      category: data.category as AnnouncementCategory,
      priority: data.priority as AnnouncementPriority,
      audience: data.audience as AnnouncementAudience,
      audience_ids: TARGETED_AUDIENCES.includes(data.audience) ? data.audienceIds : [],
      expires_at: expiresAt,
      status:
        data.intent === 'PUBLISH'
          ? ('PUBLISHED' as const)
          : data.intent === 'SCHEDULE'
            ? ('SCHEDULED' as const)
            : ('DRAFT' as const),
      published_at: goesLive,
      published_by: goesLive ? ctx.actor.userId : null,
      archived_at: null,
    }
    let id: string
    let before: unknown = null
    if (data.announcementId) {
      const existing = await prisma.announcement.findFirst({
        where: { id: data.announcementId, organization_id: ctx.organization.id },
        select: { id: true, status: true, title: true, audience: true, notified_at: true },
      })
      if (!existing) throw new NotFoundError('Announcement')
      if (existing.status === 'PUBLISHED' && data.intent !== 'PUBLISH') {
        throw new ConflictError('A published announcement can be edited and kept published, or archived')
      }
      before = { status: existing.status, title: existing.title, audience: existing.audience }
      const keepPublishedAt = existing.status === 'PUBLISHED'
      id = (
        await prisma.announcement.update({
          where: { id: existing.id },
          data: keepPublishedAt ? { ...values, published_at: undefined, published_by: undefined } : values,
          select: { id: true },
        })
      ).id
    } else {
      id = (
        await prisma.announcement.create({
          data: { ...values, organization_id: ctx.organization.id, created_by: ctx.actor.userId },
          select: { id: true },
        })
      ).id
    }
    await auditService.logForContext(ctx, {
      action: data.intent === 'PUBLISH' ? AUDIT_ACTIONS.ANNOUNCEMENT_PUBLISHED : AUDIT_ACTIONS.ANNOUNCEMENT_SAVED,
      resourceType: 'announcement',
      resourceId: id,
      metadata: {
        before,
        after: {
          status: values.status,
          title: data.title,
          audience: data.audience,
          targets: values.audience_ids.length,
        },
      },
    })
    if (data.intent === 'PUBLISH') await markPublished(ctx, ctx.organization.id, id)
    return { id, status: values.status }
  },

  async setStatus(ctx: RequestContext, input: unknown) {
    authorizationService.require(ctx, 'announcement.update')
    const data = parseInput(statusSchema, input)
    const existing = await prisma.announcement.findFirst({
      where: { id: data.announcementId, organization_id: ctx.organization.id },
      select: { id: true, status: true, published_at: true },
    })
    if (!existing) throw new NotFoundError('Announcement')
    if (!canApply(data.action, existing.status))
      throw new ConflictError('That change isn’t possible from the current state')
    const update: Prisma.AnnouncementUpdateInput =
      data.action === 'PUBLISH'
        ? { status: 'PUBLISHED', published_at: new Date(), publisher: { connect: { id: ctx.actor.userId } } }
        : data.action === 'ARCHIVE'
          ? { status: 'ARCHIVED', archived_at: new Date() }
          : { status: existing.published_at ? 'PUBLISHED' : 'DRAFT', archived_at: null }
    await prisma.announcement.update({ where: { id: existing.id }, data: update })
    await auditService.logForContext(ctx, {
      action: data.action === 'ARCHIVE' ? AUDIT_ACTIONS.ANNOUNCEMENT_ARCHIVED : AUDIT_ACTIONS.ANNOUNCEMENT_PUBLISHED,
      resourceType: 'announcement',
      resourceId: existing.id,
      metadata: { before: existing.status, action: data.action },
    })
    if (data.action === 'PUBLISH') await markPublished(ctx, ctx.organization.id, existing.id)
  },
}

/** Scheduled job: publishes due SCHEDULED announcements and notifies their audience once. */
export const announcementJobs = {
  async publishDue(now = new Date()) {
    const due = await prisma.announcement.findMany({
      where: { status: 'SCHEDULED', published_at: { lte: now } },
      select: { id: true, organization_id: true },
    })
    for (const row of due) {
      await prisma.announcement.update({ where: { id: row.id }, data: { status: 'PUBLISHED' } })
      await markPublished(null, row.organization_id, row.id)
    }
    return { published: due.length }
  },
}

export type ManagedAnnouncement = NonNullable<Awaited<ReturnType<typeof announcementService.manageList>>>[number]

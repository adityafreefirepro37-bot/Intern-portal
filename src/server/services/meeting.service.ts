import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { config } from '@/lib/config'
import { prisma } from '@/lib/db/client'
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import { overlaps } from '@/lib/communication/calendar'
import { buildIcs, type IcsEvent } from '@/lib/communication/ics'
import { instantAt } from '@/lib/hr/time'
import { parseDateOnly } from '@/lib/interns/dates'
import { fullName } from '@/lib/utils/format'
import { isoDateSchema, parseInput } from '@/lib/validation'
import type { RequestContext } from '../context'
import { domainEvents } from '../events/domain-events'
import { userScope } from '../repositories/scope'
import { AUDIT_ACTIONS } from './audit-actions'
import { auditService } from './audit.service'
import { authorizationService } from './authorization.service'
import { optionalText, optionalUuid } from './hr-shared'

/**
 * Meetings: scheduled by people with meeting.manage, with invited attendees who
 * reply (accept / maybe / decline). Visibility is deliberately narrow — a
 * meeting is visible to its attendees, and to people who manage meetings
 * organization-wide (HR, managers, admins). Mentors schedule only with the
 * interns assigned to them (meeting.manage at ASSIGNED scope).
 *
 * Times are entered as wall-clock times in the organization timezone and
 * stored as instants.
 */

const MAX_ATTENDEES = 50
const MAX_DURATION_MIN = 12 * 60
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM')

const meetingSchema = z.strictObject({
  meetingId: optionalUuid,
  title: z.string().trim().min(3, 'Enter a title').max(160),
  description: optionalText(4000),
  date: isoDateSchema,
  startTime: clock,
  endTime: clock,
  location: optionalText(200),
  meetingUrl: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((value) => value || undefined)
    .pipe(
      z
        .url({ protocol: /^https$/, message: 'Use a secure (https://) meeting link' })
        .optional(),
    ),
  attendeeIds: z
    .string()
    .optional()
    .transform((value) => [...new Set((value ?? '').split(',').map((id) => id.trim()).filter(Boolean))])
    .pipe(z.array(z.uuid()).max(MAX_ATTENDEES, `Invite at most ${MAX_ATTENDEES} people`)),
})

const respondSchema = z.strictObject({
  meetingId: z.uuid(),
  response: z.enum(['ACCEPTED', 'TENTATIVE', 'DECLINED']),
})

const cancelSchema = z.strictObject({ meetingId: z.uuid(), reason: optionalText(500) })

const meetingSelect = {
  id: true,
  title: true,
  description: true,
  start_at: true,
  end_at: true,
  location: true,
  meeting_url: true,
  status: true,
  cancelled_at: true,
  cancel_reason: true,
  created_by: true,
  created_at: true,
  updated_at: true,
  creator: { select: { id: true, first_name: true, last_name: true, display_name: true, email: true } },
  attendees: {
    orderBy: [{ is_organizer: 'desc' }, { created_at: 'asc' }],
    select: {
      user_id: true,
      is_organizer: true,
      response: true,
      user: {
        select: { id: true, first_name: true, last_name: true, display_name: true, avatar_url: true, email: true },
      },
    },
  },
} satisfies Prisma.MeetingSelect

type MeetingRow = Prisma.MeetingGetPayload<{ select: typeof meetingSelect }>

function canManageAll(ctx: RequestContext) {
  return authorizationService.scopeOf(ctx, 'meeting.manage') === 'ORGANIZATION'
}

/** Who the actor may invite: anyone active in the organization, or (narrower scopes) the people in scope. */
function inviteeWhere(ctx: RequestContext): Prisma.UserWhereInput {
  const scope = authorizationService.scopeOf(ctx, 'meeting.manage')
  if (!scope) throw new ForbiddenError()
  return { ...userScope(ctx.actor, scope), status: 'ACTIVE', deleted_at: null }
}

function visibleWhere(ctx: RequestContext): Prisma.MeetingWhereInput {
  const base = { organization_id: ctx.organization.id }
  if (canManageAll(ctx)) return base
  return { ...base, attendees: { some: { user_id: ctx.actor.userId } } }
}

function view(ctx: RequestContext, meeting: MeetingRow) {
  const me = meeting.attendees.find((a) => a.user_id === ctx.actor.userId)
  const isOrganizer = meeting.created_by === ctx.actor.userId
  const scheduled = meeting.status === 'SCHEDULED'
  const canEdit =
    scheduled &&
    authorizationService.can(ctx, 'meeting.manage') &&
    (isOrganizer || canManageAll(ctx))
  return {
    ...meeting,
    myResponse: me?.response ?? null,
    isOrganizer,
    canEdit,
    canRespond: scheduled && Boolean(me) && !me!.is_organizer && meeting.end_at > new Date(),
    counts: {
      accepted: meeting.attendees.filter((a) => a.response === 'ACCEPTED').length,
      tentative: meeting.attendees.filter((a) => a.response === 'TENTATIVE').length,
      declined: meeting.attendees.filter((a) => a.response === 'DECLINED').length,
      pending: meeting.attendees.filter((a) => a.response === 'PENDING').length,
    },
  }
}

export type MeetingView = ReturnType<typeof view>

function toIcsEvent(meeting: MeetingRow): IcsEvent {
  return {
    uid: `meeting-${meeting.id}@ayava-intern-os`,
    sequence: Math.floor((meeting.updated_at.getTime() - meeting.created_at.getTime()) / 1000),
    start: meeting.start_at,
    end: meeting.end_at,
    summary: meeting.title,
    description: [meeting.description, meeting.meeting_url && `Join: ${meeting.meeting_url}`].filter(Boolean).join('\n\n'),
    location: meeting.location ?? meeting.meeting_url,
    url: new URL(`/calendar/meetings/${meeting.id}`, config.app.url).toString(),
    organizer: meeting.creator ? { name: fullName(meeting.creator), email: meeting.creator.email } : null,
    attendees: meeting.attendees
      .filter((a) => !a.is_organizer)
      .map((a) => ({ name: fullName(a.user), email: a.user.email, response: a.response })),
    cancelled: meeting.status === 'CANCELLED',
    updatedAt: meeting.updated_at,
  }
}

export const meetingService = {
  /** Meetings the actor attends (or, for organization-wide managers, all) overlapping [from, to). */
  async listForRange(ctx: RequestContext, from: Date, to: Date, options: { mine?: boolean } = {}) {
    authorizationService.require(ctx, 'meeting.read')
    const rows = await prisma.meeting.findMany({
      where: {
        ...(options.mine === false ? visibleWhere(ctx) : { organization_id: ctx.organization.id, attendees: { some: { user_id: ctx.actor.userId } } }),
        start_at: { lt: to },
        end_at: { gt: from },
      },
      orderBy: { start_at: 'asc' },
      take: 500,
      select: meetingSelect,
    })
    return rows.map((row) => view(ctx, row))
  },

  /** The next scheduled meetings the actor attends and hasn't declined. */
  async upcoming(ctx: RequestContext, take = 5) {
    if (!authorizationService.can(ctx, 'meeting.read')) return []
    const rows = await prisma.meeting.findMany({
      where: {
        organization_id: ctx.organization.id,
        status: 'SCHEDULED',
        end_at: { gt: new Date() },
        attendees: { some: { user_id: ctx.actor.userId, response: { not: 'DECLINED' } } },
      },
      orderBy: { start_at: 'asc' },
      take,
      select: meetingSelect,
    })
    return rows.map((row) => view(ctx, row))
  },

  async get(ctx: RequestContext, meetingId: string) {
    authorizationService.require(ctx, 'meeting.read')
    const id = parseInput(z.uuid(), meetingId)
    const meeting = await prisma.meeting.findFirst({ where: { id, ...visibleWhere(ctx) }, select: meetingSelect })
    if (!meeting) throw new NotFoundError('Meeting')
    return view(ctx, meeting)
  },

  /** People the actor may invite (active, in scope), for the scheduling form. */
  async inviteOptions(ctx: RequestContext) {
    authorizationService.require(ctx, 'meeting.manage')
    const people = await prisma.user.findMany({
      where: { ...inviteeWhere(ctx), id: { not: ctx.actor.userId } },
      orderBy: [{ first_name: 'asc' }, { last_name: 'asc' }],
      take: 1000,
      select: {
        id: true,
        first_name: true,
        last_name: true,
        display_name: true,
        user_roles: { take: 1, orderBy: { role: { rank: 'desc' } }, select: { role: { select: { name: true } } } },
      },
    })
    return people.map((p) => ({ id: p.id, name: fullName(p), role: p.user_roles[0]?.role.name ?? null }))
  },

  /**
   * Creates or updates a meeting. Returns the attendees who already have
   * another meeting at that time, so the organizer can see the clash.
   */
  async save(ctx: RequestContext, input: unknown) {
    authorizationService.require(ctx, 'meeting.manage')
    const data = parseInput(meetingSchema, input)
    const tz = ctx.organization.timezone
    const day = parseDateOnly(data.date)
    const start = instantAt(day, data.startTime, tz)
    const end = instantAt(day, data.endTime, tz)
    const minutes = (end.getTime() - start.getTime()) / 60_000
    if (minutes <= 0) throw new ValidationError('The meeting must end after it starts', { endTime: 'End after the start time' })
    if (minutes > MAX_DURATION_MIN) throw new ValidationError('Meetings can last at most 12 hours', { endTime: 'At most 12 hours' })

    const invitees = data.attendeeIds.filter((id) => id !== ctx.actor.userId)
    const allowed = await prisma.user.findMany({
      where: { ...inviteeWhere(ctx), id: { in: invitees } },
      select: { id: true },
    })
    if (allowed.length !== invitees.length) {
      throw new ValidationError('Some invitees can’t be invited', { attendeeIds: 'Choose people from the list' })
    }

    const values = {
      title: data.title,
      description: data.description ?? null,
      start_at: start,
      end_at: end,
      location: data.location ?? null,
      meeting_url: data.meetingUrl ?? null,
    }

    let meetingId: string
    if (!data.meetingId) {
      if (start.getTime() < Date.now() - 5 * 60_000) {
        throw new ValidationError('Choose a time in the future', { startTime: 'This time has passed' })
      }
      const meeting = await prisma.meeting.create({
        data: {
          ...values,
          organization_id: ctx.organization.id,
          created_by: ctx.actor.userId,
          attendees: {
            create: [
              { user_id: ctx.actor.userId, is_organizer: true, response: 'ACCEPTED', responded_at: new Date() },
              ...invitees.map((user_id) => ({ user_id })),
            ],
          },
        },
        select: { id: true },
      })
      meetingId = meeting.id
      await auditService.logForContext(ctx, {
        action: AUDIT_ACTIONS.MEETING_SCHEDULED,
        resourceType: 'meeting',
        resourceId: meetingId,
        metadata: { start: start.toISOString(), minutes, attendees: invitees.length },
      })
      await domainEvents.emit('meeting.scheduled', {
        organizationId: ctx.organization.id,
        actorUserId: ctx.actor.userId,
        payload: { meetingId, attendeeIds: invitees },
      })
    } else {
      const existing = await prisma.meeting.findFirst({
        where: { id: data.meetingId, ...visibleWhere(ctx) },
        select: { id: true, status: true, created_by: true, start_at: true, end_at: true, attendees: { select: { user_id: true, is_organizer: true } } },
      })
      if (!existing) throw new NotFoundError('Meeting')
      if (existing.created_by !== ctx.actor.userId && !canManageAll(ctx)) {
        throw new ForbiddenError('Only the organizer can change this meeting')
      }
      if (existing.status === 'CANCELLED') throw new ValidationError('This meeting was cancelled')
      const timeChanged = existing.start_at.getTime() !== start.getTime() || existing.end_at.getTime() !== end.getTime()
      if (timeChanged && start.getTime() < Date.now() - 5 * 60_000) {
        throw new ValidationError('Choose a time in the future', { startTime: 'This time has passed' })
      }
      const organizerId = existing.attendees.find((a) => a.is_organizer)?.user_id ?? existing.created_by
      const current = existing.attendees.filter((a) => !a.is_organizer).map((a) => a.user_id)
      const wanted = invitees.filter((id) => id !== organizerId)
      const added = wanted.filter((id) => !current.includes(id))
      const removed = current.filter((id) => !wanted.includes(id))
      await prisma.$transaction([
        prisma.meeting.update({ where: { id: existing.id }, data: values }),
        prisma.meetingAttendee.deleteMany({ where: { meeting_id: existing.id, user_id: { in: removed } } }),
        prisma.meetingAttendee.createMany({ data: added.map((user_id) => ({ meeting_id: existing.id, user_id })) }),
        // A new time needs a new answer from everyone who'd replied.
        ...(timeChanged
          ? [
              prisma.meetingAttendee.updateMany({
                where: { meeting_id: existing.id, is_organizer: false },
                data: { response: 'PENDING', responded_at: null },
              }),
            ]
          : []),
      ])
      meetingId = existing.id
      await auditService.logForContext(ctx, {
        action: AUDIT_ACTIONS.MEETING_UPDATED,
        resourceType: 'meeting',
        resourceId: meetingId,
        metadata: { timeChanged, added: added.length, removed: removed.length },
      })
      await domainEvents.emit('meeting.updated', {
        organizationId: ctx.organization.id,
        actorUserId: ctx.actor.userId,
        payload: {
          meetingId,
          notifyIds: [organizerId, ...wanted].filter((id): id is string => Boolean(id) && !added.includes(id!)),
          addedIds: added,
          removedIds: removed,
          timeChanged,
        },
      })
    }

    const conflicts = await this.conflicts(ctx.organization.id, meetingId, [ctx.actor.userId, ...invitees], start, end)
    return { id: meetingId, conflicts }
  },

  /** Attendees (by name) who have another scheduled meeting overlapping [start, end) and haven't declined it. */
  async conflicts(organizationId: string, meetingId: string, userIds: string[], start: Date, end: Date) {
    if (userIds.length === 0) return []
    const clashes = await prisma.meetingAttendee.findMany({
      where: {
        user_id: { in: userIds },
        response: { not: 'DECLINED' },
        meeting: {
          organization_id: organizationId,
          id: { not: meetingId },
          status: 'SCHEDULED',
          start_at: { lt: end },
          end_at: { gt: start },
        },
      },
      select: {
        meeting: { select: { start_at: true, end_at: true } },
        user: { select: { id: true, first_name: true, last_name: true, display_name: true } },
      },
    })
    const names = new Map<string, string>()
    for (const c of clashes) {
      if (overlaps(c.meeting.start_at, c.meeting.end_at, start, end)) names.set(c.user.id, fullName(c.user))
    }
    return [...names.values()].sort()
  },

  async respond(ctx: RequestContext, input: unknown) {
    authorizationService.require(ctx, 'meeting.read')
    const data = parseInput(respondSchema, input)
    const attendee = await prisma.meetingAttendee.findFirst({
      where: { meeting_id: data.meetingId, user_id: ctx.actor.userId, meeting: { organization_id: ctx.organization.id } },
      select: { id: true, is_organizer: true, response: true, meeting: { select: { status: true, end_at: true, created_by: true } } },
    })
    if (!attendee) throw new NotFoundError('Meeting')
    if (attendee.is_organizer) throw new ValidationError('You organize this meeting')
    if (attendee.meeting.status !== 'SCHEDULED') throw new ValidationError('This meeting was cancelled')
    if (attendee.meeting.end_at < new Date()) throw new ValidationError('This meeting has already ended')
    if (attendee.response === data.response) return { response: data.response }
    await prisma.meetingAttendee.update({
      where: { id: attendee.id },
      data: { response: data.response, responded_at: new Date() },
    })
    await domainEvents.emit('meeting.responded', {
      organizationId: ctx.organization.id,
      actorUserId: ctx.actor.userId,
      payload: { meetingId: data.meetingId, organizerId: attendee.meeting.created_by, response: data.response },
    })
    return { response: data.response }
  },

  async cancel(ctx: RequestContext, input: unknown) {
    authorizationService.require(ctx, 'meeting.manage')
    const data = parseInput(cancelSchema, input)
    const meeting = await prisma.meeting.findFirst({
      where: { id: data.meetingId, ...visibleWhere(ctx) },
      select: { id: true, status: true, created_by: true, end_at: true, attendees: { select: { user_id: true } } },
    })
    if (!meeting) throw new NotFoundError('Meeting')
    if (meeting.created_by !== ctx.actor.userId && !canManageAll(ctx)) {
      throw new ForbiddenError('Only the organizer can cancel this meeting')
    }
    if (meeting.status === 'CANCELLED') return
    if (meeting.end_at < new Date()) throw new ValidationError('This meeting has already ended')
    await prisma.meeting.update({
      where: { id: meeting.id },
      data: { status: 'CANCELLED', cancelled_at: new Date(), cancel_reason: data.reason ?? null },
    })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.MEETING_CANCELLED,
      resourceType: 'meeting',
      resourceId: meeting.id,
      metadata: { hasReason: Boolean(data.reason) },
    })
    await domainEvents.emit('meeting.cancelled', {
      organizationId: ctx.organization.id,
      actorUserId: ctx.actor.userId,
      payload: { meetingId: meeting.id, attendeeIds: meeting.attendees.map((a) => a.user_id), reason: data.reason ?? null },
    })
  },

  /** One meeting as an .ics file. */
  async ics(ctx: RequestContext, meetingId: string) {
    authorizationService.require(ctx, 'meeting.read')
    const id = parseInput(z.uuid(), meetingId)
    const meeting = await prisma.meeting.findFirst({ where: { id, ...visibleWhere(ctx) }, select: meetingSelect })
    if (!meeting) throw new NotFoundError('Meeting')
    return { filename: 'meeting.ics', body: buildIcs([toIcsEvent(meeting)]) }
  },

  /** The actor's meetings from 30 days ago to 180 days ahead, as one .ics file. */
  async myIcs(ctx: RequestContext) {
    authorizationService.require(ctx, 'meeting.read')
    const now = Date.now()
    const rows = await prisma.meeting.findMany({
      where: {
        organization_id: ctx.organization.id,
        attendees: { some: { user_id: ctx.actor.userId, response: { not: 'DECLINED' } } },
        start_at: { gte: new Date(now - 30 * 86_400_000), lt: new Date(now + 180 * 86_400_000) },
      },
      orderBy: { start_at: 'asc' },
      take: 1000,
      select: meetingSelect,
    })
    return {
      filename: 'ayava-meetings.ics',
      body: buildIcs(rows.map(toIcsEvent), { calendarName: `${ctx.organization.name} meetings` }),
    }
  },
}

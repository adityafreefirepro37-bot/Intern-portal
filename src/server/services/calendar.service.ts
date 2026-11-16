import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { NotFoundError, ValidationError } from '@/lib/errors'
import {
  CALENDAR_VIEWS,
  CREATABLE_EVENT_TYPES,
  addDaysUtc,
  dayKeyIn,
  parseDay,
  sortItems,
  toDayKey,
  viewRange,
  type CalendarItem,
  type CalendarView,
} from '@/lib/communication/calendar'
import { instantAt } from '@/lib/hr/time'
import { parseDateOnly, todayIn } from '@/lib/interns/dates'
import { isoDateSchema, parseInput } from '@/lib/validation'
import type { RequestContext } from '../context'
import { AUDIT_ACTIONS } from './audit-actions'
import { auditService } from './audit.service'
import { authorizationService } from './authorization.service'
import { optionalText, optionalUuid } from './hr-shared'
import { meetingService } from './meeting.service'

/**
 * The personal calendar: one schedule built from the records that already
 * exist — the viewer's meetings, organization events, their task deadlines,
 * project milestones, their leave, holidays, learning due dates, goal target
 * dates and onboarding items assigned to them. Each source is read only when
 * the viewer holds the permission for it.
 *
 * Organization events (trainings, company events, deadlines) live in
 * calendar_events and are visible to everyone with calendar.read.
 */

const OPEN_TASK = { notIn: ['COMPLETED', 'CANCELLED'] as ('COMPLETED' | 'CANCELLED')[] }
const MAX_EVENT_DAYS = 31
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM')

const eventSchema = z
  .strictObject({
    eventId: optionalUuid,
    title: z.string().trim().min(3, 'Enter a title').max(160),
    description: optionalText(2000),
    eventType: z.enum(CREATABLE_EVENT_TYPES as [string, ...string[]]),
    location: optionalText(200),
    allDay: z.preprocess((value) => value === 'on' || value === 'true' || value === true, z.boolean()),
    startDate: isoDateSchema,
    endDate: z
      .string()
      .optional()
      .transform((value) => value || undefined)
      .pipe(isoDateSchema.optional()),
    startTime: z.string().optional().transform((value) => value || undefined).pipe(clock.optional()),
    endTime: z.string().optional().transform((value) => value || undefined).pipe(clock.optional()),
  })

const eventSelect = {
  id: true,
  title: true,
  description: true,
  event_type: true,
  start_at: true,
  end_at: true,
  all_day: true,
  location: true,
  created_by: true,
} as const

function eventDays(start: Date, end: Date | null, allDay: boolean, tz: string): string[] {
  const first = parseDay(dayKeyIn(start, tz))!
  const last = end ? parseDay(dayKeyIn(allDay ? end : new Date(end.getTime() - 1), tz))! : first
  const days: string[] = []
  for (let d = first; d <= last && days.length < MAX_EVENT_DAYS; d = addDaysUtc(d, 1)) days.push(toDayKey(d))
  return days
}

export interface CalendarPage {
  view: CalendarView
  anchor: Date
  today: Date
  days: Date[]
  prev: string
  next: string
  items: CalendarItem[]
}

export const calendarService = {
  parseView(value: string | undefined): CalendarView {
    return (CALENDAR_VIEWS as readonly string[]).includes(value ?? '') ? (value as CalendarView) : 'month'
  },

  async page(ctx: RequestContext, input: { view?: string; date?: string }): Promise<CalendarPage> {
    authorizationService.require(ctx, 'calendar.read')
    const tz = ctx.organization.timezone
    const view = this.parseView(input.view)
    const today = todayIn(tz)
    const anchor = parseDay(input.date) ?? today
    const { days, prev, next } = viewRange(view, anchor)
    const items = await this.items(ctx, days[0], days[days.length - 1])
    return { view, anchor, today, days, prev: toDayKey(prev), next: toDayKey(next), items }
  },

  /** Every calendar item between two calendar dates (inclusive). */
  async items(ctx: RequestContext, firstDay: Date, lastDay: Date): Promise<CalendarItem[]> {
    const tz = ctx.organization.timezone
    const me = ctx.actor.userId
    const org = ctx.organization.id
    const from = instantAt(firstDay, '00:00', tz)
    const to = instantAt(addDaysUtc(lastDay, 1), '00:00', tz)
    const dates = { gte: firstDay, lte: lastDay }
    const can = (key: Parameters<typeof authorizationService.can>[1]) => authorizationService.can(ctx, key)

    const [meetings, events, tasks, milestones, leave, holidays, learning, goals, onboarding] = await Promise.all([
      can('meeting.read') ? meetingService.listForRange(ctx, from, to) : Promise.resolve([]),
      prisma.calendarEvent.findMany({
        where: {
          organization_id: org,
          deleted_at: null,
          start_at: { lt: to },
          OR: [{ end_at: { gte: from } }, { end_at: null, start_at: { gte: from } }],
        },
        orderBy: { start_at: 'asc' },
        take: 300,
        select: eventSelect,
      }),
      can('task.read')
        ? prisma.task.findMany({
            where: {
              organization_id: org,
              deleted_at: null,
              due_date: dates,
              status: OPEN_TASK,
              assignees: { some: { user_id: me } },
            },
            take: 300,
            select: { id: true, title: true, due_date: true, project: { select: { name: true } } },
          })
        : Promise.resolve([]),
      can('project.read')
        ? prisma.milestone.findMany({
            where: {
              due_date: dates,
              status: { notIn: ['COMPLETED', 'CANCELLED'] },
              project: {
                organization_id: org,
                deleted_at: null,
                OR: [{ owner_id: me }, { manager_id: me }, { members: { some: { user_id: me } } }],
              },
            },
            take: 200,
            select: { id: true, name: true, due_date: true, project: { select: { id: true, name: true } } },
          })
        : Promise.resolve([]),
      can('leave.read')
        ? prisma.leaveRequest.findMany({
            where: {
              organization_id: org,
              user_id: me,
              status: { in: ['APPROVED', 'PENDING'] },
              start_date: { lte: lastDay },
              end_date: { gte: firstDay },
            },
            select: { id: true, start_date: true, end_date: true, status: true, leave_type: { select: { name: true } } },
          })
        : Promise.resolve([]),
      prisma.holiday.findMany({
        where: { organization_id: org, date: dates },
        select: { id: true, date: true, name: true, is_optional: true },
      }),
      can('learning.read')
        ? prisma.courseEnrollment.findMany({
            where: { user_id: me, organization_id: org, due_date: dates, status: { in: ['NOT_STARTED', 'IN_PROGRESS'] } },
            take: 100,
            select: { id: true, due_date: true, course: { select: { id: true, title: true } } },
          })
        : Promise.resolve([]),
      can('goal.read')
        ? prisma.performanceGoal.findMany({
            where: {
              organization_id: org,
              owner_id: me,
              target_date: dates,
              status: { notIn: ['COMPLETED', 'CANCELLED'] },
            },
            take: 100,
            select: { id: true, title: true, target_date: true },
          })
        : Promise.resolve([]),
      can('onboarding.read')
        ? prisma.onboardingItem.findMany({
            where: {
              organization_id: org,
              assigned_to: me,
              due_date: dates,
              status: { notIn: ['COMPLETED', 'SKIPPED'] },
            },
            take: 100,
            select: { id: true, title: true, due_date: true },
          })
        : Promise.resolve([]),
    ])

    const items: CalendarItem[] = []
    for (const m of meetings) {
      const declined = m.myResponse === 'DECLINED'
      items.push({
        key: `meeting-${m.id}`,
        kind: 'MEETING',
        title: m.status === 'CANCELLED' ? `Cancelled: ${m.title}` : m.title,
        day: dayKeyIn(m.start_at, tz),
        start: m.start_at,
        end: m.end_at,
        href: `/calendar/meetings/${m.id}`,
        detail: declined ? 'You declined' : m.myResponse === 'PENDING' ? 'Awaiting your reply' : m.location,
        muted: m.status === 'CANCELLED' || declined,
      })
    }
    for (const e of events) {
      for (const day of eventDays(e.start_at, e.end_at, e.all_day, tz)) {
        items.push({
          key: `event-${e.id}-${day}`,
          kind: 'EVENT',
          title: e.title,
          day,
          start: e.all_day ? null : e.start_at,
          end: e.all_day ? null : e.end_at,
          href: `/calendar/events/${e.id}`,
          detail: e.location,
        })
      }
    }
    for (const t of tasks)
      items.push({
        key: `task-${t.id}`,
        kind: 'TASK',
        title: t.title,
        day: toDayKey(t.due_date!),
        start: null,
        end: null,
        href: `/tasks/${t.id}`,
        detail: t.project?.name,
      })
    for (const m of milestones)
      items.push({
        key: `milestone-${m.id}`,
        kind: 'MILESTONE',
        title: m.name,
        day: toDayKey(m.due_date!),
        start: null,
        end: null,
        href: `/projects/${m.project.id}`,
        detail: m.project.name,
      })
    for (const l of leave) {
      const start = l.start_date < firstDay ? firstDay : l.start_date
      const end = l.end_date > lastDay ? lastDay : l.end_date
      for (let d = start; d <= end; d = addDaysUtc(d, 1)) {
        items.push({
          key: `leave-${l.id}-${toDayKey(d)}`,
          kind: 'LEAVE',
          title: l.leave_type.name,
          day: toDayKey(d),
          start: null,
          end: null,
          href: `/leave?highlight=${l.id}`,
          detail: l.status === 'PENDING' ? 'Waiting for approval' : null,
          muted: l.status === 'PENDING',
        })
      }
    }
    for (const h of holidays)
      items.push({
        key: `holiday-${h.id}`,
        kind: 'HOLIDAY',
        title: h.name,
        day: toDayKey(h.date),
        start: null,
        end: null,
        href: null,
        detail: h.is_optional ? 'Optional holiday' : null,
      })
    for (const e of learning)
      items.push({
        key: `learning-${e.id}`,
        kind: 'LEARNING',
        title: e.course.title,
        day: toDayKey(e.due_date!),
        start: null,
        end: null,
        href: `/learning/courses/${e.course.id}`,
      })
    for (const g of goals)
      items.push({
        key: `goal-${g.id}`,
        kind: 'GOAL',
        title: g.title,
        day: toDayKey(g.target_date!),
        start: null,
        end: null,
        href: `/performance/goals/${g.id}`,
      })
    for (const o of onboarding)
      items.push({
        key: `onboarding-${o.id}`,
        kind: 'ONBOARDING',
        title: o.title,
        day: toDayKey(o.due_date!),
        start: null,
        end: null,
        href: '/onboarding',
      })
    const first = toDayKey(firstDay)
    const last = toDayKey(lastDay)
    return sortItems(items.filter((item) => item.day >= first && item.day <= last))
  },

  async getEvent(ctx: RequestContext, eventId: string) {
    authorizationService.require(ctx, 'calendar.read')
    const id = parseInput(z.uuid(), eventId)
    const event = await prisma.calendarEvent.findFirst({
      where: { id, organization_id: ctx.organization.id, deleted_at: null },
      select: { ...eventSelect, creator: { select: { first_name: true, last_name: true, display_name: true } } },
    })
    if (!event) throw new NotFoundError('Event')
    return {
      ...event,
      canEdit: authorizationService.can(ctx, 'calendar.update'),
      canDelete: authorizationService.can(ctx, 'calendar.delete'),
    }
  },

  /** Creates or updates an organization event (trainings, company events, deadlines). */
  async saveEvent(ctx: RequestContext, input: unknown) {
    const data = parseInput(eventSchema, input)
    authorizationService.require(ctx, data.eventId ? 'calendar.update' : 'calendar.create')
    const tz = ctx.organization.timezone
    const startDay = parseDateOnly(data.startDate)
    const endDay = data.endDate ? parseDateOnly(data.endDate) : startDay
    if (endDay < startDay) throw new ValidationError('The event must end after it starts', { endDate: 'On or after the start date' })
    if ((endDay.getTime() - startDay.getTime()) / 86_400_000 >= MAX_EVENT_DAYS) {
      throw new ValidationError(`Events can span at most ${MAX_EVENT_DAYS} days`, { endDate: 'Too long' })
    }
    let start: Date
    let end: Date | null
    if (data.allDay) {
      start = instantAt(startDay, '00:00', tz)
      end = instantAt(endDay, '23:59', tz)
    } else {
      if (!data.startTime) throw new ValidationError('Enter a start time', { startTime: 'Required' })
      start = instantAt(startDay, data.startTime, tz)
      end = data.endTime ? instantAt(endDay, data.endTime, tz) : null
      if (end && end <= start) throw new ValidationError('The event must end after it starts', { endTime: 'After the start' })
    }
    const values = {
      title: data.title,
      description: data.description ?? null,
      event_type: data.eventType as (typeof CREATABLE_EVENT_TYPES)[number],
      location: data.location ?? null,
      all_day: data.allDay,
      start_at: start,
      end_at: end,
    }
    let id: string
    if (data.eventId) {
      const existing = await prisma.calendarEvent.findFirst({
        where: { id: data.eventId, organization_id: ctx.organization.id, deleted_at: null },
        select: { id: true },
      })
      if (!existing) throw new NotFoundError('Event')
      id = (await prisma.calendarEvent.update({ where: { id: existing.id }, data: values, select: { id: true } })).id
    } else {
      id = (
        await prisma.calendarEvent.create({
          data: { ...values, organization_id: ctx.organization.id, created_by: ctx.actor.userId },
          select: { id: true },
        })
      ).id
    }
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.CALENDAR_EVENT_SAVED,
      resourceType: 'calendar_event',
      resourceId: id,
      metadata: { created: !data.eventId, type: data.eventType, start: data.startDate },
    })
    return { id }
  },

  async removeEvent(ctx: RequestContext, eventId: string) {
    authorizationService.require(ctx, 'calendar.delete')
    const id = parseInput(z.uuid(), eventId)
    const { count } = await prisma.calendarEvent.updateMany({
      where: { id, organization_id: ctx.organization.id, deleted_at: null },
      data: { deleted_at: new Date() },
    })
    if (count === 0) throw new NotFoundError('Event')
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.CALENDAR_EVENT_DELETED,
      resourceType: 'calendar_event',
      resourceId: id,
    })
  },
}

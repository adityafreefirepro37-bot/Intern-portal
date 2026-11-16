import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import type { RequestContext } from '@/server/context'
import { calendarService } from '@/server/services/calendar.service'
import { meetingService } from '@/server/services/meeting.service'
import { messageService } from '@/server/services/message.service'
import { notificationDeliveryService } from '@/server/services/notification-delivery.service'
import { NOTIFICATION_TYPES, notificationService } from '@/server/services/notification.service'
import { AUDIT_ACTIONS } from '@/server/services/audit-actions'
import { contextFor, createUser, prisma, uniqueSuffix, useFakeAuth } from './helpers'

/** "YYYY-MM-DD" `days` from today in India (the seeded organization's timezone). */
function dayIn(days: number) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(Date.now() + days * 86_400_000))
}

async function notificationsFor(userId: string, type: string) {
  return prisma.notification.findMany({ where: { user_id: userId, type }, orderBy: { created_at: 'desc' } })
}

let admin: RequestContext
let hr: RequestContext
let manager: RequestContext
let mentor: RequestContext
let intern: RequestContext
let outsider: RequestContext

beforeAll(async () => {
  ;[admin, hr, manager, mentor, intern] = await Promise.all([
    contextFor('admin@ayavacreatives.com'),
    contextFor('hr@ayavacreatives.com'),
    contextFor('manager@ayavacreatives.com'),
    contextFor('mentor@ayavacreatives.com'),
    contextFor('intern@ayavacreatives.com'),
  ])
  const fake = useFakeAuth()
  const other = await createUser(fake, { role: 'intern' })
  outsider = await contextFor(other.email)
})

describe('meetings', () => {
  it('schedules with invitations, replies, conflicts, rescheduling and cancellation', async () => {
    const date = dayIn(20)
    const title = `Planning ${uniqueSuffix()}`
    const { id, conflicts } = await meetingService.save(manager, {
      title,
      date,
      startTime: '11:00',
      endTime: '11:45',
      meetingUrl: 'https://meet.example.com/abc',
      attendeeIds: [intern.actor.userId, mentor.actor.userId].join(','),
    })
    expect(conflicts).toEqual([])

    const attendees = await prisma.meetingAttendee.findMany({ where: { meeting_id: id } })
    expect(attendees).toHaveLength(3)
    expect(attendees.find((a) => a.is_organizer)).toMatchObject({ user_id: manager.actor.userId, response: 'ACCEPTED' })
    expect(attendees.filter((a) => !a.is_organizer).map((a) => a.response)).toEqual(['PENDING', 'PENDING'])

    // Invitees are notified; meetings email by default, so an email copy is queued.
    const [invite] = await notificationsFor(intern.actor.userId, NOTIFICATION_TYPES.MEETING_INVITED)
    expect(invite.title).toContain(title)
    expect(invite.related_entity_id).toBe(id)
    expect(await prisma.notificationDelivery.count({ where: { notification_id: invite.id, status: 'PENDING' } })).toBe(1)

    // Visible to attendees and org-wide managers (HR), not to other people.
    expect((await meetingService.get(intern, id)).myResponse).toBe('PENDING')
    await expect(meetingService.get(hr, id)).resolves.toMatchObject({ id })
    await expect(meetingService.get(outsider, id)).rejects.toBeInstanceOf(NotFoundError)

    // A decline reaches the organizer.
    await meetingService.respond(intern, { meetingId: id, response: 'DECLINED' })
    const [declined] = await notificationsFor(manager.actor.userId, NOTIFICATION_TYPES.MEETING_RESPONSE)
    expect(declined.title).toContain('declined')

    // A clashing meeting reports who is double-booked (the decliner doesn't count).
    const clash = await meetingService.save(hr, {
      title: `Clash ${uniqueSuffix()}`,
      date,
      startTime: '11:30',
      endTime: '12:00',
      attendeeIds: [mentor.actor.userId, intern.actor.userId].join(','),
    })
    expect(clash.conflicts).toEqual(['Rohan Das'])

    // Moving the meeting asks everyone to reply again.
    await meetingService.save(manager, {
      meetingId: id,
      title,
      date,
      startTime: '15:00',
      endTime: '15:30',
      attendeeIds: [intern.actor.userId, mentor.actor.userId].join(','),
    })
    const after = await prisma.meetingAttendee.findMany({ where: { meeting_id: id, is_organizer: false } })
    expect(after.every((a) => a.response === 'PENDING')).toBe(true)
    expect((await notificationsFor(intern.actor.userId, NOTIFICATION_TYPES.MEETING_UPDATED))[0].title).toContain('moved')

    // Only the organizer (or an organization-wide manager) can cancel.
    await expect(meetingService.cancel(mentor, { meetingId: id })).rejects.toBeInstanceOf(ForbiddenError)
    await meetingService.cancel(manager, { meetingId: id, reason: 'Moved to next sprint' })
    const cancelled = await meetingService.get(intern, id)
    expect(cancelled.status).toBe('CANCELLED')
    expect(cancelled.canRespond).toBe(false)
    expect((await notificationsFor(intern.actor.userId, NOTIFICATION_TYPES.MEETING_CANCELLED))[0].body).toBe('Moved to next sprint')
    await expect(meetingService.respond(intern, { meetingId: id, response: 'ACCEPTED' })).rejects.toBeInstanceOf(ValidationError)

    const audit = await prisma.auditLog.findMany({ where: { resource_id: id }, select: { action: true } })
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining([AUDIT_ACTIONS.MEETING_SCHEDULED, AUDIT_ACTIONS.MEETING_UPDATED, AUDIT_ACTIONS.MEETING_CANCELLED]),
    )

    const ics = await meetingService.ics(intern, id)
    expect(ics.body).toContain(`UID:meeting-${id}@ayava-intern-os`)
    expect(ics.body).toContain('STATUS:CANCELLED')
  })

  it('limits who can schedule and whom they can invite', async () => {
    const base = { title: 'Sync', date: dayIn(21), startTime: '10:00', endTime: '10:30' }
    await expect(meetingService.save(intern, { ...base, attendeeIds: mentor.actor.userId })).rejects.toBeInstanceOf(ForbiddenError)

    // Mentors schedule only with the interns assigned to them.
    const assigned = await prisma.intern.findFirstOrThrow({
      where: { mentor_id: mentor.actor.userId, deleted_at: null },
      select: { user_id: true },
    })
    await expect(meetingService.save(mentor, { ...base, attendeeIds: assigned.user_id })).resolves.toMatchObject({
      id: expect.any(String),
    })
    await expect(meetingService.save(mentor, { ...base, attendeeIds: outsider.actor.userId })).rejects.toBeInstanceOf(
      ValidationError,
    )
    const options = await meetingService.inviteOptions(mentor)
    expect(options.some((o) => o.id === assigned.user_id)).toBe(true)
    expect(options.some((o) => o.id === outsider.actor.userId)).toBe(false)

    // Times are validated.
    await expect(meetingService.save(manager, { ...base, endTime: '09:00', attendeeIds: '' })).rejects.toBeInstanceOf(
      ValidationError,
    )
    await expect(meetingService.save(manager, { ...base, date: dayIn(-2), attendeeIds: '' })).rejects.toBeInstanceOf(
      ValidationError,
    )
    await expect(
      meetingService.save(manager, { ...base, meetingUrl: 'http://insecure.example.com', attendeeIds: '' }),
    ).rejects.toBeInstanceOf(ValidationError)
  })
})

describe('calendar', () => {
  it('combines meetings, task deadlines, holidays and organization events for the viewer', async () => {
    const date = dayIn(25)
    const { id: meetingId } = await meetingService.save(manager, {
      title: `Calendar check ${uniqueSuffix()}`,
      date,
      startTime: '10:00',
      endTime: '10:30',
      attendeeIds: intern.actor.userId,
    })
    const { id: eventId } = await calendarService.saveEvent(hr, {
      title: 'Training day',
      eventType: 'TRAINING',
      allDay: 'on',
      startDate: date,
      endDate: dayIn(26),
    })
    // A throwaway task (seeded tasks are counted by other suites).
    const task = await prisma.task.create({
      data: {
        organization_id: intern.organization.id,
        title: `Due on the calendar ${uniqueSuffix()}`,
        created_by: manager.actor.userId,
        status: 'IN_PROGRESS',
        due_date: new Date(`${date}T00:00:00Z`),
        assignees: { create: { user_id: intern.actor.userId } },
      },
      select: { id: true },
    })

    const page = await calendarService.page(intern, { view: 'week', date })
    const keys = page.items.map((i) => i.key)
    expect(keys).toContain(`meeting-${meetingId}`)
    expect(keys).toContain(`task-${task.id}`)
    expect(keys).toContain(`event-${eventId}-${date}`)
    expect(keys).toContain(`event-${eventId}-${dayIn(26)}`)
    expect(page.days).toHaveLength(7)

    // Someone not invited doesn't see the meeting, but sees the organization event.
    const other = await calendarService.page(outsider, { view: 'week', date })
    expect(other.items.some((i) => i.key === `meeting-${meetingId}`)).toBe(false)
    expect(other.items.some((i) => i.key === `event-${eventId}-${date}`)).toBe(true)

    // Interns can't add or delete organization events.
    await expect(
      calendarService.saveEvent(intern, { title: 'Party', eventType: 'OTHER', allDay: 'on', startDate: date }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(calendarService.removeEvent(intern, eventId)).rejects.toBeInstanceOf(ForbiddenError)
    await calendarService.removeEvent(hr, eventId)
    await expect(calendarService.getEvent(intern, eventId)).rejects.toBeInstanceOf(NotFoundError)
    await prisma.task.delete({ where: { id: task.id } })
  })
})

describe('messages', () => {
  it('company channel: everyone posts, mentions notify, unread counts and read markers work', async () => {
    const general = await prisma.channel.findFirstOrThrow({ where: { slug: 'general', organization_id: intern.organization.id } })
    await messageService.channels(admin)
    await messageService.markRead(admin, general.id)

    const posted = await messageService.send(intern, {
      channelId: general.id,
      body: `Hello @[Meera Iyer](${admin.actor.userId}) ${uniqueSuffix()}`,
    })
    expect(posted.canEdit).toBe(true)

    const list = await messageService.channels(admin)
    expect(list.channels.find((c) => c.id === general.id)?.unread).toBeGreaterThanOrEqual(1)
    const [mention] = await notificationsFor(admin.actor.userId, NOTIFICATION_TYPES.MESSAGE_MENTION)
    expect(mention.body).toContain('Hello @Meera Iyer')

    await messageService.markRead(admin, general.id)
    expect((await messageService.channels(admin)).channels.find((c) => c.id === general.id)?.unread).toBe(0)

    // Edits and deletions appear in the poll.
    const since = new Date(Date.now() - 1000).toISOString()
    await messageService.edit(intern, { messageId: posted.id, body: 'Hello everyone' })
    await expect(messageService.edit(admin, { messageId: posted.id, body: 'hijack' })).rejects.toBeInstanceOf(NotFoundError)
    const changes = await messageService.changes(admin, general.id, since)
    expect(changes.messages.find((m) => m.id === posted.id)).toMatchObject({ body: 'Hello everyone', edited: true, canEdit: false })

    await messageService.remove(intern, posted.id)
    const page = await messageService.open(admin, general.id)
    expect(page.messages.find((m) => m.id === posted.id)).toMatchObject({ deleted: true, body: '' })
  })

  it('member channels and direct messages stay private', async () => {
    const channel = await messageService.createChannel(admin, {
      name: `Squad ${uniqueSuffix()}`,
      channelType: 'TEAM',
      memberIds: [mentor.actor.userId, intern.actor.userId].join(','),
    })
    expect((await notificationsFor(intern.actor.userId, NOTIFICATION_TYPES.CHANNEL_ADDED))[0].related_entity_id).toBe(channel.id)

    await messageService.send(intern, { channelId: channel.id, body: 'Draft is ready' })
    await expect(messageService.open(outsider, channel.id)).rejects.toBeInstanceOf(NotFoundError)
    await expect(messageService.send(outsider, { channelId: channel.id, body: 'hi' })).rejects.toBeInstanceOf(NotFoundError)

    // Managers moderate: they can remove a member's message (audited).
    const fromMentor = await messageService.send(mentor, { channelId: channel.id, body: 'Off-topic' })
    await messageService.remove(admin, fromMentor.id)
    expect(await prisma.auditLog.count({ where: { action: AUDIT_ACTIONS.MESSAGE_REMOVED_BY_MODERATOR, resource_id: fromMentor.id } })).toBe(1)

    // Leaving removes access.
    await messageService.removeMember(intern, { channelId: channel.id, userId: intern.actor.userId })
    await expect(messageService.open(intern, channel.id)).rejects.toBeInstanceOf(NotFoundError)

    // Direct messages: one conversation per pair, unreadable by anyone else, administrators included.
    const dm = await messageService.openDirect(intern, mentor.actor.userId)
    expect(await messageService.openDirect(mentor, intern.actor.userId)).toEqual(dm)
    await messageService.send(intern, { channelId: dm.id, body: 'Quick question' })
    await messageService.send(intern, { channelId: dm.id, body: 'about the brief' })
    expect(await notificationsFor(mentor.actor.userId, NOTIFICATION_TYPES.DIRECT_MESSAGE)).toHaveLength(1)
    await expect(messageService.open(admin, dm.id)).rejects.toBeInstanceOf(NotFoundError)
    expect((await messageService.channels(mentor)).direct.find((c) => c.id === dm.id)).toMatchObject({
      name: 'Aanya Sharma',
      unread: 2,
    })

    // Only channel managers create channels.
    await expect(messageService.createChannel(intern, { name: 'Mine', channelType: 'TEAM' })).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })
})

describe('notification preferences and email delivery', () => {
  it('respects in-app and email choices and never sends without a provider', async () => {
    const before = await notificationDeliveryService.preferences(intern)
    expect(before.items.find((p) => p.category === 'tasks')).toMatchObject({ inApp: true, email: false })

    // Tasks: email only (muted in the app).
    const fields: Record<string, string> = {}
    for (const p of before.items) {
      if (p.category !== 'tasks') fields[`${p.category}.inApp`] = 'on'
    }
    fields['tasks.email'] = 'on'
    await notificationDeliveryService.savePreferences(intern, fields)

    await notificationService.notify(
      intern.organization.id,
      [intern.actor.userId],
      { type: NOTIFICATION_TYPES.TASK_ASSIGNED, title: `Pref check ${uniqueSuffix()}`, entityType: 'task', entityId: null },
      manager.actor.userId,
    )
    const [n] = await notificationsFor(intern.actor.userId, NOTIFICATION_TYPES.TASK_ASSIGNED)
    expect(n.read_at).not.toBeNull()
    const delivery = await prisma.notificationDelivery.findFirstOrThrow({ where: { notification_id: n.id } })
    expect(delivery.status).toBe('PENDING')

    // No email provider in tests: the queue drains as SKIPPED rather than growing.
    await notificationDeliveryService.flush(500)
    expect((await prisma.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).status).toBe('SKIPPED')

    // Both off: nothing is created at all.
    await notificationDeliveryService.savePreferences(intern, {})
    const count = await prisma.notification.count({ where: { user_id: intern.actor.userId } })
    await notificationService.notify(
      intern.organization.id,
      [intern.actor.userId],
      { type: NOTIFICATION_TYPES.TASK_ASSIGNED, title: 'Silent', entityType: 'task', entityId: null },
      manager.actor.userId,
    )
    expect(await prisma.notification.count({ where: { user_id: intern.actor.userId } })).toBe(count)

    // Delivery stats are for notification managers only.
    await expect(notificationDeliveryService.stats(intern)).rejects.toBeInstanceOf(ForbiddenError)
    expect((await notificationDeliveryService.stats(admin)).configured).toBe(false)

    // Restore defaults for other suites.
    await prisma.notificationPreference.deleteMany({ where: { user_id: intern.actor.userId } })
  })
})

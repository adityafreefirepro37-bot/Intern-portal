import { prisma } from '@/lib/db/client'
import { mentionsToText } from '@/lib/communication/mentions'
import { fullName } from '@/lib/utils/format'
import { NOTIFICATION_TYPES, notificationService } from '../services/notification.service'
import { domainEvents } from './domain-events'

/**
 * Phase 08 notifications: meeting invitations, changes, cancellations and
 * replies; message mentions, direct messages and being added to a channel.
 */

const RESPONSE_LABELS = { ACCEPTED: 'accepted', TENTATIVE: 'might attend', DECLINED: 'declined' } as const

async function meetingInfo(meetingId: string) {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: { title: true, start_at: true, organization: { select: { timezone: true } } },
  })
  if (!meeting) return null
  const when = new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: meeting.organization.timezone,
  }).format(meeting.start_at)
  return { title: meeting.title, when }
}

async function actorName(userId: string | null) {
  if (!userId) return 'Someone'
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { first_name: true, last_name: true, display_name: true },
  })
  return user ? fullName(user) : 'Someone'
}

function excerpt(body: string, max = 160) {
  const text = mentionsToText(body).replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

export function registerCommunicationSubscribers() {
  domainEvents.on('meeting.scheduled', async ({ organizationId, actorUserId, payload }) => {
    const meeting = await meetingInfo(payload.meetingId)
    if (!meeting) return
    await notificationService.notify(
      organizationId,
      payload.attendeeIds,
      {
        type: NOTIFICATION_TYPES.MEETING_INVITED,
        title: `${await actorName(actorUserId)} invited you to “${meeting.title}”`,
        body: meeting.when,
        entityType: 'meeting',
        entityId: payload.meetingId,
      },
      actorUserId,
    )
  })

  domainEvents.on('meeting.updated', async ({ organizationId, actorUserId, payload }) => {
    const meeting = await meetingInfo(payload.meetingId)
    if (!meeting) return
    const organizer = await actorName(actorUserId)
    if (payload.addedIds.length) {
      await notificationService.notify(
        organizationId,
        payload.addedIds,
        {
          type: NOTIFICATION_TYPES.MEETING_INVITED,
          title: `${organizer} invited you to “${meeting.title}”`,
          body: meeting.when,
          entityType: 'meeting',
          entityId: payload.meetingId,
        },
        actorUserId,
      )
    }
    if (payload.notifyIds.length) {
      await notificationService.notify(
        organizationId,
        payload.notifyIds,
        {
          type: NOTIFICATION_TYPES.MEETING_UPDATED,
          title: payload.timeChanged
            ? `“${meeting.title}” moved to ${meeting.when} — please reply again`
            : `“${meeting.title}” was updated`,
          body: payload.timeChanged ? undefined : meeting.when,
          entityType: 'meeting',
          entityId: payload.meetingId,
        },
        actorUserId,
      )
    }
    if (payload.removedIds.length) {
      await notificationService.notify(
        organizationId,
        payload.removedIds,
        {
          type: NOTIFICATION_TYPES.MEETING_CANCELLED,
          title: `You’re no longer invited to “${meeting.title}”`,
          body: meeting.when,
          entityType: 'meeting',
          entityId: null,
        },
        actorUserId,
      )
    }
  })

  domainEvents.on('meeting.cancelled', async ({ organizationId, actorUserId, payload }) => {
    const meeting = await meetingInfo(payload.meetingId)
    if (!meeting) return
    await notificationService.notify(
      organizationId,
      payload.attendeeIds,
      {
        type: NOTIFICATION_TYPES.MEETING_CANCELLED,
        title: `“${meeting.title}” on ${meeting.when} was cancelled`,
        body: payload.reason ?? undefined,
        entityType: 'meeting',
        entityId: payload.meetingId,
      },
      actorUserId,
    )
  })

  domainEvents.on('meeting.responded', async ({ organizationId, actorUserId, payload }) => {
    // Organizers hear about declines and maybes; acceptances show on the meeting page.
    if (payload.response === 'ACCEPTED' || !payload.organizerId) return
    const meeting = await meetingInfo(payload.meetingId)
    if (!meeting) return
    await notificationService.notify(
      organizationId,
      [payload.organizerId],
      {
        type: NOTIFICATION_TYPES.MEETING_RESPONSE,
        title: `${await actorName(actorUserId)} ${RESPONSE_LABELS[payload.response]} “${meeting.title}”`,
        body: meeting.when,
        entityType: 'meeting',
        entityId: payload.meetingId,
      },
      actorUserId,
    )
  })

  domainEvents.on('message.posted', async ({ organizationId, actorUserId, payload }) => {
    const message = await prisma.message.findUnique({
      where: { id: payload.messageId },
      select: { body: true, channel: { select: { id: true, name: true, channel_type: true } } },
    })
    if (!message) return
    const sender = await actorName(actorUserId)
    if (payload.mentionedUserIds.length && message.channel.channel_type !== 'DIRECT') {
      await notificationService.notify(
        organizationId,
        payload.mentionedUserIds,
        {
          type: NOTIFICATION_TYPES.MESSAGE_MENTION,
          title: `${sender} mentioned you in #${message.channel.name}`,
          body: excerpt(message.body),
          entityType: 'channel',
          entityId: message.channel.id,
        },
        actorUserId,
      )
    }
    if (payload.directRecipientIds.length) {
      // One unread notification per conversation: a burst of messages doesn't flood the bell.
      const alreadyNotified = await prisma.notification.findMany({
        where: {
          user_id: { in: payload.directRecipientIds },
          type: NOTIFICATION_TYPES.DIRECT_MESSAGE,
          related_entity_id: message.channel.id,
          read_at: null,
        },
        select: { user_id: true },
      })
      const skip = new Set(alreadyNotified.map((n) => n.user_id))
      await notificationService.notify(
        organizationId,
        payload.directRecipientIds.filter((id) => !skip.has(id)),
        {
          type: NOTIFICATION_TYPES.DIRECT_MESSAGE,
          title: `New message from ${sender}`,
          body: excerpt(message.body),
          entityType: 'channel',
          entityId: message.channel.id,
        },
        actorUserId,
      )
    }
  })

  domainEvents.on('channel.members_added', async ({ organizationId, actorUserId, payload }) => {
    const channel = await prisma.channel.findUnique({ where: { id: payload.channelId }, select: { name: true } })
    if (!channel) return
    await notificationService.notify(
      organizationId,
      payload.userIds,
      {
        type: NOTIFICATION_TYPES.CHANNEL_ADDED,
        title: `${await actorName(actorUserId)} added you to #${channel.name}`,
        entityType: 'channel',
        entityId: payload.channelId,
      },
      actorUserId,
    )
  })
}

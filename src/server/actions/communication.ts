'use server'

import { revalidatePath } from 'next/cache'
import { pluralize } from '@/lib/utils/format'
import { requireApiContext } from '../context'
import { calendarService } from '../services/calendar.service'
import { meetingService } from '../services/meeting.service'
import { messageService, type ChatMessage } from '../services/message.service'
import { notificationDeliveryService } from '../services/notification-delivery.service'
import { formError, formFields, safeValues, type FormState } from './form-state'

/**
 * Calendar, meetings, messages and notification settings. The browser sends
 * ids and values only; access rules live in the services.
 */

function refreshCalendar() {
  revalidatePath('/calendar', 'layout')
  revalidatePath('/hr/calendar')
  revalidatePath('/')
}

async function run<T = undefined>(
  formData: FormData,
  operation: (fields: Record<string, string>) => Promise<{ message: string; data?: T }>,
  refresh: () => void = refreshCalendar,
): Promise<FormState<T>> {
  const fields = formFields(formData)
  try {
    const { message, data } = await operation(fields)
    refresh()
    return { status: 'success', message, data }
  } catch (error) {
    return formError(error, safeValues(fields))
  }
}

// ── Meetings ────────────────────────────────────────────────────────────────

export async function saveMeetingAction(_previous: FormState<{ id: string }>, formData: FormData): Promise<FormState<{ id: string }>> {
  const attendeeIds = formData.getAll('attendeeIds').map(String).filter(Boolean).join(',')
  return run(formData, async (fields) => {
    const { id, conflicts } = await meetingService.save(await requireApiContext(), { ...fields, attendeeIds })
    const saved = fields.meetingId ? 'Meeting updated.' : 'Meeting scheduled — invitations sent.'
    const clash = conflicts.length
      ? ` Heads-up: ${conflicts.slice(0, 3).join(', ')}${conflicts.length > 3 ? ` and ${conflicts.length - 3} more` : ''} ${conflicts.length === 1 ? 'has' : 'have'} another meeting then.`
      : ''
    return { message: saved + clash, data: { id } }
  })
}

export async function respondToMeetingAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    const { response } = await meetingService.respond(await requireApiContext(), fields)
    return { message: response === 'ACCEPTED' ? 'See you there.' : response === 'TENTATIVE' ? 'Marked as maybe.' : 'Declined.' }
  })
}

export async function cancelMeetingAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    await meetingService.cancel(await requireApiContext(), fields)
    return { message: 'Meeting cancelled. Attendees have been told.' }
  })
}

// ── Organization events ─────────────────────────────────────────────────────

export async function saveCalendarEventAction(_previous: FormState<{ id: string }>, formData: FormData): Promise<FormState<{ id: string }>> {
  return run(formData, async (fields) => {
    const { id } = await calendarService.saveEvent(await requireApiContext(), fields)
    return { message: fields.eventId ? 'Event updated.' : 'Event added to the calendar.', data: { id } }
  })
}

export async function deleteCalendarEventAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(formData, async (fields) => {
    await calendarService.removeEvent(await requireApiContext(), fields.eventId ?? '')
    return { message: 'Event removed.' }
  })
}

// ── Messages ────────────────────────────────────────────────────────────────

function refreshMessages() {
  revalidatePath('/messages', 'layout')
}

/** Chat calls (send / edit / delete) return the message for the client to merge; no page refresh. */
export async function sendMessageAction(input: { channelId: string; body: string }): Promise<FormState<ChatMessage>> {
  try {
    const message = await messageService.send(await requireApiContext(), input)
    return { status: 'success', data: message }
  } catch (error) {
    return formError(error)
  }
}

export async function editMessageAction(input: { messageId: string; body: string }): Promise<FormState<ChatMessage>> {
  try {
    const message = await messageService.edit(await requireApiContext(), input)
    return { status: 'success', data: message }
  } catch (error) {
    return formError(error)
  }
}

export async function deleteMessageAction(input: { messageId: string }): Promise<FormState> {
  try {
    await messageService.remove(await requireApiContext(), input.messageId)
    return { status: 'success' }
  } catch (error) {
    return formError(error)
  }
}

export async function markChannelReadAction(input: { channelId: string }): Promise<FormState> {
  try {
    await messageService.markRead(await requireApiContext(), input.channelId)
    return { status: 'success' }
  } catch (error) {
    return formError(error)
  }
}

export async function openDirectMessageAction(_previous: FormState<{ slug: string }>, formData: FormData): Promise<FormState<{ slug: string }>> {
  return run(
    formData,
    async (fields) => {
      const channel = await messageService.openDirect(await requireApiContext(), fields.userId ?? '')
      return { message: 'Conversation opened.', data: { slug: channel.slug } }
    },
    refreshMessages,
  )
}

export async function createChannelAction(_previous: FormState<{ slug: string }>, formData: FormData): Promise<FormState<{ slug: string }>> {
  const memberIds = formData.getAll('memberIds').map(String).filter(Boolean).join(',')
  return run(
    formData,
    async (fields) => {
      const channel = await messageService.createChannel(await requireApiContext(), { ...fields, memberIds })
      return { message: 'Channel created.', data: { slug: channel.slug } }
    },
    refreshMessages,
  )
}

export async function updateChannelAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(
    formData,
    async (fields) => {
      await messageService.updateChannel(await requireApiContext(), fields)
      return { message: 'Channel updated.' }
    },
    refreshMessages,
  )
}

export async function addChannelMembersAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const memberIds = formData.getAll('memberIds').map(String).filter(Boolean).join(',')
  return run(
    formData,
    async (fields) => {
      const { added } = await messageService.addMembers(await requireApiContext(), {
        channelId: fields.channelId ?? '',
        memberIds,
      })
      return { message: added ? `Added ${pluralize(added, 'person', 'people')}.` : 'They were already members.' }
    },
    refreshMessages,
  )
}

export async function removeChannelMemberAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(
    formData,
    async (fields) => {
      const ctx = await requireApiContext()
      await messageService.removeMember(ctx, { channelId: fields.channelId ?? '', userId: fields.userId ?? '' })
      return { message: fields.userId === ctx.actor.userId ? 'You left the channel.' : 'Removed from the channel.' }
    },
    refreshMessages,
  )
}

export async function archiveChannelAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(
    formData,
    async (fields) => {
      const archived = fields.archived === 'true'
      await messageService.setArchived(await requireApiContext(), { channelId: fields.channelId ?? '', archived })
      return { message: archived ? 'Channel archived.' : 'Channel restored.' }
    },
    refreshMessages,
  )
}

// ── Notification settings ───────────────────────────────────────────────────

export async function saveNotificationPreferencesAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(
    formData,
    async (fields) => {
      await notificationDeliveryService.savePreferences(await requireApiContext(), fields)
      return { message: 'Notification settings saved.' }
    },
    () => revalidatePath('/notifications'),
  )
}

export async function retryNotificationEmailsAction(_previous: FormState, formData: FormData): Promise<FormState> {
  return run(
    formData,
    async () => {
      const { count } = await notificationDeliveryService.retryFailed(await requireApiContext())
      return { message: count ? `Retrying ${pluralize(count, 'email')}.` : 'Nothing to retry.' }
    },
    () => revalidatePath('/notifications'),
  )
}

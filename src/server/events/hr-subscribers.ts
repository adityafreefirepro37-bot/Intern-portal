import { prisma } from '@/lib/db/client'
import { HR_REQUEST_STATUS_LABELS } from '@/lib/hr/requests'
import { fullName } from '@/lib/utils/format'
import { audienceRecipients } from '../services/announcement.service'
import { NOTIFICATION_TYPES, notificationService, usersWithPermission } from '../services/notification.service'
import { domainEvents } from './domain-events'

/**
 * HR operations → in-app notifications. Queue owners are resolved from
 * permission grants (e.g. everyone holding leave.approve organization-wide)
 * plus the intern's own manager — never from role names.
 */

async function internOf(userId: string) {
  return prisma.intern.findFirst({
    where: { user_id: userId },
    select: { id: true, manager_id: true, user: { select: { first_name: true, last_name: true, display_name: true } } },
  })
}

function day(value: string) {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${value}T00:00:00Z`),
  )
}

export function registerHrSubscribers() {
  domainEvents.on('leave.requested', async ({ organizationId, actorUserId, payload }) => {
    const [intern, hr] = await Promise.all([
      internOf(payload.userId),
      usersWithPermission(organizationId, 'leave.approve'),
    ])
    const leave = await prisma.leaveRequest.findUnique({
      where: { id: payload.leaveId },
      select: { start_date: true, end_date: true, days: true, leave_type: { select: { name: true } } },
    })
    if (!leave) return
    await notificationService.notify(
      organizationId,
      [intern?.manager_id, ...hr].filter((id) => id !== payload.userId),
      {
        type: NOTIFICATION_TYPES.LEAVE_REQUESTED,
        title: `${intern ? fullName(intern.user) : 'Someone'} requested ${leave.leave_type.name.toLowerCase()}`,
        body: `${day(leave.start_date.toISOString().slice(0, 10))} – ${day(leave.end_date.toISOString().slice(0, 10))} · ${leave.days} working day${leave.days === 1 ? '' : 's'}`,
        entityType: 'leave',
        entityId: payload.leaveId,
      },
      actorUserId,
    )
  })

  domainEvents.on('leave.reviewed', async ({ organizationId, actorUserId, payload }) => {
    const approved = payload.decision === 'APPROVED'
    await notificationService.notify(
      organizationId,
      [payload.userId],
      {
        type: approved ? NOTIFICATION_TYPES.LEAVE_APPROVED : NOTIFICATION_TYPES.LEAVE_REJECTED,
        title: approved ? 'Your leave request was approved' : 'Your leave request was rejected',
        entityType: 'leave',
        entityId: payload.leaveId,
      },
      actorUserId,
    )
  })

  domainEvents.on('leave.cancelled', async ({ organizationId, actorUserId, payload }) => {
    // Requester cancelled → tell the approvers; HR cancelled → tell the requester.
    const byRequester = actorUserId === payload.userId
    const intern = byRequester ? await internOf(payload.userId) : null
    const recipients = byRequester
      ? [intern?.manager_id, ...(payload.wasApproved ? await usersWithPermission(organizationId, 'leave.approve') : [])]
      : [payload.userId]
    await notificationService.notify(
      organizationId,
      recipients,
      {
        type: NOTIFICATION_TYPES.LEAVE_CANCELLED,
        title: byRequester
          ? `${intern ? fullName(intern.user) : 'Someone'} cancelled a leave request`
          : 'Your leave was cancelled by HR',
        entityType: 'leave',
        entityId: payload.leaveId,
      },
      actorUserId,
    )
  })

  domainEvents.on('attendance.correction_requested', async ({ organizationId, actorUserId, payload }) => {
    const [intern, hr] = await Promise.all([
      internOf(payload.userId),
      usersWithPermission(organizationId, 'attendance_correction.review'),
    ])
    await notificationService.notify(
      organizationId,
      [intern?.manager_id, ...hr],
      {
        type: NOTIFICATION_TYPES.ATTENDANCE_CORRECTION_REQUESTED,
        title: `${intern ? fullName(intern.user) : 'Someone'} asked to correct attendance for ${day(payload.date)}`,
        entityType: 'attendance_correction',
        entityId: payload.correctionId,
      },
      actorUserId,
    )
  })

  domainEvents.on('attendance.correction_reviewed', async ({ organizationId, actorUserId, payload }) => {
    const approved = payload.decision === 'APPROVED'
    await notificationService.notify(
      organizationId,
      [payload.userId],
      {
        type: approved
          ? NOTIFICATION_TYPES.ATTENDANCE_CORRECTION_APPROVED
          : NOTIFICATION_TYPES.ATTENDANCE_CORRECTION_REJECTED,
        title: `Your attendance correction for ${day(payload.date)} was ${approved ? 'approved' : 'rejected'}`,
        entityType: 'attendance_correction',
        entityId: payload.correctionId,
      },
      actorUserId,
    )
  })

  domainEvents.on('document.uploaded', async ({ organizationId, actorUserId, payload }) => {
    // Only the intern's own uploads need HR's attention; HR uploads are already reviewed by HR.
    const intern = await prisma.intern.findUnique({
      where: { id: payload.internId },
      select: { user_id: true, user: { select: { first_name: true, last_name: true, display_name: true } } },
    })
    if (!intern || intern.user_id !== actorUserId) return
    await notificationService.notify(
      organizationId,
      await usersWithPermission(organizationId, 'document.verify'),
      {
        type: NOTIFICATION_TYPES.DOCUMENT_UPLOADED,
        title: `${fullName(intern.user)} uploaded ${payload.documentType}`,
        body: 'Ready for verification',
        entityType: 'document',
        entityId: payload.documentId,
      },
      actorUserId,
    )
  })

  domainEvents.on('document.reviewed', async ({ organizationId, actorUserId, payload }) => {
    if (payload.decision === 'UNDER_REVIEW') return
    const doc = await prisma.internshipDocument.findUnique({
      where: { id: payload.documentId },
      select: {
        file_name: true,
        rejection_reason: true,
        type: { select: { name: true } },
        intern: { select: { user_id: true } },
      },
    })
    if (!doc) return
    const label = doc.type?.name ?? doc.file_name
    const verified = payload.decision === 'VERIFIED'
    await notificationService.notify(
      organizationId,
      [doc.intern.user_id],
      {
        type: verified ? NOTIFICATION_TYPES.DOCUMENT_VERIFIED : NOTIFICATION_TYPES.DOCUMENT_REJECTED,
        title: verified
          ? `${label} was verified`
          : payload.replacementRequested
            ? `Please upload a new ${label}`
            : `${label} was rejected`,
        body: verified ? undefined : (doc.rejection_reason ?? undefined),
        entityType: 'document',
        entityId: payload.documentId,
      },
      actorUserId,
    )
  })

  domainEvents.on('document.expiring', async ({ organizationId, payload }) => {
    const doc = await prisma.internshipDocument.findUnique({
      where: { id: payload.documentId },
      select: { file_name: true, type: { select: { name: true } }, intern: { select: { user_id: true } } },
    })
    if (!doc) return
    const label = doc.type?.name ?? doc.file_name
    await notificationService.notify(
      organizationId,
      [doc.intern.user_id, ...(await usersWithPermission(organizationId, 'document.verify'))],
      {
        type: NOTIFICATION_TYPES.DOCUMENT_EXPIRING,
        title: payload.expired ? `${label} has expired` : `${label} expires on ${day(payload.expiresAt)}`,
        body: 'Upload a renewed copy',
        entityType: 'document',
        entityId: payload.documentId,
      },
      null,
    )
  })

  domainEvents.on('onboarding.item_assigned', async ({ organizationId, actorUserId, payload }) => {
    const item = await prisma.onboardingItem.findUnique({ where: { id: payload.itemId }, select: { title: true } })
    if (!item) return
    await notificationService.notify(
      organizationId,
      [payload.assigneeId],
      {
        type: NOTIFICATION_TYPES.ONBOARDING_ITEM_ASSIGNED,
        title: `Onboarding task: ${item.title}`,
        entityType: 'intern_onboarding',
        entityId: payload.internId,
      },
      actorUserId,
    )
  })

  domainEvents.on('onboarding.item_overdue', async ({ organizationId, payload }) => {
    const item = await prisma.onboardingItem.findUnique({
      where: { id: payload.itemId },
      select: { title: true, internship: { select: { intern: { select: { user_id: true } } } } },
    })
    if (!item) return
    await notificationService.notify(
      organizationId,
      [payload.assigneeId ?? item.internship.intern.user_id],
      {
        type: NOTIFICATION_TYPES.ONBOARDING_ITEM_OVERDUE,
        title: `Overdue onboarding task: ${item.title}`,
        entityType: 'intern_onboarding',
        entityId: payload.internId,
      },
      null,
    )
  })

  domainEvents.on('hr_request.created', async ({ organizationId, actorUserId, payload }) => {
    const request = await prisma.hrRequest.findUnique({
      where: { id: payload.requestId },
      select: { subject: true, requester: { select: { first_name: true, last_name: true, display_name: true } } },
    })
    if (!request) return
    await notificationService.notify(
      organizationId,
      await usersWithPermission(organizationId, 'hr_request.manage'),
      {
        type: NOTIFICATION_TYPES.HR_REQUEST_CREATED,
        title: `New HR request from ${fullName(request.requester)}`,
        body: request.subject,
        entityType: 'hr_request',
        entityId: payload.requestId,
      },
      actorUserId,
    )
  })

  domainEvents.on('hr_request.updated', async ({ organizationId, actorUserId, payload }) => {
    const request = await prisma.hrRequest.findUnique({
      where: { id: payload.requestId },
      select: { subject: true, requester_id: true, assigned_to: true },
    })
    if (!request) return
    const to = payload.to as keyof typeof HR_REQUEST_STATUS_LABELS
    // A cancellation goes to the handler; every other change goes to the requester.
    const recipients = to === 'CANCELLED' ? [request.assigned_to] : [request.requester_id]
    await notificationService.notify(
      organizationId,
      recipients,
      {
        type: NOTIFICATION_TYPES.HR_REQUEST_UPDATED,
        title:
          to === 'WAITING_FOR_USER'
            ? `HR needs more information: ${request.subject}`
            : `Request ${to === 'CANCELLED' ? 'cancelled' : (HR_REQUEST_STATUS_LABELS[to] ?? to).toLowerCase()}: ${request.subject}`,
        entityType: 'hr_request',
        entityId: payload.requestId,
      },
      actorUserId,
    )
  })

  domainEvents.on('hr_request.commented', async ({ organizationId, actorUserId, payload }) => {
    const request = await prisma.hrRequest.findUnique({
      where: { id: payload.requestId },
      select: { subject: true, requester_id: true, assigned_to: true },
    })
    if (!request) return
    const recipients = payload.byRequester
      ? request.assigned_to
        ? [request.assigned_to]
        : await usersWithPermission(organizationId, 'hr_request.manage')
      : [request.requester_id]
    await notificationService.notify(
      organizationId,
      recipients,
      {
        type: NOTIFICATION_TYPES.HR_REQUEST_COMMENTED,
        title: `New reply: ${request.subject}`,
        entityType: 'hr_request',
        entityId: payload.requestId,
      },
      actorUserId,
    )
  })

  domainEvents.on('announcement.published', async ({ organizationId, actorUserId, payload }) => {
    const announcement = await prisma.announcement.findUnique({
      where: { id: payload.announcementId },
      select: { title: true, audience: true, audience_ids: true },
    })
    if (!announcement) return
    await notificationService.notify(
      organizationId,
      await audienceRecipients(organizationId, announcement),
      {
        type: NOTIFICATION_TYPES.ANNOUNCEMENT_PUBLISHED,
        title: announcement.title,
        body: 'New announcement',
        entityType: 'announcement',
        entityId: payload.announcementId,
      },
      actorUserId,
    )
  })
}

import { logger } from '@/lib/logging'

/**
 * Lightweight in-process domain events.
 *
 * Services emit events *after* their transaction commits; subscribers react
 * (notifications, email, analytics — Prompts 05/06/09). Handlers run
 * sequentially, and a failing handler is logged without affecting the emitter
 * or other handlers. This is deliberately not a distributed bus: events that
 * must survive restarts are persisted separately (audit log, lifecycle events).
 */
export interface DomainEventMap {
  'intern.created': { internId: string; userId: string; invited: boolean }
  'intern.updated': { internId: string; fields: string[] }
  'intern.status_changed': { internId: string; from: string; to: string; automated: boolean }
  'intern.manager_assigned': { internId: string; managerId: string | null; previousManagerId: string | null }
  'intern.mentor_assigned': { internId: string; mentorId: string | null; previousMentorId: string | null }
  'internship.ending_soon': { internId: string; expectedEndDate: string }
  'invitation.created': { userId: string; invitationId: string; delivery: 'email' | 'link' }
  'invitation.accepted': { userId: string; invitationId: string }
  'onboarding.created': { internId: string; onboardingId: string; itemCount: number }
  'onboarding.item_assigned': { internId: string; itemId: string; assigneeId: string }
  'onboarding.item_completed': { internId: string; itemId: string }
  'onboarding.item_overdue': { internId: string; itemId: string; assigneeId: string | null }
  'onboarding.completed': { internId: string; onboardingId: string }
  'document.uploaded': { internId: string; documentId: string; documentType: string }
  'document.deleted': { internId: string; documentId: string }
  'task.created': { taskId: string; projectId: string | null }
  'task.assigned': { taskId: string; projectId: string | null; assigneeIds: string[] }
  'task.status_changed': { taskId: string; projectId: string | null; from: string; to: string }
  'task.commented': { taskId: string; projectId: string | null; commentId: string }
  'task.comment_mention': { taskId: string; commentId: string; mentionedUserIds: string[] }
  'task.submitted': {
    taskId: string
    projectId: string | null
    submissionId: string
    version: number
    resubmission: boolean
  }
  'task.reviewed': {
    taskId: string
    projectId: string | null
    submissionId: string
    version: number
    decision: 'APPROVED' | 'CHANGES_REQUESTED'
    submitterId: string
  }
  'task.due_soon': { taskId: string; dueDate: string }
  'task.overdue': { taskId: string; dueDate: string }
  'project.created': { projectId: string }
  'project.member_added': { projectId: string; userId: string; role: string }
  'project.status_changed': { projectId: string; from: string; to: string }
  'project.milestone_due': { projectId: string; milestoneId: string; dueDate: string }
  'attendance.correction_requested': { correctionId: string; userId: string; date: string }
  'attendance.correction_reviewed': {
    correctionId: string
    userId: string
    date: string
    decision: 'APPROVED' | 'REJECTED'
  }
  'leave.requested': { leaveId: string; userId: string }
  'leave.reviewed': { leaveId: string; userId: string; decision: 'APPROVED' | 'REJECTED' }
  'leave.cancelled': { leaveId: string; userId: string; wasApproved: boolean }
  'document.reviewed': {
    internId: string
    documentId: string
    decision: 'UNDER_REVIEW' | 'VERIFIED' | 'REJECTED'
    replacementRequested: boolean
  }
  'document.expiring': { internId: string; documentId: string; expiresAt: string; expired: boolean }
  'hr_request.created': { requestId: string }
  'hr_request.updated': { requestId: string; from: string; to: string }
  'hr_request.commented': { requestId: string; commentId: string; byRequester: boolean }
  'announcement.published': { announcementId: string }
}

export type DomainEventName = keyof DomainEventMap

export interface DomainEvent<N extends DomainEventName = DomainEventName> {
  name: N
  organizationId: string
  actorUserId: string | null
  occurredAt: Date
  payload: DomainEventMap[N]
}

type Handler<N extends DomainEventName> = (event: DomainEvent<N>) => void | Promise<void>

const handlers = new Map<DomainEventName, Set<Handler<DomainEventName>>>()

// Built-in subscribers (in-app notifications) load lazily on first emit, which
// avoids an import cycle with the services they use.
let subscribers: Promise<void> | null = null
function loadSubscribers() {
  subscribers ??= import('./subscribers').then((module) => module.registerSubscribers())
  return subscribers
}

export const domainEvents = {
  on<N extends DomainEventName>(name: N, handler: Handler<N>): () => void {
    const set = handlers.get(name) ?? new Set()
    set.add(handler as Handler<DomainEventName>)
    handlers.set(name, set)
    return () => set.delete(handler as Handler<DomainEventName>)
  },

  async emit<N extends DomainEventName>(
    name: N,
    input: { organizationId: string; actorUserId: string | null; payload: DomainEventMap[N] },
  ): Promise<void> {
    await loadSubscribers().catch((error) => logger.error('Loading event subscribers failed', { error }))
    const event: DomainEvent<N> = { name, occurredAt: new Date(), ...input }
    logger.debug('Domain event', { name, organizationId: input.organizationId })
    for (const handler of handlers.get(name) ?? []) {
      try {
        await handler(event as DomainEvent<DomainEventName>)
      } catch (error) {
        logger.error('Domain event handler failed', { name, error })
      }
    }
  },

  /** Test seam. */
  reset() {
    handlers.clear()
    subscribers = null
  },
}

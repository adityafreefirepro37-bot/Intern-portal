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
  },
}

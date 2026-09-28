import type { InternStatus } from '@prisma/client'
import type { PermissionKey } from '@/lib/permissions'

/**
 * Internship status rules (pure — enforced by internLifecycleService).
 *
 *   SELECTED ─▶ ONBOARDING ─▶ ACTIVE ─▶ ENDING_SOON ─▶ COMPLETED ─▶ ALUMNI
 *                                  ▲         │
 *                                  └─────────┘ (extension)
 *   Administrative exits: SELECTED/ONBOARDING/ACTIVE/ENDING_SOON ─▶ TERMINATED
 *
 * TERMINATED and ALUMNI are final.
 */
export const INTERN_STATUSES: readonly InternStatus[] = [
  'SELECTED',
  'ONBOARDING',
  'ACTIVE',
  'ENDING_SOON',
  'COMPLETED',
  'ALUMNI',
  'TERMINATED',
]

export const STATUS_TRANSITIONS: Record<InternStatus, readonly InternStatus[]> = {
  SELECTED: ['ONBOARDING', 'TERMINATED'],
  ONBOARDING: ['ACTIVE', 'TERMINATED'],
  ACTIVE: ['ENDING_SOON', 'COMPLETED', 'TERMINATED'],
  ENDING_SOON: ['ACTIVE', 'COMPLETED', 'TERMINATED'],
  COMPLETED: ['ALUMNI'],
  ALUMNI: [],
  TERMINATED: [],
}

export const STATUS_LABELS: Record<InternStatus, string> = {
  SELECTED: 'Selected',
  ONBOARDING: 'Onboarding',
  ACTIVE: 'Active',
  ENDING_SOON: 'Ending soon',
  COMPLETED: 'Completed',
  ALUMNI: 'Alumni',
  TERMINATED: 'Terminated',
}

/** Transitions that end or close an internship need the stronger permission. */
const CLOSING: readonly InternStatus[] = ['COMPLETED', 'ALUMNI', 'TERMINATED']

export function canTransition(from: InternStatus, to: InternStatus): boolean {
  return STATUS_TRANSITIONS[from].includes(to)
}

export function permissionForTransition(to: InternStatus): PermissionKey {
  return CLOSING.includes(to) ? 'internship.complete' : 'internship.update'
}

/** Transitions that must be accompanied by a written reason. */
export function requiresReason(from: InternStatus, to: InternStatus): boolean {
  return to === 'TERMINATED' || (from === 'ENDING_SOON' && to === 'ACTIVE')
}

/** Statuses in which the intern is part of the current programme. */
export const CURRENT_STATUSES: readonly InternStatus[] = ['SELECTED', 'ONBOARDING', 'ACTIVE', 'ENDING_SOON']

/** Mapping to the internship record's own status. */
export function internshipStatusFor(status: InternStatus): 'PLANNED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED' {
  switch (status) {
    case 'SELECTED':
    case 'ONBOARDING':
      return 'PLANNED'
    case 'ACTIVE':
    case 'ENDING_SOON':
      return 'ACTIVE'
    case 'COMPLETED':
    case 'ALUMNI':
      return 'COMPLETED'
    case 'TERMINATED':
      return 'CANCELLED'
  }
}

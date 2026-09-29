import type { MilestoneStatus, ProjectMemberRole, ProjectStatus } from '@prisma/client'
import { daysBetween, todayIn, toDateOnly } from '@/lib/interns/dates'

/**
 * Project and milestone rules (pure).
 *
 *   PLANNING ─▶ ACTIVE ─▶ COMPLETED ─▶ ARCHIVED
 *        │       ▲  │         │
 *        │       │  ▼         └─▶ ACTIVE (reopen)
 *        │      ON_HOLD
 *        └────────┴───▶ CANCELLED ─▶ PLANNING (restore) / ARCHIVED
 */
export const PROJECT_STATUSES: readonly ProjectStatus[] = [
  'PLANNING',
  'ACTIVE',
  'ON_HOLD',
  'COMPLETED',
  'CANCELLED',
  'ARCHIVED',
]

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  PLANNING: 'Planning',
  ACTIVE: 'Active',
  ON_HOLD: 'On hold',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  ARCHIVED: 'Archived',
}

export const PROJECT_TRANSITIONS: Record<ProjectStatus, readonly ProjectStatus[]> = {
  PLANNING: ['ACTIVE', 'ON_HOLD', 'CANCELLED'],
  ACTIVE: ['ON_HOLD', 'COMPLETED', 'CANCELLED'],
  ON_HOLD: ['ACTIVE', 'CANCELLED'],
  COMPLETED: ['ACTIVE', 'ARCHIVED'],
  CANCELLED: ['PLANNING', 'ARCHIVED'],
  ARCHIVED: [],
}

export function canTransitionProject(from: ProjectStatus, to: ProjectStatus): boolean {
  return PROJECT_TRANSITIONS[from].includes(to)
}

/** Cancelling, pausing and reopening need a written reason. */
export function projectTransitionNeedsReason(from: ProjectStatus, to: ProjectStatus): boolean {
  return to === 'CANCELLED' || to === 'ON_HOLD' || (from === 'COMPLETED' && to === 'ACTIVE')
}

/** Statuses in which work continues (tasks can be created and moved). */
export const OPEN_PROJECT_STATUSES: readonly ProjectStatus[] = ['PLANNING', 'ACTIVE', 'ON_HOLD']

export const MEMBER_ROLES: readonly ProjectMemberRole[] = ['OWNER', 'MANAGER', 'MENTOR', 'CONTRIBUTOR', 'VIEWER']
export const MEMBER_ROLE_LABELS: Record<ProjectMemberRole, string> = {
  OWNER: 'Owner',
  MANAGER: 'Manager',
  MENTOR: 'Mentor',
  CONTRIBUTOR: 'Contributor',
  VIEWER: 'Viewer',
}
/** Members who lead the project (edit it, manage members, create and assign tasks). */
export const LEAD_ROLES: readonly ProjectMemberRole[] = ['OWNER', 'MANAGER']

// ── Milestones ──────────────────────────────────────────────────────────────

export type MilestoneDisplayStatus = MilestoneStatus | 'OVERDUE'

export const MILESTONE_STATUS_LABELS: Record<MilestoneDisplayStatus, string> = {
  UPCOMING: 'Upcoming',
  ACTIVE: 'Active',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  OVERDUE: 'Overdue',
}

/** OVERDUE is derived: an open milestone whose due date has passed (organization timezone). */
export function milestoneDisplayStatus(
  milestone: { status: MilestoneStatus; due_date: Date | null },
  timeZone: string,
  now: Date = new Date(),
): MilestoneDisplayStatus {
  if (milestone.status === 'COMPLETED' || milestone.status === 'CANCELLED' || !milestone.due_date)
    return milestone.status
  return daysBetween(todayIn(timeZone, now), toDateOnly(milestone.due_date)) < 0 ? 'OVERDUE' : milestone.status
}

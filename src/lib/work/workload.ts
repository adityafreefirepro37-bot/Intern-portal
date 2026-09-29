/**
 * Workload levels (pure, transparent rules — no scoring model).
 *
 * Inputs per person, counted over tasks assigned to them:
 *  - active:          tasks in ASSIGNED, IN_PROGRESS, BLOCKED or CHANGES_REQUESTED
 *  - overdue:         open tasks (active or IN_REVIEW) whose due date has passed
 *  - dueThisWeek:     active tasks due in the next 7 days (today included)
 *  - hoursThisWeek:   estimated hours of active tasks that are overdue or due in the next 7 days;
 *                     a task with several assignees contributes its estimate split equally
 *
 * Levels (first match wins):
 *  - OVERLOADED  active ≥ 8, or overdue ≥ 3, or hoursThisWeek > 40
 *  - HIGH        active ≥ 5, or overdue ≥ 1, or hoursThisWeek > 30
 *  - LOW         active ≤ 1 and nothing overdue
 *  - NORMAL      everything else
 */
export type WorkloadLevel = 'LOW' | 'NORMAL' | 'HIGH' | 'OVERLOADED'

export interface WorkloadInput {
  active: number
  overdue: number
  dueThisWeek: number
  hoursThisWeek: number
}

export const WORKLOAD_LABELS: Record<WorkloadLevel, string> = {
  LOW: 'Low',
  NORMAL: 'Normal',
  HIGH: 'High',
  OVERLOADED: 'Overloaded',
}

export function workloadLevel(input: WorkloadInput): WorkloadLevel {
  if (input.active >= 8 || input.overdue >= 3 || input.hoursThisWeek > 40) return 'OVERLOADED'
  if (input.active >= 5 || input.overdue >= 1 || input.hoursThisWeek > 30) return 'HIGH'
  if (input.active <= 1 && input.overdue === 0) return 'LOW'
  return 'NORMAL'
}

export function minutesToHours(minutes: number | null | undefined): number | null {
  if (minutes === null || minutes === undefined) return null
  return Math.round((minutes / 60) * 10) / 10
}

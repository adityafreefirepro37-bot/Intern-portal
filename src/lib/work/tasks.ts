import type { TaskPriority, TaskStatus } from '@prisma/client'
import { daysBetween, todayIn, toDateOnly } from '@/lib/interns/dates'

/**
 * Task rules (pure). Enforced by taskLifecycleService; the UI only mirrors them.
 *
 *   BACKLOG ─▶ ASSIGNED ─▶ IN_PROGRESS ─▶ IN_REVIEW ─▶ COMPLETED
 *                              │  ▲            │
 *                              ▼  │            ▼
 *                           BLOCKED     CHANGES_REQUESTED ─▶ IN_PROGRESS / IN_REVIEW (resubmit)
 *
 * IN_REVIEW, CHANGES_REQUESTED and IN_REVIEW → COMPLETED are driven by the
 * submission/review workflow, never by a plain status change.
 */
export const TASK_STATUSES: readonly TaskStatus[] = [
  'BACKLOG',
  'ASSIGNED',
  'IN_PROGRESS',
  'BLOCKED',
  'IN_REVIEW',
  'CHANGES_REQUESTED',
  'COMPLETED',
  'CANCELLED',
]

/** Board columns (cancelled tasks stay visible in lists and history, not on the board). */
export const BOARD_COLUMNS: readonly TaskStatus[] = TASK_STATUSES.filter((status) => status !== 'CANCELLED')

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  BACKLOG: 'Backlog',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In progress',
  BLOCKED: 'Blocked',
  IN_REVIEW: 'In review',
  CHANGES_REQUESTED: 'Changes requested',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
}

export const TASK_PRIORITIES: readonly TaskPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT']
export const PRIORITY_RANK: Record<TaskPriority, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, URGENT: 3 }

export const CLOSED_STATUSES: readonly TaskStatus[] = ['COMPLETED', 'CANCELLED']
/** Work someone is expected to be doing now (excludes backlog and work waiting on a reviewer). */
export const ACTIVE_WORK_STATUSES: readonly TaskStatus[] = ['ASSIGNED', 'IN_PROGRESS', 'BLOCKED', 'CHANGES_REQUESTED']

/** Who may perform a transition: the assignee doing the work, a task lead, or the review workflow. */
export type TransitionActor = 'worker' | 'lead' | 'review'

interface TransitionRule {
  to: TaskStatus
  by: TransitionActor[]
  reason?: boolean
}

const W: TransitionActor = 'worker'
const L: TransitionActor = 'lead'
const R: TransitionActor = 'review'

export const TASK_TRANSITIONS: Record<TaskStatus, TransitionRule[]> = {
  BACKLOG: [
    { to: 'ASSIGNED', by: [L] },
    { to: 'IN_PROGRESS', by: [W, L] },
    { to: 'CANCELLED', by: [L], reason: true },
  ],
  ASSIGNED: [
    { to: 'IN_PROGRESS', by: [W, L] },
    { to: 'BLOCKED', by: [W, L], reason: true },
    { to: 'BACKLOG', by: [L] },
    { to: 'CANCELLED', by: [L], reason: true },
  ],
  IN_PROGRESS: [
    { to: 'BLOCKED', by: [W, L], reason: true },
    { to: 'IN_REVIEW', by: [R] },
    { to: 'COMPLETED', by: [L] },
    { to: 'ASSIGNED', by: [L] },
    { to: 'CANCELLED', by: [L], reason: true },
  ],
  BLOCKED: [
    { to: 'IN_PROGRESS', by: [W, L] },
    { to: 'ASSIGNED', by: [L] },
    { to: 'CANCELLED', by: [L], reason: true },
  ],
  IN_REVIEW: [
    { to: 'CHANGES_REQUESTED', by: [R] },
    { to: 'COMPLETED', by: [R] },
    { to: 'CANCELLED', by: [L], reason: true },
  ],
  CHANGES_REQUESTED: [
    { to: 'IN_PROGRESS', by: [W, L] },
    { to: 'IN_REVIEW', by: [R] },
    { to: 'BLOCKED', by: [W, L], reason: true },
    { to: 'CANCELLED', by: [L], reason: true },
  ],
  COMPLETED: [{ to: 'IN_PROGRESS', by: [L], reason: true }],
  CANCELLED: [{ to: 'BACKLOG', by: [L] }],
}

export function findTransition(from: TaskStatus, to: TaskStatus): TransitionRule | null {
  return TASK_TRANSITIONS[from].find((rule) => rule.to === to) ?? null
}

/** Statuses the given actors may move a task to right now (for menus and drag targets). */
export function allowedTargets(from: TaskStatus, actors: TransitionActor[]): TaskStatus[] {
  return TASK_TRANSITIONS[from].filter((rule) => rule.by.some((by) => actors.includes(by))).map((rule) => rule.to)
}

// ── Deadlines ───────────────────────────────────────────────────────────────

export type DeadlineState =
  'NONE' | 'UPCOMING' | 'DUE_SOON' | 'DUE_TODAY' | 'OVERDUE' | 'COMPLETED_ON_TIME' | 'COMPLETED_LATE'

export interface Deadline {
  state: DeadlineState
  /** Days until due (negative when overdue); null without a due date. */
  days: number | null
}

/**
 * Deadline state from the calendar due date, evaluated in the organization's
 * timezone. Completion is judged against the due date at completion time and
 * never rewritten afterwards.
 */
export function deadlineFor(
  task: { due_date: Date | null; status: TaskStatus; completed_at: Date | null },
  timeZone: string,
  now: Date = new Date(),
): Deadline {
  if (!task.due_date) return { state: 'NONE', days: null }
  const due = toDateOnly(task.due_date)
  const today = todayIn(timeZone, now)
  const days = daysBetween(today, due)
  if (task.status === 'CANCELLED') return { state: 'NONE', days }
  if (task.status === 'COMPLETED') {
    const finished = task.completed_at ? todayIn(timeZone, task.completed_at) : today
    return { state: daysBetween(finished, due) >= 0 ? 'COMPLETED_ON_TIME' : 'COMPLETED_LATE', days }
  }
  if (days < 0) return { state: 'OVERDUE', days }
  if (days === 0) return { state: 'DUE_TODAY', days }
  if (days <= 2) return { state: 'DUE_SOON', days }
  return { state: 'UPCOMING', days }
}

export function describeDeadline(deadline: Deadline): string | null {
  const { state, days } = deadline
  if (days === null) return null
  switch (state) {
    case 'OVERDUE':
      return `Overdue by ${-days} day${days === -1 ? '' : 's'}`
    case 'DUE_TODAY':
      return 'Due today'
    case 'DUE_SOON':
    case 'UPCOMING':
      return days === 1 ? 'Due tomorrow' : `Due in ${days} days`
    case 'COMPLETED_ON_TIME':
      return 'Completed on time'
    case 'COMPLETED_LATE':
      return 'Completed late'
    default:
      return null
  }
}

// ── Progress ────────────────────────────────────────────────────────────────

function pct(done: number, total: number) {
  return total === 0 ? 0 : Math.round((done / total) * 100)
}

/**
 * Task progress: 100 when completed; otherwise completed ÷ non-cancelled
 * subtasks when there are subtasks, else checked ÷ total checklist items,
 * else 0. Status alone never implies partial progress.
 */
export function taskProgress(task: {
  status: TaskStatus
  subtasks?: { status: TaskStatus }[]
  checklist?: { is_completed: boolean }[]
}): number {
  if (task.status === 'COMPLETED') return 100
  const subtasks = (task.subtasks ?? []).filter((s) => s.status !== 'CANCELLED')
  if (subtasks.length > 0) return pct(subtasks.filter((s) => s.status === 'COMPLETED').length, subtasks.length)
  const checklist = task.checklist ?? []
  if (checklist.length > 0) return pct(checklist.filter((i) => i.is_completed).length, checklist.length)
  return 0
}

/**
 * Project / milestone progress: completed ÷ non-cancelled **top-level** tasks
 * (subtasks are excluded so work is never counted twice).
 */
export function workProgress(tasks: { status: TaskStatus; parent_task_id: string | null }[]): {
  total: number
  completed: number
  percent: number
} {
  const counted = tasks.filter((t) => t.parent_task_id === null && t.status !== 'CANCELLED')
  const completed = counted.filter((t) => t.status === 'COMPLETED').length
  return { total: counted.length, completed, percent: pct(completed, counted.length) }
}

// ── Structure ───────────────────────────────────────────────────────────────

/** Tasks nest at most two levels: a task and its subtasks. */
export const MAX_TASK_DEPTH = 2

export function canNestUnder(
  parent: { id: string; parent_task_id: string | null },
  child: { id: string | null; hasSubtasks: boolean },
): string | null {
  if (child.id && parent.id === child.id) return 'A task can’t be its own subtask'
  if (parent.parent_task_id) return 'Subtasks can’t have subtasks of their own'
  if (child.hasSubtasks) return 'A task with subtasks can’t become a subtask'
  return null
}

/**
 * Would adding "task depends on dependsOn" create a cycle? `edges` maps a
 * task to the tasks it depends on. A cycle exists if `task` is reachable
 * from `dependsOn` by following dependencies.
 */
export function createsCycle(edges: ReadonlyMap<string, readonly string[]>, task: string, dependsOn: string): boolean {
  if (task === dependsOn) return true
  const seen = new Set<string>()
  const stack = [dependsOn]
  while (stack.length > 0) {
    const current = stack.pop()!
    if (current === task) return true
    if (seen.has(current)) continue
    seen.add(current)
    for (const next of edges.get(current) ?? []) stack.push(next)
  }
  return false
}

import { parseDateOnly } from '@/lib/interns/dates'
import {
  canTransitionProject,
  milestoneDisplayStatus,
  PROJECT_TRANSITIONS,
  projectTransitionNeedsReason,
} from '@/lib/work/projects'
import { canReview, nextSubmission } from '@/lib/work/submissions'
import {
  allowedTargets,
  canNestUnder,
  createsCycle,
  deadlineFor,
  describeDeadline,
  findTransition,
  TASK_STATUSES,
  taskProgress,
  workProgress,
} from '@/lib/work/tasks'
import { workloadLevel } from '@/lib/work/workload'
import { extractMentionIds } from '@/server/services/task-collaboration.service'
import { createTaskSchema, taskQuerySchema, updateTaskSchema } from '@/server/services/task.service'
import { createProjectSchema } from '@/server/services/project.service'

const d = parseDateOnly
const TZ = 'Asia/Kolkata'
const at = (iso: string) => new Date(iso)

describe('task lifecycle', () => {
  it('lets workers start, block and resume, but never complete or review their own work', () => {
    expect(allowedTargets('ASSIGNED', ['worker'])).toEqual(['IN_PROGRESS', 'BLOCKED'])
    expect(allowedTargets('BLOCKED', ['worker'])).toEqual(['IN_PROGRESS'])
    expect(allowedTargets('IN_PROGRESS', ['worker'])).toEqual(['BLOCKED'])
    expect(allowedTargets('IN_REVIEW', ['worker'])).toEqual([])
    expect(allowedTargets('COMPLETED', ['worker'])).toEqual([])
  })

  it('lets leads assign, cancel, complete directly and reopen', () => {
    expect(allowedTargets('BACKLOG', ['lead'])).toEqual(
      expect.arrayContaining(['ASSIGNED', 'IN_PROGRESS', 'CANCELLED']),
    )
    expect(allowedTargets('IN_PROGRESS', ['lead'])).toContain('COMPLETED')
    expect(allowedTargets('COMPLETED', ['lead'])).toEqual(['IN_PROGRESS'])
    expect(allowedTargets('CANCELLED', ['lead'])).toEqual(['BACKLOG'])
  })

  it('reserves IN_REVIEW, CHANGES_REQUESTED and approval for the review workflow', () => {
    expect(findTransition('IN_PROGRESS', 'IN_REVIEW')?.by).toEqual(['review'])
    expect(findTransition('IN_REVIEW', 'CHANGES_REQUESTED')?.by).toEqual(['review'])
    expect(findTransition('IN_REVIEW', 'COMPLETED')?.by).toEqual(['review'])
    for (const status of TASK_STATUSES) {
      expect(allowedTargets(status, ['worker', 'lead'])).not.toContain('IN_REVIEW')
      expect(allowedTargets(status, ['worker', 'lead'])).not.toContain('CHANGES_REQUESTED')
    }
  })

  it('requires reasons for blocking, cancelling and reopening; rejects undefined moves', () => {
    expect(findTransition('IN_PROGRESS', 'BLOCKED')?.reason).toBe(true)
    expect(findTransition('ASSIGNED', 'CANCELLED')?.reason).toBe(true)
    expect(findTransition('COMPLETED', 'IN_PROGRESS')?.reason).toBe(true)
    expect(findTransition('ASSIGNED', 'IN_PROGRESS')?.reason).toBeUndefined()
    expect(findTransition('BACKLOG', 'COMPLETED')).toBeNull()
    expect(findTransition('CANCELLED', 'COMPLETED')).toBeNull()
  })
})

describe('deadlines (organization timezone)', () => {
  const task = (
    due: string | null,
    status: 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' = 'IN_PROGRESS',
    completedAt?: string,
  ) => ({
    due_date: due ? d(due) : null,
    status,
    completed_at: completedAt ? at(completedAt) : null,
  })

  it('classifies open tasks relative to today', () => {
    const now = at('2026-09-29T06:00:00Z') // 11:30 IST on 29 Sep
    expect(deadlineFor(task('2026-09-28'), TZ, now)).toEqual({ state: 'OVERDUE', days: -1 })
    expect(deadlineFor(task('2026-09-29'), TZ, now).state).toBe('DUE_TODAY')
    expect(deadlineFor(task('2026-10-01'), TZ, now).state).toBe('DUE_SOON')
    expect(deadlineFor(task('2026-10-10'), TZ, now).state).toBe('UPCOMING')
    expect(deadlineFor(task(null), TZ, now).state).toBe('NONE')
    expect(deadlineFor(task('2026-09-01', 'CANCELLED'), TZ, now).state).toBe('NONE')
  })

  it('uses the organization’s calendar day, not UTC', () => {
    // 20:00 UTC on 28 Sep is already 29 Sep in India, so a task due 28 Sep is overdue there.
    const now = at('2026-09-28T20:00:00Z')
    expect(deadlineFor(task('2026-09-28'), TZ, now).state).toBe('OVERDUE')
    expect(deadlineFor(task('2026-09-28'), 'America/New_York', now).state).toBe('DUE_TODAY')
  })

  it('judges completion against the due date and never changes afterwards', () => {
    const later = at('2026-12-01T06:00:00Z')
    expect(deadlineFor(task('2026-09-30', 'COMPLETED', '2026-09-30T15:00:00Z'), TZ, later).state).toBe(
      'COMPLETED_ON_TIME',
    )
    // 20:00 UTC on 30 Sep is 1 Oct in India → late.
    expect(deadlineFor(task('2026-09-30', 'COMPLETED', '2026-09-30T20:00:00Z'), TZ, later).state).toBe('COMPLETED_LATE')
    expect(describeDeadline({ state: 'OVERDUE', days: -3 })).toBe('Overdue by 3 days')
    expect(describeDeadline({ state: 'DUE_SOON', days: 1 })).toBe('Due tomorrow')
  })
})

describe('progress', () => {
  it('task progress: subtasks first, then checklist, never implied by status', () => {
    expect(taskProgress({ status: 'IN_PROGRESS' })).toBe(0)
    expect(taskProgress({ status: 'COMPLETED' })).toBe(100)
    expect(taskProgress({ status: 'IN_PROGRESS', checklist: [{ is_completed: true }, { is_completed: false }] })).toBe(
      50,
    )
    expect(
      taskProgress({
        status: 'IN_PROGRESS',
        subtasks: [{ status: 'COMPLETED' }, { status: 'CANCELLED' }, { status: 'IN_PROGRESS' }],
        checklist: [{ is_completed: true }],
      }),
    ).toBe(50)
  })

  it('project progress counts top-level, non-cancelled tasks only (no double counting)', () => {
    expect(
      workProgress([
        { status: 'COMPLETED', parent_task_id: null },
        { status: 'IN_PROGRESS', parent_task_id: null },
        { status: 'COMPLETED', parent_task_id: 'parent' },
        { status: 'CANCELLED', parent_task_id: null },
      ]),
    ).toEqual({ total: 2, completed: 1, percent: 50 })
    expect(workProgress([])).toEqual({ total: 0, completed: 0, percent: 0 })
  })
})

describe('structure', () => {
  it('limits nesting to two levels', () => {
    expect(canNestUnder({ id: 'a', parent_task_id: null }, { id: null, hasSubtasks: false })).toBeNull()
    expect(canNestUnder({ id: 'a', parent_task_id: 'root' }, { id: null, hasSubtasks: false })).toMatch(
      /Subtasks can’t/,
    )
    expect(canNestUnder({ id: 'a', parent_task_id: null }, { id: 'b', hasSubtasks: true })).toMatch(/with subtasks/)
    expect(canNestUnder({ id: 'a', parent_task_id: null }, { id: 'a', hasSubtasks: false })).toMatch(/own subtask/)
  })

  it('detects self, direct and transitive dependency cycles', () => {
    const edges = new Map([
      ['B', ['A']],
      ['C', ['B']],
    ])
    expect(createsCycle(edges, 'A', 'A')).toBe(true)
    expect(createsCycle(edges, 'A', 'B')).toBe(true) // B already depends on A
    expect(createsCycle(edges, 'A', 'C')).toBe(true) // C → B → A
    expect(createsCycle(edges, 'C', 'A')).toBe(false)
    expect(createsCycle(edges, 'D', 'C')).toBe(false)
  })
})

describe('workload levels', () => {
  const base = { active: 2, overdue: 0, dueThisWeek: 1, hoursThisWeek: 10 }
  it('applies the documented thresholds', () => {
    expect(workloadLevel(base)).toBe('NORMAL')
    expect(workloadLevel({ ...base, active: 1 })).toBe('LOW')
    expect(workloadLevel({ ...base, overdue: 1 })).toBe('HIGH')
    expect(workloadLevel({ ...base, active: 5 })).toBe('HIGH')
    expect(workloadLevel({ ...base, hoursThisWeek: 31 })).toBe('HIGH')
    expect(workloadLevel({ ...base, overdue: 3 })).toBe('OVERLOADED')
    expect(workloadLevel({ ...base, active: 8 })).toBe('OVERLOADED')
    expect(workloadLevel({ ...base, hoursThisWeek: 41 })).toBe('OVERLOADED')
  })
})

describe('submissions', () => {
  it('first submit, resubmit after changes, and no double submission', () => {
    expect(nextSubmission(null)).toEqual({ ok: true, status: 'SUBMITTED' })
    expect(nextSubmission('CHANGES_REQUESTED')).toEqual({ ok: true, status: 'RESUBMITTED' })
    expect(nextSubmission('APPROVED')).toEqual({ ok: true, status: 'RESUBMITTED' })
    expect(nextSubmission('SUBMITTED').ok).toBe(false)
    expect(nextSubmission('RESUBMITTED').ok).toBe(false)
    expect(canReview('SUBMITTED')).toBe(true)
    expect(canReview('RESUBMITTED')).toBe(true)
    expect(canReview('APPROVED')).toBe(false)
    expect(canReview(null)).toBe(false)
  })
})

describe('projects and milestones', () => {
  it('follows the project lifecycle', () => {
    expect(canTransitionProject('PLANNING', 'ACTIVE')).toBe(true)
    expect(canTransitionProject('ACTIVE', 'ON_HOLD')).toBe(true)
    expect(canTransitionProject('ON_HOLD', 'ACTIVE')).toBe(true)
    expect(canTransitionProject('ACTIVE', 'COMPLETED')).toBe(true)
    expect(canTransitionProject('COMPLETED', 'ARCHIVED')).toBe(true)
    expect(canTransitionProject('PLANNING', 'COMPLETED')).toBe(false)
    expect(PROJECT_TRANSITIONS.ARCHIVED).toHaveLength(0)
    expect(projectTransitionNeedsReason('ACTIVE', 'CANCELLED')).toBe(true)
    expect(projectTransitionNeedsReason('COMPLETED', 'ACTIVE')).toBe(true)
    expect(projectTransitionNeedsReason('PLANNING', 'ACTIVE')).toBe(false)
  })

  it('derives OVERDUE for open milestones past their due date', () => {
    const now = at('2026-09-29T06:00:00Z')
    expect(milestoneDisplayStatus({ status: 'ACTIVE', due_date: d('2026-09-28') }, TZ, now)).toBe('OVERDUE')
    expect(milestoneDisplayStatus({ status: 'UPCOMING', due_date: d('2026-10-28') }, TZ, now)).toBe('UPCOMING')
    expect(milestoneDisplayStatus({ status: 'COMPLETED', due_date: d('2026-09-01') }, TZ, now)).toBe('COMPLETED')
  })
})

describe('input validation', () => {
  const id = '0b7e7b0a-2c1e-4f8e-9a5b-1a2b3c4d5e6f'
  it('rejects unknown fields (status, organization, creator) and bad dates', () => {
    const valid = { title: 'Design hero', priority: 'HIGH', assigneeIds: [id] }
    expect(createTaskSchema.safeParse(valid).success).toBe(true)
    for (const smuggled of [{ status: 'COMPLETED' }, { organizationId: id }, { createdBy: id }, { progress: 100 }]) {
      expect(createTaskSchema.safeParse({ ...valid, ...smuggled }).success).toBe(false)
    }
    expect(createTaskSchema.safeParse({ ...valid, startDate: '2026-10-05', dueDate: '2026-10-01' }).success).toBe(false)
    expect(createTaskSchema.safeParse({ ...valid, assigneeIds: ['not-a-uuid'] }).success).toBe(false)
    expect(updateTaskSchema.safeParse({ title: 'x', priority: 'LOW' }).success).toBe(false)
    expect(createProjectSchema.safeParse({ name: 'Brand', ownerId: id }).success).toBe(false)
    expect(
      createProjectSchema.safeParse({ name: 'Brand', startDate: '2026-10-05', targetEndDate: '2026-10-01' }).success,
    ).toBe(false)
  })

  it('task list query falls back to safe defaults', () => {
    const query = taskQuerySchema.parse({
      status: 'IN_REVIEW,HACKED',
      sort: 'password',
      pageSize: '5000',
      assignee: 'everyone',
    })
    expect(query.status).toEqual(['IN_REVIEW'])
    expect(query).toMatchObject({ sort: 'due', pageSize: 25 })
    expect(query.assignee).toBeUndefined()
  })

  it('extracts mention ids from comment markup only', () => {
    const body = `Hi @[Aanya Sharma](${id}) and @someone — also @[Aanya Sharma](${id}) again`
    expect(extractMentionIds(body)).toEqual([id])
    expect(extractMentionIds('no mentions @[x](not-an-id)')).toEqual([])
  })
})

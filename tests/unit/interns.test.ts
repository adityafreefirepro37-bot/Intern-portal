import { addDays, daysBetween, formatDateOnly, parseDateOnly, todayIn } from '@/lib/interns/dates'
import { formatEmployeeCode, parseEmployeeCode } from '@/lib/interns/employee-code'
import {
  canTransition,
  INTERN_STATUSES,
  internshipStatusFor,
  permissionForTransition,
  requiresReason,
  STATUS_TRANSITIONS,
} from '@/lib/interns/lifecycle'
import { internshipProgress, isOverdue, onboardingProgress } from '@/lib/interns/progress'
import {
  createInternSchema,
  directoryQuerySchema,
  updateOwnInternProfileSchema,
} from '@/server/services/intern.service'
import { transitionSchema } from '@/server/services/intern-lifecycle.service'

const d = parseDateOnly

describe('calendar dates', () => {
  it('computes "today" in the organization timezone, not UTC', () => {
    // 20:00 UTC on 28 Sep is already 29 Sep in India.
    const now = new Date('2026-09-28T20:00:00Z')
    expect(formatDateOnly(todayIn('Asia/Kolkata', now))).toBe('2026-09-29')
    expect(formatDateOnly(todayIn('America/Los_Angeles', now))).toBe('2026-09-28')
  })

  it('adds and counts whole days across month ends', () => {
    expect(formatDateOnly(addDays(d('2026-01-30'), 3))).toBe('2026-02-02')
    expect(daysBetween(d('2026-02-27'), d('2026-03-01'))).toBe(2)
    expect(daysBetween(d('2026-03-01'), d('2026-02-27'))).toBe(-2)
  })
})

describe('employee codes', () => {
  it('formats with prefix and zero padding', () => {
    expect(formatEmployeeCode(1)).toBe('AYV-INT-0001')
    expect(formatEmployeeCode(12345)).toBe('AYV-INT-12345')
    expect(formatEmployeeCode(7, 'X-', 2)).toBe('X-07')
  })
  it('rejects invalid numbers and parses only matching codes', () => {
    expect(() => formatEmployeeCode(0)).toThrow()
    expect(() => formatEmployeeCode(1.5)).toThrow()
    expect(parseEmployeeCode('AYV-INT-0042')).toBe(42)
    expect(parseEmployeeCode('AYV-INT-00A2')).toBeNull()
    expect(parseEmployeeCode('OTHER-0042')).toBeNull()
  })
})

describe('status transitions', () => {
  it('follows the lifecycle and never leaves final states', () => {
    expect(canTransition('SELECTED', 'ONBOARDING')).toBe(true)
    expect(canTransition('ONBOARDING', 'ACTIVE')).toBe(true)
    expect(canTransition('ACTIVE', 'ENDING_SOON')).toBe(true)
    expect(canTransition('ENDING_SOON', 'ACTIVE')).toBe(true)
    expect(canTransition('ACTIVE', 'COMPLETED')).toBe(true)
    expect(canTransition('COMPLETED', 'ALUMNI')).toBe(true)
    expect(canTransition('SELECTED', 'ACTIVE')).toBe(false)
    expect(canTransition('ONBOARDING', 'COMPLETED')).toBe(false)
    expect(canTransition('COMPLETED', 'ACTIVE')).toBe(false)
    expect(STATUS_TRANSITIONS.TERMINATED).toHaveLength(0)
    expect(STATUS_TRANSITIONS.ALUMNI).toHaveLength(0)
  })

  it('every non-final status can be terminated; no status transitions to itself', () => {
    for (const status of INTERN_STATUSES) {
      expect(canTransition(status, status)).toBe(false)
      if (['SELECTED', 'ONBOARDING', 'ACTIVE', 'ENDING_SOON'].includes(status)) {
        expect(canTransition(status, 'TERMINATED')).toBe(true)
      }
    }
  })

  it('closing transitions need internship.complete; termination and extension need a reason', () => {
    expect(permissionForTransition('COMPLETED')).toBe('internship.complete')
    expect(permissionForTransition('TERMINATED')).toBe('internship.complete')
    expect(permissionForTransition('ACTIVE')).toBe('internship.update')
    expect(requiresReason('ACTIVE', 'TERMINATED')).toBe(true)
    expect(requiresReason('ENDING_SOON', 'ACTIVE')).toBe(true)
    expect(requiresReason('ONBOARDING', 'ACTIVE')).toBe(false)
  })

  it('maps intern status to internship status', () => {
    expect(internshipStatusFor('ONBOARDING')).toBe('PLANNED')
    expect(internshipStatusFor('ENDING_SOON')).toBe('ACTIVE')
    expect(internshipStatusFor('ALUMNI')).toBe('COMPLETED')
    expect(internshipStatusFor('TERMINATED')).toBe('CANCELLED')
  })
})

describe('internship progress', () => {
  const base = { start: d('2026-09-01'), expectedEnd: d('2026-09-10'), status: 'ACTIVE' as const }

  it('reports day N of total and percent while in progress', () => {
    const p = internshipProgress({ ...base, today: d('2026-09-05') })
    expect(p).toMatchObject({ state: 'in_progress', day: 5, totalDays: 10, percent: 50, daysRemaining: 5 })
  })

  it('handles upcoming, overrun, finished and terminated internships', () => {
    expect(internshipProgress({ ...base, today: d('2026-08-29') })).toMatchObject({
      state: 'upcoming',
      daysUntilStart: 3,
      percent: 0,
    })
    expect(internshipProgress({ ...base, today: d('2026-09-20') })).toMatchObject({
      day: 10,
      percent: 100,
      daysRemaining: 0,
    })
    expect(internshipProgress({ ...base, status: 'COMPLETED', today: d('2026-09-05') })).toMatchObject({
      state: 'finished',
      percent: 100,
    })
    expect(
      internshipProgress({ ...base, status: 'TERMINATED', actualEnd: d('2026-09-03'), today: d('2026-09-09') }),
    ).toMatchObject({ state: 'ended_early', day: 3, percent: 30 })
  })

  it('never divides by zero: missing dates, same-day and inverted ranges', () => {
    expect(
      internshipProgress({ start: null, expectedEnd: null, status: 'SELECTED', today: d('2026-09-01') }).state,
    ).toBe('not_scheduled')
    expect(
      internshipProgress({
        start: d('2026-09-01'),
        expectedEnd: d('2026-09-01'),
        status: 'ACTIVE',
        today: d('2026-09-01'),
      }),
    ).toMatchObject({
      totalDays: 1,
      percent: 100,
    })
    const inverted = internshipProgress({
      start: d('2026-09-05'),
      expectedEnd: d('2026-09-01'),
      status: 'ACTIVE',
      today: d('2026-09-05'),
    })
    expect(inverted.totalDays).toBe(1)
    expect(Number.isFinite(inverted.percent)).toBe(true)
  })
})

describe('onboarding progress', () => {
  const today = d('2026-09-10')
  const item = (required: boolean, status: 'PENDING' | 'COMPLETED' | 'SKIPPED' | 'BLOCKED', due: string | null) => ({
    required,
    status,
    due_date: due ? d(due) : null,
  })

  it('is overdue only after the due date and only while open', () => {
    expect(isOverdue(item(true, 'PENDING', '2026-09-09'), today)).toBe(true)
    expect(isOverdue(item(true, 'PENDING', '2026-09-10'), today)).toBe(false)
    expect(isOverdue(item(true, 'COMPLETED', '2026-09-01'), today)).toBe(false)
    expect(isOverdue(item(true, 'PENDING', null), today)).toBe(false)
  })

  it('completes when every required item is done or skipped; optional items never block', () => {
    const progress = onboardingProgress(
      [item(true, 'COMPLETED', null), item(true, 'SKIPPED', null), item(false, 'PENDING', '2026-09-01')],
      today,
    )
    expect(progress).toMatchObject({
      requiredTotal: 2,
      requiredDone: 2,
      optionalTotal: 1,
      optionalDone: 0,
      percent: 100,
      complete: true,
      overdue: 1,
    })
  })

  it('counts blocked items and is incomplete while a required item is open', () => {
    const progress = onboardingProgress(
      [item(true, 'COMPLETED', null), item(true, 'BLOCKED', null), item(true, 'PENDING', null)],
      today,
    )
    expect(progress).toMatchObject({ requiredDone: 1, percent: 33, blocked: 1, complete: false })
    expect(onboardingProgress([], today)).toMatchObject({ percent: 100, complete: true })
  })
})

describe('intern schemas (mass-assignment protection)', () => {
  const valid = {
    firstName: 'John',
    lastName: 'Doe',
    email: 'John.Doe@Example.com',
    positionId: '0b7e7b0a-2c1e-4f8e-9a5b-1a2b3c4d5e6f',
    departmentId: '1b7e7b0a-2c1e-4f8e-9a5b-1a2b3c4d5e6f',
    joiningDate: '2026-10-01',
    expectedEndDate: '2026-12-31',
    workMode: 'HYBRID',
  }

  it('accepts a minimal valid intern and normalizes values', () => {
    const parsed = createInternSchema.parse(valid)
    expect(parsed.email).toBe('john.doe@example.com')
    expect(parsed.startOnboarding).toBe(false)
    expect(parsed.teamId).toBeUndefined()
  })

  it('rejects unknown fields such as status, organization or role', () => {
    for (const smuggled of [
      { status: 'ACTIVE' },
      { organizationId: valid.positionId },
      { roleId: valid.positionId },
      { employeeCode: 'X' },
    ]) {
      expect(createInternSchema.safeParse({ ...valid, ...smuggled }).success).toBe(false)
    }
    expect(updateOwnInternProfileSchema.safeParse({ bio: 'hi', status: 'ACTIVE' }).success).toBe(false)
    expect(updateOwnInternProfileSchema.safeParse({ bio: 'hi', managerId: valid.positionId }).success).toBe(false)
  })

  it('validates dates, emergency contacts and transition input', () => {
    expect(createInternSchema.safeParse({ ...valid, expectedEndDate: '2026-09-01' }).success).toBe(false)
    expect(createInternSchema.safeParse({ ...valid, emergencyName: 'Only a name' }).success).toBe(false)
    expect(
      createInternSchema.safeParse({
        ...valid,
        emergencyName: 'A',
        emergencyRelationship: 'Parent',
        emergencyPhone: '+91 90000 00000',
      }).success,
    ).toBe(true)
    expect(transitionSchema.safeParse({ internId: valid.positionId, to: 'NOPE' }).success).toBe(false)
  })

  it('directory query falls back to safe defaults for bad URL params', () => {
    const query = directoryQuerySchema.parse({
      sort: 'password',
      dir: 'sideways',
      page: '-3',
      pageSize: '1000',
      status: 'X',
      department: 'not-a-uuid',
    })
    expect(query).toMatchObject({ sort: 'name', dir: 'asc', page: 1, pageSize: 25 })
    expect(query.status).toBeUndefined()
    expect(query.department).toBeUndefined()
    expect(directoryQuerySchema.parse({ pageSize: '50' }).pageSize).toBe(50)
  })
})

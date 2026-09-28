import type { InternStatus } from '@prisma/client'
import type { PermissionScope } from '@/lib/permissions'
import { addDays, daysBetween, formatDateOnly, parseDateOnly, todayIn, toDateOnly } from '@/lib/interns/dates'
import { formatEmployeeCode, parseEmployeeCode } from '@/lib/interns/employee-code'
import {
  canTransition,
  INTERN_STATUSES,
  internshipStatusFor,
  permissionForTransition,
  requiresReason,
  STATUS_TRANSITIONS,
} from '@/lib/interns/lifecycle'
import { internshipProgress, isOverdue, onboardingProgress, type OnboardingItemLike } from '@/lib/interns/progress'
import type { RequestContext } from '@/server/context'
import { scopeCovers } from '@/server/services/intern-access'
import {
  createInternSchema,
  directoryQuerySchema,
  updateInternSchema,
  updateOwnInternProfileSchema,
} from '@/server/services/intern.service'
import { transitionSchema } from '@/server/services/intern-lifecycle.service'

jest.mock('@/server/repositories/audit.repository', () => ({
  auditRepository: { create: jest.fn().mockResolvedValue({ id: 'x' }) },
}))

const d = parseDateOnly

// ── Employee codes ───────────────────────────────────────────────────────────

describe('employee codes', () => {
  it('formats with the prefix and zero padding', () => {
    expect(formatEmployeeCode(1)).toBe('AYV-INT-0001')
    expect(formatEmployeeCode(42)).toBe('AYV-INT-0042')
    expect(formatEmployeeCode(12345)).toBe('AYV-INT-12345')
    expect(formatEmployeeCode(7, 'ACME-', 3)).toBe('ACME-007')
  })

  it('rejects non-positive or fractional numbers', () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) expect(() => formatEmployeeCode(bad)).toThrow()
  })

  it('parses its own output and ignores other formats', () => {
    expect(parseEmployeeCode(formatEmployeeCode(37))).toBe(37)
    expect(parseEmployeeCode('AYV-INT-00x1')).toBeNull()
    expect(parseEmployeeCode('OTHER-0001')).toBeNull()
    expect(parseEmployeeCode('AYV-INT-')).toBeNull()
  })
})

// ── Status transitions ───────────────────────────────────────────────────────

describe('internship status transitions', () => {
  it('follows the documented happy path', () => {
    const path: InternStatus[] = ['SELECTED', 'ONBOARDING', 'ACTIVE', 'ENDING_SOON', 'COMPLETED', 'ALUMNI']
    for (let i = 0; i < path.length - 1; i += 1) expect(canTransition(path[i], path[i + 1])).toBe(true)
  })

  it('allows administrative termination before completion only', () => {
    for (const from of ['SELECTED', 'ONBOARDING', 'ACTIVE', 'ENDING_SOON'] as InternStatus[]) {
      expect(canTransition(from, 'TERMINATED')).toBe(true)
    }
    for (const from of ['COMPLETED', 'ALUMNI', 'TERMINATED'] as InternStatus[]) {
      expect(canTransition(from, 'TERMINATED')).toBe(false)
    }
  })

  it('blocks skipping steps, going backwards and leaving final states', () => {
    expect(canTransition('SELECTED', 'ACTIVE')).toBe(false)
    expect(canTransition('ONBOARDING', 'COMPLETED')).toBe(false)
    expect(canTransition('ACTIVE', 'ONBOARDING')).toBe(false)
    expect(canTransition('COMPLETED', 'ACTIVE')).toBe(false)
    expect(STATUS_TRANSITIONS.ALUMNI).toEqual([])
    expect(STATUS_TRANSITIONS.TERMINATED).toEqual([])
  })

  it('never allows a no-op transition', () => {
    for (const status of INTERN_STATUSES) expect(canTransition(status, status)).toBe(false)
  })

  it('needs the stronger permission to close an internship', () => {
    expect(permissionForTransition('ONBOARDING')).toBe('internship.update')
    expect(permissionForTransition('ACTIVE')).toBe('internship.update')
    expect(permissionForTransition('COMPLETED')).toBe('internship.complete')
    expect(permissionForTransition('ALUMNI')).toBe('internship.complete')
    expect(permissionForTransition('TERMINATED')).toBe('internship.complete')
  })

  it('requires a reason for termination and for extending an ending internship', () => {
    expect(requiresReason('ACTIVE', 'TERMINATED')).toBe(true)
    expect(requiresReason('ENDING_SOON', 'ACTIVE')).toBe(true)
    expect(requiresReason('ONBOARDING', 'ACTIVE')).toBe(false)
  })

  it('maps intern statuses onto the internship record', () => {
    expect(internshipStatusFor('SELECTED')).toBe('PLANNED')
    expect(internshipStatusFor('ONBOARDING')).toBe('PLANNED')
    expect(internshipStatusFor('ENDING_SOON')).toBe('ACTIVE')
    expect(internshipStatusFor('ALUMNI')).toBe('COMPLETED')
    expect(internshipStatusFor('TERMINATED')).toBe('CANCELLED')
  })
})

// ── Dates ────────────────────────────────────────────────────────────────────

describe('calendar dates', () => {
  it('computes "today" in the organization timezone, not UTC', () => {
    // 20:00 UTC on 1 March is already 2 March in India (UTC+5:30).
    const now = new Date('2026-03-01T20:00:00Z')
    expect(formatDateOnly(todayIn('Asia/Kolkata', now))).toBe('2026-03-02')
    expect(formatDateOnly(todayIn('UTC', now))).toBe('2026-03-01')
    expect(formatDateOnly(todayIn('America/Los_Angeles', now))).toBe('2026-03-01')
  })

  it('counts whole days regardless of time of day', () => {
    expect(daysBetween(new Date('2026-01-01T23:59:00Z'), new Date('2026-01-02T00:01:00Z'))).toBe(1)
    expect(daysBetween(d('2026-01-10'), d('2026-01-01'))).toBe(-9)
    expect(formatDateOnly(addDays(d('2026-02-27'), 2))).toBe('2026-03-01')
    expect(toDateOnly(new Date('2026-05-05T13:00:00Z')).toISOString()).toBe('2026-05-05T00:00:00.000Z')
  })
})

// ── Internship progress ──────────────────────────────────────────────────────

describe('internship progress', () => {
  const start = d('2026-01-01')
  const end = d('2026-03-31') // 90 days inclusive

  it('reports day N of the internship and a percentage', () => {
    const progress = internshipProgress({ start, expectedEnd: end, status: 'ACTIVE', today: d('2026-02-01') })
    expect(progress).toMatchObject({ state: 'in_progress', day: 32, totalDays: 90, percent: 36, daysRemaining: 58 })
  })

  it('handles a future start without negative values', () => {
    const progress = internshipProgress({ start, expectedEnd: end, status: 'SELECTED', today: d('2025-12-25') })
    expect(progress).toMatchObject({ state: 'upcoming', day: 0, percent: 0, daysUntilStart: 7 })
  })

  it('handles same-day internships without dividing by zero', () => {
    const progress = internshipProgress({ start, expectedEnd: start, status: 'ACTIVE', today: start })
    expect(progress).toMatchObject({ day: 1, totalDays: 1, percent: 100 })
  })

  it('caps progress after the end date while still active', () => {
    const progress = internshipProgress({ start, expectedEnd: end, status: 'ENDING_SOON', today: d('2026-05-01') })
    expect(progress).toMatchObject({ day: 90, percent: 100, daysRemaining: 0 })
  })

  it('reports completed internships as finished', () => {
    const progress = internshipProgress({ start, expectedEnd: end, status: 'COMPLETED', today: d('2026-02-01') })
    expect(progress).toMatchObject({ state: 'finished', percent: 100 })
  })

  it('reports terminated internships at the day they stopped', () => {
    const progress = internshipProgress({
      start,
      expectedEnd: end,
      actualEnd: d('2026-01-10'),
      status: 'TERMINATED',
      today: d('2026-03-01'),
    })
    expect(progress).toMatchObject({ state: 'ended_early', day: 10, percent: 11 })
  })

  it('treats an end date before the start as a one-day internship', () => {
    const progress = internshipProgress({ start, expectedEnd: d('2025-12-01'), status: 'ACTIVE', today: start })
    expect(progress.totalDays).toBe(1)
    expect(progress.percent).toBeGreaterThanOrEqual(0)
  })

  it('reports missing dates as not scheduled', () => {
    expect(internshipProgress({ start: null, expectedEnd: end, status: 'SELECTED', today: start }).state).toBe(
      'not_scheduled',
    )
  })
})

// ── Onboarding progress and overdue ──────────────────────────────────────────

describe('onboarding progress', () => {
  const today = d('2026-01-10')
  const item = (overrides: Partial<OnboardingItemLike>): OnboardingItemLike => ({
    required: true,
    status: 'PENDING',
    due_date: null,
    ...overrides,
  })

  it('counts only required items towards the percentage', () => {
    const progress = onboardingProgress(
      [
        ...Array.from({ length: 8 }, () => item({ status: 'COMPLETED' })),
        item({}),
        item({}),
        item({ required: false }),
        item({ required: false, status: 'COMPLETED' }),
      ],
      today,
    )
    expect(progress).toMatchObject({ requiredDone: 8, requiredTotal: 10, percent: 80, optionalTotal: 2, optionalDone: 1 })
    expect(progress.complete).toBe(false)
  })

  it('is complete when every required item is done, even with optional items open', () => {
    const progress = onboardingProgress([item({ status: 'COMPLETED' }), item({ required: false })], today)
    expect(progress.complete).toBe(true)
    expect(progress.percent).toBe(100)
  })

  it('counts a waived (skipped) required item as resolved', () => {
    expect(onboardingProgress([item({ status: 'SKIPPED' })], today).complete).toBe(true)
  })

  it('reports 100% with nothing required', () => {
    expect(onboardingProgress([], today)).toMatchObject({ percent: 100, complete: true })
  })

  it('marks items overdue only after the due date passes, and never once done', () => {
    expect(isOverdue({ status: 'PENDING', due_date: d('2026-01-09') }, today)).toBe(true)
    expect(isOverdue({ status: 'PENDING', due_date: d('2026-01-10') }, today)).toBe(false)
    expect(isOverdue({ status: 'IN_PROGRESS', due_date: d('2026-01-01') }, today)).toBe(true)
    expect(isOverdue({ status: 'BLOCKED', due_date: d('2026-01-01') }, today)).toBe(true)
    expect(isOverdue({ status: 'COMPLETED', due_date: d('2026-01-01') }, today)).toBe(false)
    expect(isOverdue({ status: 'SKIPPED', due_date: d('2026-01-01') }, today)).toBe(false)
    expect(isOverdue({ status: 'PENDING', due_date: null }, today)).toBe(false)
  })

  it('counts overdue and blocked items', () => {
    const progress = onboardingProgress(
      [item({ due_date: d('2026-01-01') }), item({ status: 'BLOCKED' }), item({ status: 'COMPLETED', due_date: d('2026-01-01') })],
      today,
    )
    expect(progress).toMatchObject({ overdue: 1, blocked: 1 })
  })
})

// ── Validation schemas (mass assignment) ─────────────────────────────────────

const UUID = '3f2b9f4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b'
const validIntern = {
  firstName: 'John',
  lastName: 'Doe',
  email: 'John.Doe@Example.com',
  positionId: UUID,
  departmentId: UUID,
  joiningDate: '2026-01-01',
  expectedEndDate: '2026-03-31',
  workMode: 'HYBRID',
}

describe('intern validation schemas', () => {
  it('accepts a minimal valid intern and normalizes the email', () => {
    const parsed = createInternSchema.parse(validIntern)
    expect(parsed.email).toBe('john.doe@example.com')
    expect(parsed.startOnboarding).toBe(false)
    expect(parsed.teamId).toBeUndefined()
  })

  it('rejects privileged or unknown fields (mass assignment)', () => {
    for (const smuggled of [
      { role: 'SUPER_ADMIN' },
      { organization_id: UUID },
      { organizationId: UUID },
      { permissions: ['user.manage'] },
      { employeeCode: 'AYV-INT-9999' },
      { status: 'ACTIVE' },
    ]) {
      expect(createInternSchema.safeParse({ ...validIntern, ...smuggled }).success).toBe(false)
    }
  })

  it('rejects an end date before the joining date', () => {
    const result = createInternSchema.safeParse({ ...validIntern, expectedEndDate: '2025-12-31' })
    expect(result.success).toBe(false)
  })

  it('requires the emergency contact’s name, relationship and phone together', () => {
    expect(createInternSchema.safeParse({ ...validIntern, emergencyName: 'Jane Doe' }).success).toBe(false)
    expect(
      createInternSchema.safeParse({
        ...validIntern,
        emergencyName: 'Jane Doe',
        emergencyRelationship: 'Parent',
        emergencyPhone: '+91 98450 12345',
      }).success,
    ).toBe(true)
  })

  it('HR updates cannot change the email, status, manager or organization', () => {
    const base = { ...validIntern, email: undefined }
    delete base.email
    expect(updateInternSchema.safeParse(base).success).toBe(true)
    for (const smuggled of [{ email: 'x@y.z' }, { status: 'ACTIVE' }, { managerId: UUID }, { organizationId: UUID }]) {
      expect(updateInternSchema.safeParse({ ...base, ...smuggled }).success).toBe(false)
    }
  })

  it('interns may edit only their contact and bio fields', () => {
    expect(updateOwnInternProfileSchema.safeParse({ phone: '+91 98450 12345', bio: 'Hello' }).success).toBe(true)
    for (const smuggled of [
      { departmentId: UUID },
      { managerId: UUID },
      { mentorId: UUID },
      { employeeCode: 'X' },
      { joiningDate: '2026-01-01' },
      { status: 'ACTIVE' },
      { role: 'admin' },
    ]) {
      expect(updateOwnInternProfileSchema.safeParse(smuggled).success).toBe(false)
    }
  })

  it('status transitions accept only known statuses and ids', () => {
    expect(transitionSchema.safeParse({ internId: UUID, to: 'ACTIVE' }).success).toBe(true)
    expect(transitionSchema.safeParse({ internId: UUID, to: 'PROMOTED' }).success).toBe(false)
    expect(transitionSchema.safeParse({ internId: 'not-an-id', to: 'ACTIVE' }).success).toBe(false)
    expect(transitionSchema.safeParse({ internId: UUID, to: 'ACTIVE', organizationId: UUID }).success).toBe(false)
  })

  it('directory query params fall back to safe defaults instead of failing', () => {
    const parsed = directoryQuerySchema.parse({
      status: 'NOPE',
      department: "1' OR '1'='1",
      sort: 'password',
      dir: 'sideways',
      page: '-3',
      pageSize: '5000',
    })
    expect(parsed).toMatchObject({ status: undefined, department: undefined, sort: 'name', dir: 'asc', page: 1, pageSize: 25 })
    expect(directoryQuerySchema.parse({ pageSize: '50', page: '2', sort: 'end', dir: 'desc' })).toMatchObject({
      pageSize: 50,
      page: 2,
      sort: 'end',
      dir: 'desc',
    })
  })
})

// ── Scope decisions ──────────────────────────────────────────────────────────

describe('intern scope coverage', () => {
  const ORG = '11111111-1111-4111-8111-111111111111'
  const ME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

  const ctx = (scope: PermissionScope, extra: { ledTeamIds?: string[]; headedDepartmentIds?: string[] } = {}) =>
    ({
      organization: { id: ORG },
      actor: {
        userId: ME,
        organizationId: ORG,
        permissions: new Map([['intern.read', scope]]),
        ledTeamIds: extra.ledTeamIds ?? [],
        headedDepartmentIds: extra.headedDepartmentIds ?? [],
      },
    }) as unknown as RequestContext

  const record = (overrides: Partial<{ user_id: string; manager_id: string | null; mentor_id: string | null; team_id: string | null; department_id: string | null; organization_id: string }> = {}) => ({
    user_id: OTHER,
    manager_id: null,
    mentor_id: null,
    team_id: null,
    department_id: null,
    organization_id: ORG,
    ...overrides,
  })

  it('OWN covers only the intern themself', () => {
    expect(scopeCovers(ctx('OWN'), 'intern.read', record({ user_id: ME }))).toBe(true)
    expect(scopeCovers(ctx('OWN'), 'intern.read', record({ manager_id: ME }))).toBe(false)
  })

  it('ASSIGNED covers interns the actor manages or mentors (manager_id = me)', () => {
    expect(scopeCovers(ctx('ASSIGNED'), 'intern.read', record({ manager_id: ME }))).toBe(true)
    expect(scopeCovers(ctx('ASSIGNED'), 'intern.read', record({ mentor_id: ME }))).toBe(true)
    expect(scopeCovers(ctx('ASSIGNED'), 'intern.read', record())).toBe(false)
  })

  it('TEAM and DEPARTMENT scopes follow led teams and headed departments', () => {
    expect(scopeCovers(ctx('TEAM', { ledTeamIds: ['t1'] }), 'intern.read', record({ team_id: 't1' }))).toBe(true)
    expect(scopeCovers(ctx('TEAM', { ledTeamIds: ['t1'] }), 'intern.read', record({ team_id: 't2' }))).toBe(false)
    expect(scopeCovers(ctx('DEPARTMENT', { headedDepartmentIds: ['d1'] }), 'intern.read', record({ department_id: 'd1' }))).toBe(true)
  })

  it('ORGANIZATION covers everyone in the organization but never another organization', () => {
    expect(scopeCovers(ctx('ORGANIZATION'), 'intern.read', record())).toBe(true)
    expect(scopeCovers(ctx('ORGANIZATION'), 'intern.read', record({ organization_id: '22222222-2222-4222-8222-222222222222' }))).toBe(false)
  })

  it('a missing permission covers nothing', () => {
    expect(scopeCovers(ctx('ORGANIZATION'), 'intern.update', record({ user_id: ME }))).toBe(false)
  })
})

import { ForbiddenError } from '@/lib/errors'
import type { RequestContext } from '@/server/context'
import { analyticsService } from '@/server/services/analytics.service'
import { AUDIT_ACTIONS } from '@/server/services/audit-actions'
import { contextFor, prisma } from './helpers'

let hr: RequestContext
let manager: RequestContext
let intern: RequestContext

beforeAll(async () => {
  ;[hr, manager, intern] = await Promise.all([
    contextFor('hr@ayavacreatives.com'),
    contextFor('manager@ayavacreatives.com'),
    contextFor('intern@ayavacreatives.com'),
  ])
})

describe('programme analytics', () => {
  it('summarises every intern for HR, by month, with consistent totals', async () => {
    const data = await analyticsService.overview(hr, analyticsService.parseFilters({ months: '12' }))
    expect(data.months).toHaveLength(12)
    expect(data.scope).toBe('ORGANIZATION')
    expect(data.orgWide).toBe(true)
    const interns = await prisma.intern.count({ where: { organization_id: hr.organization.id, deleted_at: null, status: { not: 'SELECTED' } } })
    expect(data.internCount).toBe(interns)
    expect(data.pipeline.byStatus.reduce((n, s) => n + s.value, 0)).toBe(interns)
    // Series and totals agree.
    expect(data.work.completedByMonth.reduce((a, b) => a + b, 0)).toBe(data.work.completed)
    expect(data.work.createdByMonth.reduce((a, b) => a + b, 0)).toBe(data.work.created)
    expect(data.pipeline.joinedByMonth.reduce((a, b) => a + b, 0)).toBe(data.pipeline.joined)
    for (const r of [data.work.onTimeRate, data.attendance.rate, data.learning.completionRate]) {
      if (r !== null) expect(r).toBeGreaterThanOrEqual(0), expect(r).toBeLessThanOrEqual(100)
    }
    // Seeded data has tasks and attendance for interns.
    expect(data.work.created + data.work.completed).toBeGreaterThan(0)
    expect(data.attendance.rate).not.toBeNull()
    expect(data.communication).not.toBeNull()
  })

  it('limits managers to the interns they manage and hides organization-wide figures', async () => {
    const data = await analyticsService.overview(manager, analyticsService.parseFilters({}))
    const managed = await prisma.intern.count({
      where: { organization_id: manager.organization.id, deleted_at: null, status: { not: 'SELECTED' }, manager_id: manager.actor.userId },
    })
    const mentoredOnly = await prisma.intern.count({
      where: {
        organization_id: manager.organization.id,
        deleted_at: null,
        status: { not: 'SELECTED' },
        mentor_id: manager.actor.userId,
        NOT: { manager_id: manager.actor.userId },
      },
    })
    expect(data.scope).toBe('ASSIGNED')
    expect(data.internCount).toBe(managed + mentoredOnly)
    expect(data.communication).toBeNull()
    // No export for managers.
    await expect(analyticsService.exportCsv(manager, analyticsService.parseFilters({}))).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('narrows to a department and refuses people without analytics access', async () => {
    const department = await prisma.department.findFirstOrThrow({
      where: { organization_id: hr.organization.id, interns: { some: { deleted_at: null } } },
      select: { id: true },
    })
    const all = await analyticsService.overview(hr, analyticsService.parseFilters({}))
    const filtered = await analyticsService.overview(hr, analyticsService.parseFilters({ departmentId: department.id }))
    expect(filtered.internCount).toBeLessThanOrEqual(all.internCount)
    expect(filtered.internCount).toBe(
      await prisma.intern.count({ where: { department_id: department.id, deleted_at: null, status: { not: 'SELECTED' } } }),
    )
    expect(filtered.communication).toBeNull()
    // Unknown filter values are ignored rather than failing.
    expect(analyticsService.parseFilters({ months: '7', departmentId: 'nope' })).toEqual({ months: 6, departmentId: undefined, teamId: undefined })
    await expect(analyticsService.overview(intern, analyticsService.parseFilters({}))).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('exports the monthly table as CSV and records the export', async () => {
    const { filename, body } = await analyticsService.exportCsv(hr, analyticsService.parseFilters({ months: '3' }))
    const lines = body.trim().split('\r\n')
    expect(lines[0]).toBe(
      'Month,Interns joined,Internships completed,Tasks created,Tasks completed,Submissions reviewed,Attendance rate %,Late arrivals,Leave days,Courses completed,Meetings,Messages',
    )
    expect(lines).toHaveLength(4)
    expect(filename).toMatch(/^analytics-\d{4}-\d{2}-to-\d{4}-\d{2}\.csv$/)
    expect(
      await prisma.auditLog.count({ where: { action: AUDIT_ACTIONS.EXPORT_GENERATED, resource_type: 'analytics', actor_user_id: hr.actor.userId } }),
    ).toBeGreaterThan(0)
  })
})

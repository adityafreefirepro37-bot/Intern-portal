import { PrismaClient } from '@prisma/client'
import { ForbiddenError } from '@/lib/errors'
import { ALL_PERMISSIONS, DEFAULT_ROLE_GRANTS } from '@/lib/permissions'
import { auditService } from '@/server/services/audit.service'
import { dashboardService } from '@/server/services/dashboard.service'
import { internService } from '@/server/services/intern.service'
import { projectService } from '@/server/services/project.service'
import { searchService } from '@/server/services/search.service'
import { taskService } from '@/server/services/task.service'
import { AYAVA_ORGANIZATION_ID } from '../../prisma/seed/ids'
import { seedDemo } from '../../prisma/seed/demo'
import { seedReference } from '../../prisma/seed/reference'
import { contextFor, prisma, uniqueSuffix } from './helpers'

afterAll(() => prisma.$disconnect())

describe('database-driven RBAC', () => {
  it('resolves each seeded role to its catalog grants and scopes', async () => {
    const admin = await contextFor('admin@ayavacreatives.com')
    expect([...admin.actor.permissions.keys()].sort()).toEqual([...ALL_PERMISSIONS].sort())
    expect(admin.actor.rank).toBe(100)

    const intern = await contextFor('intern@ayavacreatives.com')
    expect(Object.fromEntries(intern.actor.permissions)).toEqual(DEFAULT_ROLE_GRANTS.intern)
    expect(intern.actor.rank).toBe(10)
  })

  it('enforces permissions inside services', async () => {
    const intern = await contextFor('intern@ayavacreatives.com')
    await expect(internService.list(intern, { page: 1, pageSize: 10 })).rejects.toBeInstanceOf(ForbiddenError)
    await expect(auditService.listPage(intern, { page: 1, pageSize: 10 })).rejects.toBeInstanceOf(ForbiddenError)

    const mentor = await contextFor('mentor@ayavacreatives.com')
    await expect(taskService.countPendingReviews(mentor)).resolves.toBeGreaterThanOrEqual(0)
    await expect(auditService.listPage(mentor, { page: 1, pageSize: 10 })).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('reflects permission changes stored in the database without a deploy', async () => {
    const role = await prisma.role.findFirstOrThrow({
      where: { organization_id: AYAVA_ORGANIZATION_ID, slug: 'mentor' },
    })
    const permission = await prisma.permission.findFirstOrThrow({ where: { resource: 'audit_log', action: 'read' } })
    await prisma.rolePermission.create({ data: { role_id: role.id, permission_id: permission.id } })
    try {
      const mentor = await contextFor('mentor@ayavacreatives.com')
      await expect(auditService.listPage(mentor, { page: 1, pageSize: 5 })).resolves.toMatchObject({ page: 1 })
    } finally {
      await prisma.rolePermission.delete({
        where: { role_id_permission_id: { role_id: role.id, permission_id: permission.id } },
      })
    }
  })

  it('shapes the dashboard to the viewer’s permissions', async () => {
    const intern = await contextFor('intern@ayavacreatives.com')
    const overview = await dashboardService.getOverview(intern)
    expect(overview.stats.activeInterns).toBeNull()
    expect(overview.stats.pendingReviews).toBeNull()
    expect(overview.activity).toBeNull()
    expect(overview.stats.openTasks).not.toBeNull()
  })
})

describe('organization isolation', () => {
  const suffix = uniqueSuffix()
  let otherOrgId: string

  beforeAll(async () => {
    const other = await prisma.organization.create({ data: { name: 'Other Studio', slug: `other-studio-${suffix}` } })
    otherOrgId = other.id
    const owner = await prisma.user.create({
      data: {
        organization_id: other.id,
        email: `owner-${suffix}@other.dev`,
        first_name: 'Other',
        last_name: 'Owner',
        status: 'ACTIVE',
      },
    })
    await prisma.project.create({
      data: {
        organization_id: other.id,
        name: `Secret Zebra ${suffix}`,
        slug: `secret-zebra-${suffix}`,
        status: 'ACTIVE',
        owner_id: owner.id,
      },
    })
    await prisma.task.create({
      data: { organization_id: other.id, title: `Secret Zebra task ${suffix}`, created_by: owner.id },
    })
  })

  it('never lists another organization’s records', async () => {
    const admin = await contextFor('admin@ayavacreatives.com')
    const projects = await projectService.list(admin, { page: 1, pageSize: 100 })
    expect(projects.items.some((project) => project.name.includes('Secret Zebra'))).toBe(false)

    const tasks = await taskService.list(admin, { page: 1, pageSize: 100 })
    expect(tasks.items.some((task) => task.title.includes('Secret Zebra'))).toBe(false)
  })

  it('never returns another organization’s records from search', async () => {
    const admin = await contextFor('admin@ayavacreatives.com')
    const groups = await searchService.search(admin, 'Secret Zebra')
    expect(groups).toEqual([])
  })

  it('counts only the viewer’s organization on the dashboard', async () => {
    const admin = await contextFor('admin@ayavacreatives.com')
    const overview = await dashboardService.getOverview(admin)
    const expectedOpen = await prisma.task.count({
      where: {
        organization_id: AYAVA_ORGANIZATION_ID,
        deleted_at: null,
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
      },
    })
    expect(overview.stats.openTasks).toBe(expectedOpen)
    expect(otherOrgId).toBeDefined()
  })
})

describe('services return live data', () => {
  it('matches dashboard stats to direct queries', async () => {
    const admin = await contextFor('admin@ayavacreatives.com')
    const overview = await dashboardService.getOverview(admin)
    const activeInterns = await prisma.intern.count({
      where: { organization_id: AYAVA_ORGANIZATION_ID, deleted_at: null, status: { in: ['ACTIVE', 'ENDING_SOON'] } },
    })
    const pending = await prisma.task.count({
      where: {
        organization_id: AYAVA_ORGANIZATION_ID,
        deleted_at: null,
        status: 'IN_REVIEW',
        submissions: { some: { status: { in: ['SUBMITTED', 'RESUBMITTED', 'UNDER_REVIEW'] } } },
      },
    })
    expect(overview.stats.activeInterns).toBe(activeInterns)
    expect(overview.stats.pendingReviews).toBe(pending)
    expect(activeInterns).toBeGreaterThan(0)
  })

  it('computes project progress from tasks', async () => {
    const admin = await contextFor('admin@ayavacreatives.com')
    const { items } = await projectService.list(admin, { page: 1, pageSize: 100 })
    const website = items.find((project) => project.slug === 'ayava-website-redesign')
    expect(website).toBeDefined()
    expect(website!.taskCount).toBeGreaterThan(0)
    expect(website!.progressPercent).toBe(Math.round((website!.completedTaskCount / website!.taskCount) * 100))
  })

  it('searches across permitted entity types', async () => {
    const admin = await contextFor('admin@ayavacreatives.com')
    const groups = await searchService.search(admin, 'website')
    expect(groups.map((group) => group.type)).toContain('project')

    const intern = await contextFor('intern@ayavacreatives.com')
    const internGroups = await searchService.search(intern, 'Aanya')
    expect(internGroups.map((group) => group.type)).not.toContain('intern')
  })
})

describe('audit service', () => {
  it('writes redacted metadata', async () => {
    const admin = await contextFor('admin@ayavacreatives.com')
    const resourceId = uniqueSuffix()
    await auditService.logForContext(admin, {
      action: 'test.recorded',
      resourceType: 'test',
      resourceId,
      metadata: { field: 'status', token: 'should-not-persist' },
    })
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { resource_id: resourceId } })
    expect(entry.actor_user_id).toBe(admin.actor.userId)
    expect(entry.metadata).toEqual({ field: 'status', token: '[REDACTED]' })
  })

  it('never throws when the audit write fails', async () => {
    await expect(
      auditService.log({ organizationId: '00000000-0000-4000-8000-000000000000', action: 'x.y', resourceType: 'x' }),
    ).resolves.toBeUndefined()
  })
})

describe('seed', () => {
  it('is idempotent', async () => {
    const counts = async () => ({
      users: await prisma.user.count(),
      interns: await prisma.intern.count(),
      tasks: await prisma.task.count(),
      permissions: await prisma.permission.count(),
      rolePermissions: await prisma.rolePermission.count(),
      projects: await prisma.project.count(),
      courses: await prisma.course.count(),
      attendance: await prisma.attendance.count(),
      leave: await prisma.leaveRequest.count(),
      documents: await prisma.internshipDocument.count(),
      documentTypes: await prisma.hrDocumentType.count(),
      holidays: await prisma.holiday.count(),
      hrRequests: await prisma.hrRequest.count(),
      announcements: await prisma.announcement.count(),
      offboarding: await prisma.offboardingItem.count(),
    })
    // Simulate interns created after the first seed: re-seeding must never move the code counter backwards.
    const counterKey = { organization_id: AYAVA_ORGANIZATION_ID, key: 'intern.employee_code' }
    const counter = await prisma.codeCounter.update({
      where: { organization_id_key: counterKey },
      data: { value: { increment: 10 } },
    })
    const before = await counts()
    const client = new PrismaClient()
    try {
      const reference = await seedReference(client)
      await seedDemo(client, reference)
    } finally {
      await client.$disconnect()
    }
    expect(await counts()).toEqual(before)
    const after = await prisma.codeCounter.findUniqueOrThrow({ where: { organization_id_key: counterKey } })
    expect(after.value).toBe(counter.value)
  }, 120_000) // the full demo seed (work + HR data, demo document files) takes a while
})

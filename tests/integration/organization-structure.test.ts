import { randomUUID } from 'node:crypto'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/lib/errors'
import type { RequestContext } from '@/server/context'
import { AUDIT_ACTIONS } from '@/server/services/audit-actions'
import { organizationStructureService as structure } from '@/server/services/organization-structure.service'
import { AYAVA_ORGANIZATION_ID } from '../../prisma/seed/ids'
import { contextFor, prisma, uniqueSuffix } from './helpers'

afterAll(() => prisma.$disconnect())

let admin: RequestContext
let hr: RequestContext
let manager: RequestContext
let mentorId: string
let managerId: string

beforeAll(async () => {
  admin = await contextFor('admin@ayavacreatives.com')
  hr = await contextFor('hr@ayavacreatives.com')
  manager = await contextFor('manager@ayavacreatives.com')
  mentorId = (await contextFor('mentor@ayavacreatives.com')).actor.userId
  managerId = manager.actor.userId
})

const seededDepartment = (slug: string) =>
  prisma.department.findUniqueOrThrow({ where: { organization_id_slug: { organization_id: AYAVA_ORGANIZATION_ID, slug } } })

describe('departments', () => {
  it('only people with department permissions create them; names are unique and changes audited', async () => {
    const name = `Research ${uniqueSuffix()}`
    await expect(structure.saveDepartment(hr, { name })).rejects.toBeInstanceOf(ForbiddenError)
    await expect(structure.saveDepartment(manager, { name })).rejects.toBeInstanceOf(ForbiddenError)

    const { id } = await structure.saveDepartment(admin, { name, description: 'R&D', headUserId: mentorId })
    const created = await prisma.department.findUniqueOrThrow({ where: { id } })
    expect(created).toMatchObject({ organization_id: AYAVA_ORGANIZATION_ID, name, head_user_id: mentorId, is_active: true })
    expect(created.slug).toMatch(/^research-/)
    expect(await prisma.auditLog.count({ where: { resource_id: id, action: AUDIT_ACTIONS.DEPARTMENT_SAVED } })).toBe(1)

    // Case-insensitive duplicate names are refused.
    await expect(structure.saveDepartment(admin, { name: name.toUpperCase() })).rejects.toBeInstanceOf(ValidationError)
    // Renaming keeps the slug stable.
    await structure.saveDepartment(admin, { departmentId: id, name: `${name} Lab` })
    expect((await prisma.department.findUniqueOrThrow({ where: { id } })).slug).toBe(created.slug)
  })

  it('accepts only an active member of the organization as head', async () => {
    const name = `Ops ${uniqueSuffix()}`
    await expect(structure.saveDepartment(admin, { name, headUserId: randomUUID() })).rejects.toBeInstanceOf(
      ValidationError,
    )
    await expect(structure.saveDepartment(admin, { departmentId: randomUUID(), name })).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })

  it('cannot be archived while current interns or active teams remain; restores later', async () => {
    const development = await seededDepartment('development')
    await expect(structure.setActive(admin, 'department', { id: development.id, active: 'false' })).rejects.toBeInstanceOf(
      ConflictError,
    )
    expect((await prisma.department.findUniqueOrThrow({ where: { id: development.id } })).is_active).toBe(true)

    const name = `Archive me ${uniqueSuffix()}`
    const { id } = await structure.saveDepartment(admin, { name })
    const team = await structure.saveTeam(admin, { name: `Team of ${name}`, departmentId: id })
    // An active team blocks archiving the department…
    await expect(structure.setActive(admin, 'department', { id, active: 'false' })).rejects.toBeInstanceOf(ConflictError)
    await structure.setActive(admin, 'team', { id: team.id, active: 'false' })
    // …until it is archived first.
    await structure.setActive(admin, 'department', { id, active: 'false' })
    expect((await prisma.department.findUniqueOrThrow({ where: { id } })).is_active).toBe(false)

    // Archived departments can't receive teams, and their teams can't come back on their own.
    await expect(structure.saveTeam(admin, { name: `New ${uniqueSuffix()}`, departmentId: id })).rejects.toBeInstanceOf(
      ValidationError,
    )
    await expect(structure.setActive(admin, 'team', { id: team.id, active: 'true' })).rejects.toBeInstanceOf(ConflictError)
    // Re-creating the archived name points to restoring it.
    await expect(structure.saveDepartment(admin, { name })).rejects.toThrow(/Restore it instead/)

    await structure.setActive(admin, 'department', { id, active: 'true' })
    await structure.setActive(admin, 'team', { id: team.id, active: 'true' })
    expect((await prisma.team.findUniqueOrThrow({ where: { id: team.id } })).is_active).toBe(true)
    const actions = await prisma.auditLog.findMany({ where: { resource_id: id }, select: { action: true } })
    expect(actions.map((a) => a.action)).toEqual(
      expect.arrayContaining([AUDIT_ACTIONS.DEPARTMENT_ARCHIVED, AUDIT_ACTIONS.DEPARTMENT_RESTORED]),
    )
  })
})

describe('teams', () => {
  it('a team lead gains team-scoped access, and loses it when replaced', async () => {
    const development = await seededDepartment('development')
    const { id } = await structure.saveTeam(admin, {
      name: `Platform ${uniqueSuffix()}`,
      departmentId: development.id,
      leadUserId: mentorId,
    })
    expect((await contextFor('mentor@ayavacreatives.com')).actor.ledTeamIds).toContain(id)

    await structure.saveTeam(admin, { teamId: id, name: `Platform ${uniqueSuffix()}`, departmentId: development.id, leadUserId: managerId })
    expect((await contextFor('mentor@ayavacreatives.com')).actor.ledTeamIds).not.toContain(id)
    expect((await contextFor('manager@ayavacreatives.com')).actor.ledTeamIds).toContain(id)

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { resource_id: id, action: AUDIT_ACTIONS.TEAM_SAVED },
      orderBy: { created_at: 'desc' },
    })
    expect(audit.metadata).toMatchObject({ before: { leadUserId: mentorId }, after: { leadUserId: managerId } })
  })

  it('a team with current interns cannot be archived', async () => {
    const placed = await prisma.intern.findFirstOrThrow({
      where: { organization_id: AYAVA_ORGANIZATION_ID, deleted_at: null, team_id: { not: null }, status: 'ACTIVE' },
      select: { team_id: true },
    })
    await expect(structure.setActive(admin, 'team', { id: placed.team_id!, active: 'false' })).rejects.toBeInstanceOf(
      ConflictError,
    )
    await expect(structure.setActive(hr, 'team', { id: placed.team_id!, active: 'false' })).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })
})

describe('positions', () => {
  it('HR manages positions; archived ones leave the intern form options', async () => {
    const title = `QA Intern ${uniqueSuffix()}`
    await expect(structure.savePosition(manager, { title })).rejects.toBeInstanceOf(ForbiddenError)
    const { id } = await structure.savePosition(hr, { title })
    await structure.setActive(hr, 'position', { id, active: 'false' })
    expect((await prisma.position.findUniqueOrThrow({ where: { id } })).is_active).toBe(false)

    const view = await structure.manage(hr)
    expect(view.can).toMatchObject({ position: { manage: true }, department: { create: false } })
    expect(view.members).toEqual([]) // HR edits no heads or leads, so no people list is loaded
    expect(view.unassignedPositions.find((p) => p.id === id)?.is_active).toBe(false)
  })

  it('never touches another organization’s records', async () => {
    const other = await prisma.organization.create({
      data: { name: `Other ${uniqueSuffix()}`, slug: `other-${uniqueSuffix()}` },
    })
    const foreign = await prisma.position.create({
      data: { organization_id: other.id, title: 'Foreign', slug: `foreign-${uniqueSuffix()}` },
    })
    await expect(structure.savePosition(hr, { positionId: foreign.id, title: 'Renamed' })).rejects.toBeInstanceOf(
      NotFoundError,
    )
    await expect(structure.setActive(hr, 'position', { id: foreign.id, active: 'false' })).rejects.toBeInstanceOf(
      NotFoundError,
    )
    expect((await prisma.position.findUniqueOrThrow({ where: { id: foreign.id } })).title).toBe('Foreign')
  })
})

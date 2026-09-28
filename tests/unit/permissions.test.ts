import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_GRANTS,
  PERMISSION_DEFINITIONS,
  PERMISSION_SCOPES,
  SYSTEM_ROLES,
  can,
  canAll,
  canAny,
  canWithScope,
  isPermissionKey,
  widerScope,
  type PermissionKey,
  type PermissionScope,
} from '@/lib/permissions'
import { NAVIGATION, filterNavigation, visibleNav } from '@/config/navigation'

const grantsOf = (role: keyof typeof DEFAULT_ROLE_GRANTS) =>
  new Map(Object.entries(DEFAULT_ROLE_GRANTS[role]) as [string, PermissionScope][])

describe('permission catalog', () => {
  it('uses resource.action keys that satisfy the database format checks', () => {
    for (const definition of PERMISSION_DEFINITIONS) {
      expect(definition.key).toBe(`${definition.resource}.${definition.action}`)
      expect(definition.resource).toMatch(/^[a-z]+(_[a-z]+)*$/)
      expect(definition.action).toMatch(/^[a-z]+(_[a-z]+)*$/)
      expect(definition.description.length).toBeGreaterThan(5)
    }
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length)
  })

  it('covers every permission in the Prompt 02 specification (mapped to catalog names)', () => {
    const required = [
      'user.read',
      'user.create',
      'user.update',
      'user.delete',
      'role.read',
      'role.create',
      'role.update',
      'role.delete',
      'permission.read',
      'permission.manage',
      'organization.read',
      'organization.update',
      'department.read',
      'department.create',
      'department.update',
      'department.delete',
      'team.read',
      'team.create',
      'team.update',
      'team.delete',
      'intern.read',
      'intern.create',
      'intern.update',
      'intern.delete',
      'intern_profile.read',
      'intern_profile.update',
      'internship.read',
      'internship.create',
      'internship.update',
      'internship.complete',
      'onboarding.read',
      'onboarding.manage',
      'onboarding.complete',
      'project.read',
      'project.create',
      'project.update',
      'project.delete',
      'project.manage_members',
      'task.read',
      'task.create',
      'task.update',
      'task.delete',
      'task.assign',
      'task.review',
      'task.submit',
      'attendance.read',
      'attendance.create',
      'attendance.update',
      'attendance.manage',
      'attendance_correction.request',
      'attendance_correction.review',
      'leave.read',
      'leave.request',
      'leave.cancel',
      'leave.approve',
      'leave.reject',
      'document.read',
      'document.upload',
      'document.delete',
      'document.manage',
      'course.read',
      'course.create',
      'course.update',
      'course.delete',
      'course.publish',
      'learning.read',
      'learning.manage',
      'feedback.read',
      'feedback.create',
      'checkin.read',
      'checkin.create',
      'checkin.review',
      'performance.read',
      'performance.create',
      'performance.update',
      'performance.review',
      'announcement.read',
      'announcement.create',
      'announcement.update',
      'announcement.delete',
      'notification.read',
      'notification.manage',
      'calendar.read',
      'calendar.create',
      'calendar.update',
      'calendar.delete',
      'certificate.read',
      'certificate.create',
      'certificate.verify',
      'analytics.read',
      'audit_log.read',
      'settings.read',
      'settings.update',
      'ai.use',
      'ai.manage',
      'knowledge.read',
      'knowledge.manage',
    ]
    expect(required.filter((key) => !isPermissionKey(key))).toEqual([])
  })

  it('grants only catalog permissions with valid scopes, for every system role', () => {
    expect(Object.keys(DEFAULT_ROLE_GRANTS).sort()).toEqual(Object.keys(SYSTEM_ROLES).sort())
    for (const grants of Object.values(DEFAULT_ROLE_GRANTS)) {
      for (const [key, scope] of Object.entries(grants)) {
        expect(isPermissionKey(key)).toBe(true)
        expect(PERMISSION_SCOPES).toContain(scope)
      }
    }
  })

  it('ranks roles strictly', () => {
    const ranks = Object.values(SYSTEM_ROLES).map((role) => role.rank)
    expect(new Set(ranks).size).toBe(ranks.length)
    expect(SYSTEM_ROLES.super_admin.rank).toBeGreaterThan(SYSTEM_ROLES.admin.rank)
    expect(SYSTEM_ROLES.admin.rank).toBeGreaterThan(SYSTEM_ROLES.hr.rank)
    expect(SYSTEM_ROLES.hr.rank).toBeGreaterThan(SYSTEM_ROLES.manager.rank)
    expect(SYSTEM_ROLES.manager.rank).toBeGreaterThan(SYSTEM_ROLES.mentor.rank)
    expect(SYSTEM_ROLES.mentor.rank).toBeGreaterThan(SYSTEM_ROLES.intern.rank)
  })
})

describe('least-privilege role matrix', () => {
  it('gives super admins everything, organization-wide', () => {
    const grants = grantsOf('super_admin')
    expect(grants.size).toBe(ALL_PERMISSIONS.length)
    expect([...grants.values()].every((scope) => scope === 'ORGANIZATION')).toBe(true)
  })

  it('reserves role and permission management for super admins', () => {
    for (const role of ['admin', 'hr', 'manager', 'mentor', 'intern'] as const) {
      const grants = grantsOf(role)
      for (const key of ['role.create', 'role.update', 'role.delete', 'permission.manage'])
        expect(grants.has(key)).toBe(false)
    }
  })

  it('keeps interns to their own records', () => {
    const grants = grantsOf('intern')
    for (const key of [
      'intern.read',
      'audit_log.read',
      'leave.approve',
      'task.review',
      'user.read',
      'settings.update',
      'analytics.read',
    ]) {
      expect(grants.has(key)).toBe(false)
    }
    for (const key of [
      'attendance.read',
      'leave.request',
      'document.read',
      'performance.read',
      'intern_profile.update',
    ]) {
      expect(grants.get(key)).toBe('OWN')
    }
    expect(grants.get('task.read')).toBe('ASSIGNED')
  })

  it('limits managers and mentors to assigned interns and keeps HR data org-wide only for HR', () => {
    const manager = grantsOf('manager')
    const mentor = grantsOf('mentor')
    const hr = grantsOf('hr')
    for (const key of ['intern.read', 'leave.approve', 'performance.read', 'attendance.read'])
      expect(manager.get(key)).toBe('ASSIGNED')
    expect(manager.has('document.manage')).toBe(false)
    expect(manager.has('user.read')).toBe(false)
    expect(mentor.get('intern.read')).toBe('ASSIGNED')
    expect(mentor.has('performance.read')).toBe(false)
    expect(mentor.has('document.read')).toBe(false)
    for (const key of ['intern.read', 'leave.approve', 'document.manage', 'attendance.manage'])
      expect(hr.get(key)).toBe('ORGANIZATION')
    expect(hr.has('audit_log.read')).toBe(false)
    expect(hr.has('settings.update')).toBe(false)
  })
})

describe('permission checks', () => {
  const set = new Map<string, PermissionScope>([
    ['task.read', 'ASSIGNED'],
    ['project.read', 'ORGANIZATION'],
  ])

  it('checks single, any, all and scoped permissions', () => {
    expect(can(set, 'task.read')).toBe(true)
    expect(can(set, 'task.create')).toBe(false)
    expect(canAny(set, ['task.create', 'project.read'])).toBe(true)
    expect(canAll(set, ['task.read', 'task.review'])).toBe(false)
    expect(canWithScope(set, 'task.read', 'OWN')).toBe(true)
    expect(canWithScope(set, 'task.read', 'ORGANIZATION')).toBe(false)
    expect(widerScope('OWN', 'TEAM')).toBe('TEAM')
  })
})

describe('navigation by permission', () => {
  it('shows interns their own areas with scoped labels', () => {
    const nav = visibleNav(grantsOf('intern'), { isIntern: true })
    const labels = Object.fromEntries(nav.map((item) => [item.href, item.label]))
    expect(labels['/tasks']).toBe('My Tasks')
    expect(labels['/projects']).toBe('My Projects')
    expect(labels['/profile']).toBe('Profile')
    expect(labels['/interns']).toBeUndefined()
    expect(labels['/my-internship']).toBe('My Internship')
    expect(labels['/hr']).toBeUndefined()
    expect(labels['/users']).toBeUndefined()
    expect(labels['/audit-logs']).toBeUndefined()
  })

  it('shows managers “My Interns” and HR the organization-wide HR areas', () => {
    const manager = Object.fromEntries(
      visibleNav(grantsOf('manager'), { managesInterns: true }).map((item) => [item.href, item.label]),
    )
    expect(manager['/my-interns']).toBe('My Interns')
    expect(manager['/my-mentees']).toBeUndefined()
    // Assigned-scope viewers get their own lists, not the organization directory.
    expect(manager['/interns']).toBeUndefined()
    const mentor = Object.fromEntries(
      visibleNav(grantsOf('mentor'), { mentorsInterns: true }).map((item) => [item.href, item.label]),
    )
    expect(mentor['/my-mentees']).toBe('My Mentees')
    expect(mentor['/onboarding']).toBeUndefined()
    expect(manager['/tasks']).toBe('Tasks')
    expect(manager['/users']).toBeUndefined()
    const hr = Object.fromEntries(visibleNav(grantsOf('hr')).map((item) => [item.href, item.label]))
    expect(hr['/interns']).toBe('Interns')
    expect(hr['/onboarding']).toBe('Onboarding')
    expect(hr['/hr']).toBe('HR Dashboard')
    expect(hr['/my-internship']).toBeUndefined()
    expect(hr['/users']).toBe('Users')
  })

  it('references only real permissions and drops empty sections', () => {
    for (const item of NAVIGATION.flatMap((section) => section.items)) {
      if (item.permission) expect(isPermissionKey(item.permission as PermissionKey)).toBe(true)
    }
    expect(filterNavigation([{ href: '/', label: 'Overview' }]).map((section) => section.title)).toEqual(['Ayava'])
  })
})

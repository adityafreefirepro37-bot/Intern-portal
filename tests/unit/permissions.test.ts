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
    // Phase 06: mentors take part in their mentees' reviews (section-level privacy is enforced in the service).
    expect(mentor.get('performance.read')).toBe('ASSIGNED')
    expect(mentor.has('performance.review')).toBe(false)
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

describe('Prompt 05 HR permissions', () => {
  // Specification name → catalog key (see docs/authorization.md).
  const HR_SPEC: Record<string, string> = {
    'hr.dashboard.read': 'hr_dashboard.read',
    'hr.interns.read': 'intern.read',
    'hr.interns.update': 'intern.update',
    'hr.interns.export': 'intern.export',
    'hr.attendance.read': 'attendance.read',
    'hr.attendance.manage': 'attendance.manage',
    'hr.attendance.export': 'attendance.export',
    'hr.leave.read': 'leave.read',
    'hr.leave.approve': 'leave.approve',
    'hr.leave.manage': 'leave.manage',
    'hr.leave.export': 'leave.export',
    'hr.documents.read': 'document.read',
    'hr.documents.verify': 'document.verify',
    'hr.documents.manage': 'document.manage',
    'hr.documents.sensitive': 'document.sensitive',
    'hr.documents.export': 'document.export',
    'hr.requests.read': 'hr_request.read',
    'hr.requests.manage': 'hr_request.manage',
    'hr.announcements.create': 'announcement.create',
    'hr.announcements.publish': 'announcement.update',
    'hr.offboarding.read': 'offboarding.read',
    'hr.offboarding.manage': 'offboarding.manage',
    'hr.settings.update': 'hr_settings.update',
    'hr.analytics.read': 'analytics.read',
    'hr.analytics.export': 'analytics.export',
  }

  it('maps every HR specification permission to a catalog key', () => {
    expect(Object.values(HR_SPEC).filter((key) => !isPermissionKey(key))).toEqual([])
  })

  it('gives HR every HR permission organization-wide', () => {
    const hr = grantsOf('hr')
    for (const key of Object.values(HR_SPEC)) expect([key, hr.get(key)]).toEqual([key, 'ORGANIZATION'])
    expect(hr.get('compensation.read')).toBe('ORGANIZATION')
    expect(hr.get('holiday.manage')).toBe('ORGANIZATION')
  })

  it('keeps compensation, sensitive documents, exports and HR settings away from other roles', () => {
    for (const role of ['manager', 'mentor', 'intern'] as const) {
      const grants = grantsOf(role)
      for (const key of [
        'compensation.read',
        'compensation.update',
        'document.sensitive',
        'document.verify',
        'hr_settings.update',
        'hr_request.manage',
        'hr_dashboard.read',
        'intern.export',
        'attendance.export',
        'leave.export',
        'leave.manage',
      ])
        expect([role, key, grants.has(key)]).toEqual([role, key, false])
    }
  })

  it('lets everyone raise and read their own HR requests', () => {
    for (const role of ['manager', 'mentor', 'intern'] as const) {
      const grants = grantsOf(role)
      expect(grants.get('hr_request.create')).toBe('OWN')
      expect(grants.get('hr_request.read')).toBe('OWN')
    }
  })
})

describe('Prompt 06 learning and performance permissions', () => {
  // Specification name → catalog key (see docs/learning-performance.md).
  const SPEC: Record<string, string> = {
    'learning.read': 'learning.read',
    'learning.course.create': 'course.create',
    'learning.course.update': 'course.update',
    'learning.publish': 'course.publish',
    'learning.lesson.create': 'course.update',
    'learning.quiz.create': 'course.update',
    'learning.assignment.review': 'learning_assignment.review',
    'learning.progress.read': 'learning.read',
    'learning.progress.manage': 'learning.manage',
    'learning.enrollment.manage': 'learning.manage',
    'learning.path.read': 'learning_path.read',
    'learning.path.create': 'learning_path.create',
    'learning.path.update': 'learning_path.update',
    'learning.path.delete': 'learning_path.delete',
    'learning.analytics.read': 'learning.read',
    'learning.analytics.export': 'learning.export',
    'performance.feedback.read': 'feedback.read',
    'performance.feedback.create': 'feedback.create',
    'performance.feedback.update': 'feedback.update',
    'performance.checkin.read': 'checkin.read',
    'performance.checkin.create': 'checkin.create',
    'performance.checkin.update': 'checkin.review',
    'performance.review.read': 'performance.read',
    'performance.review.create': 'performance.create',
    'performance.review.update': 'performance.update',
    'performance.review.submit': 'performance.update',
    'performance.goal.read': 'goal.read',
    'performance.goal.create': 'goal.create',
    'performance.goal.update': 'goal.update',
    'performance.goal.review': 'goal.review',
    'performance.templates.manage': 'performance_template.manage',
    'performance.cycles.manage': 'performance_cycle.manage',
    'performance.analytics.export': 'performance.export',
  }

  it('maps every specification permission to a catalog key', () => {
    expect(Object.values(SPEC).filter((key) => !isPermissionKey(key))).toEqual([])
  })

  it('gives HR organization-wide learning and performance administration', () => {
    const hr = grantsOf('hr')
    for (const key of [
      'course.create',
      'course.publish',
      'learning.manage',
      'learning.export',
      'learning_path.create',
      'learning_assignment.review',
      'goal.review',
      'performance.review',
      'performance.export',
      'performance_template.manage',
      'performance_cycle.manage',
    ])
      expect([key, hr.get(key)]).toEqual([key, 'ORGANIZATION'])
  })

  it('limits managers and mentors to their interns, and interns to their own records', () => {
    const manager = grantsOf('manager')
    const mentor = grantsOf('mentor')
    const intern = grantsOf('intern')
    for (const key of ['learning.manage', 'learning_assignment.review', 'goal.review', 'performance.update'])
      expect([key, manager.get(key)]).toEqual([key, 'ASSIGNED'])
    for (const key of ['learning.manage', 'learning_assignment.review', 'goal.update', 'performance.update'])
      expect([key, mentor.get(key)]).toEqual([key, 'ASSIGNED'])
    for (const key of ['goal.read', 'goal.create', 'feedback.request', 'performance.update', 'learning.track'])
      expect([key, intern.get(key)]).toEqual([key, 'OWN'])
    for (const role of [manager, mentor, intern]) {
      for (const key of ['performance_template.manage', 'performance_cycle.manage', 'performance.export', 'learning.export'])
        expect([key, role.has(key)]).toEqual([key, false])
    }
    expect(intern.has('learning_assignment.review')).toBe(false)
    expect(intern.has('course.create')).toBe(false)
  })
})

/**
 * Permission catalog, system roles and default grants.
 *
 * This file is the *seed source* for the `permissions`, `roles` and
 * `role_permissions` tables. At runtime, authorization reads grants (and their
 * scopes) from the database, so an organization can change what a role may do
 * without a deploy. Never branch on role names in application code — check a
 * permission and let the authorization engine apply its scope.
 *
 * Keys use `resource.action` with singular, snake_case resources (enforced by a
 * database CHECK constraint). docs/authorization.md maps the product
 * specification's names (e.g. `users.read`, `intern.profile.read`) to these.
 */

export const PERMISSION_CATALOG = {
  organization: { read: 'View organization details', update: 'Edit organization details' },
  user: {
    read: 'View user accounts',
    create: 'Create user accounts',
    update: 'Edit user accounts',
    delete: 'Deactivate or delete user accounts',
    invite: 'Invite people to the organization',
    suspend: 'Suspend or reactivate accounts',
    assign_role: 'Change which roles a user holds (limited to roles ranked below your own)',
  },
  role: {
    read: 'View roles and their permissions',
    create: 'Create custom roles',
    update: 'Edit custom roles and their permissions',
    delete: 'Delete custom roles',
  },
  permission: { read: 'View the permission catalog', manage: 'Change role permission grants' },
  department: {
    read: 'View departments',
    create: 'Create departments',
    update: 'Edit departments',
    delete: 'Delete departments',
  },
  team: { read: 'View teams', create: 'Create teams', update: 'Edit teams', delete: 'Delete teams' },
  position: { read: 'View positions', manage: 'Create and edit positions' },
  intern: {
    read: 'View intern records',
    create: 'Add interns',
    update: 'Edit intern records',
    delete: 'Remove intern records',
  },
  intern_profile: { read: 'View intern personal profiles', update: 'Edit intern personal profiles' },
  internship: {
    read: 'View internships',
    create: 'Create internships',
    update: 'Edit internships',
    complete: 'Complete or end internships',
  },
  onboarding: {
    read: 'View onboarding checklists',
    manage: 'Configure onboarding checklists',
    complete: 'Complete onboarding items',
  },
  project: {
    read: 'View projects',
    create: 'Create projects',
    update: 'Edit projects',
    delete: 'Archive or delete projects',
    manage_members: 'Add and remove project members',
  },
  task: {
    read: 'View tasks',
    create: 'Create tasks',
    update: 'Edit tasks',
    delete: 'Delete tasks',
    assign: 'Assign tasks',
    submit: 'Submit work for tasks',
    review: 'Review task submissions',
    comment: 'Comment on tasks',
  },
  attendance: {
    read: 'View attendance',
    create: 'Record attendance (check in and out)',
    update: 'Edit attendance records',
    manage: 'Manage attendance rules and records',
  },
  attendance_correction: { request: 'Request attendance corrections', review: 'Review attendance corrections' },
  leave: {
    read: 'View leave requests',
    request: 'Request leave',
    cancel: 'Cancel leave requests',
    approve: 'Approve leave requests',
    reject: 'Reject leave requests',
  },
  leave_type: { manage: 'Configure leave types' },
  document: {
    read: 'View documents',
    upload: 'Upload documents',
    delete: 'Delete documents',
    manage: 'Manage document visibility and retention',
    restricted: 'View admin-restricted documents',
  },
  course: {
    read: 'View courses',
    create: 'Create courses',
    update: 'Edit courses',
    delete: 'Delete courses',
    publish: 'Publish courses',
  },
  learning: {
    read: 'View learning progress',
    manage: 'Manage learning assignments',
    track: 'Record own learning progress',
  },
  calendar: {
    read: 'View calendar',
    create: 'Create calendar events',
    update: 'Edit calendar events',
    delete: 'Delete calendar events',
  },
  meeting: { read: 'View meetings', manage: 'Schedule and edit meetings' },
  feedback: { read: 'View feedback', create: 'Give feedback' },
  checkin: { read: 'View weekly check-ins', create: 'Submit weekly check-ins', review: 'Review weekly check-ins' },
  performance: {
    read: 'View performance reviews',
    create: 'Start performance reviews',
    update: 'Edit performance reviews',
    review: 'Finalize and sign off performance reviews',
  },
  announcement: {
    read: 'View announcements',
    create: 'Publish announcements',
    update: 'Edit announcements',
    delete: 'Delete announcements',
  },
  notification: { read: 'Receive notifications', manage: 'Manage notification settings' },
  message: { read: 'Read channel messages', send: 'Send channel messages' },
  channel: { manage: 'Create and manage channels' },
  certificate: {
    read: 'View certificates',
    create: 'Issue certificates',
    verify: 'Verify certificates',
    revoke: 'Revoke certificates',
  },
  ai: { use: 'Use AYAVA AI', manage: 'Configure AYAVA AI' },
  knowledge: { read: 'View knowledge base', manage: 'Manage knowledge base documents' },
  analytics: { read: 'View analytics' },
  audit_log: { read: 'View audit and security logs' },
  settings: { read: 'View settings', update: 'Change organization settings' },
} as const satisfies Record<string, Record<string, string>>

type Catalog = typeof PERMISSION_CATALOG
type Resource = keyof Catalog

export type PermissionKey = {
  [R in Resource]: `${R & string}.${keyof Catalog[R] & string}`
}[Resource]

export interface PermissionDefinition {
  key: PermissionKey
  resource: string
  action: string
  description: string
}

export const PERMISSION_DEFINITIONS: readonly PermissionDefinition[] = Object.entries(PERMISSION_CATALOG).flatMap(
  ([resource, actions]) =>
    Object.entries(actions).map(([action, description]) => ({
      key: `${resource}.${action}` as PermissionKey,
      resource,
      action,
      description,
    })),
)

export const ALL_PERMISSIONS: readonly PermissionKey[] = PERMISSION_DEFINITIONS.map((p) => p.key)

export function isPermissionKey(value: string): value is PermissionKey {
  return (ALL_PERMISSIONS as readonly string[]).includes(value)
}

export function permissionKey(resource: string, action: string): string {
  return `${resource}.${action}`
}

// ─── Scopes ───────────────────────────────────────────────────────────────────

/**
 * How far a grant reaches, from narrowest to broadest. A broader scope
 * includes every narrower one (a TEAM grant also covers OWN and ASSIGNED).
 *
 *   OWN          records about the actor themself
 *   ASSIGNED     records of interns the actor manages or mentors, and work
 *                assigned to the actor (tasks, project membership)
 *   TEAM         records of interns in teams the actor leads
 *   DEPARTMENT   records of interns in departments the actor heads
 *   ORGANIZATION every record in the actor's organization
 */
export const PERMISSION_SCOPES = ['OWN', 'ASSIGNED', 'TEAM', 'DEPARTMENT', 'ORGANIZATION'] as const
export type PermissionScope = (typeof PERMISSION_SCOPES)[number]

export function scopeRank(scope: PermissionScope): number {
  return PERMISSION_SCOPES.indexOf(scope)
}

/** The broader of two scopes. */
export function widerScope(a: PermissionScope, b: PermissionScope): PermissionScope {
  return scopeRank(a) >= scopeRank(b) ? a : b
}

// ─── System roles (seeded per organization) ─────────────────────────────────

export const SYSTEM_ROLES = {
  super_admin: {
    name: 'Super Admin',
    rank: 100,
    description: 'Full access, including roles, permissions, security and organization settings.',
  },
  admin: { name: 'Admin', rank: 80, description: 'Operational administration of people, work, content and settings.' },
  hr: {
    name: 'HR',
    rank: 60,
    description: 'Internship lifecycle: interns, onboarding, attendance, leave, documents and certificates.',
  },
  manager: { name: 'Manager', rank: 50, description: 'Runs projects and tasks and manages their assigned interns.' },
  mentor: { name: 'Mentor', rank: 40, description: 'Guides assigned interns, reviews work and gives feedback.' },
  intern: {
    name: 'Intern',
    rank: 10,
    description: 'Own profile, tasks, attendance, leave, learning and documents.',
  },
} as const

export type SystemRoleSlug = keyof typeof SYSTEM_ROLES

/** A role's grants: permission → scope. */
export type RoleGrants = Partial<Record<PermissionKey, PermissionScope>>

const ORG = 'ORGANIZATION' as const

function orgWide(keys: readonly PermissionKey[]): RoleGrants {
  return Object.fromEntries(keys.map((key) => [key, ORG]))
}

function grants(scope: PermissionScope, keys: readonly PermissionKey[]): RoleGrants {
  return Object.fromEntries(keys.map((key) => [key, scope]))
}

const SUPER_ADMIN_ONLY: PermissionKey[] = [
  'role.create',
  'role.update',
  'role.delete',
  'permission.manage',
  'organization.update',
]

/**
 * Least-privilege defaults. Principles:
 * - Interns reach only their own records (OWN) or work assigned to them.
 * - Mentors and managers reach only the interns they are assigned to; managers
 *   get organization-wide operational access (projects, tasks, calendar) but
 *   no organization-wide HR data.
 * - HR has organization-wide HR access but not system configuration.
 * - Admins administer operations; role and permission changes are reserved for
 *   super admins.
 */
export const DEFAULT_ROLE_GRANTS: Record<SystemRoleSlug, RoleGrants> = {
  super_admin: orgWide(ALL_PERMISSIONS),

  admin: orgWide(ALL_PERMISSIONS.filter((key) => !SUPER_ADMIN_ONLY.includes(key))),

  hr: {
    ...orgWide([
      'organization.read',
      'user.read',
      'user.create',
      'user.update',
      'user.invite',
      'user.suspend',
      'user.assign_role',
      'role.read',
      'permission.read',
      'department.read',
      'team.read',
      'position.read',
      'position.manage',
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
      'task.read',
      'attendance.read',
      'attendance.update',
      'attendance.manage',
      'attendance_correction.review',
      'leave.read',
      'leave.approve',
      'leave.reject',
      'leave.cancel',
      'leave_type.manage',
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
      'calendar.read',
      'calendar.create',
      'calendar.update',
      'calendar.delete',
      'meeting.read',
      'meeting.manage',
      'feedback.read',
      'feedback.create',
      'checkin.read',
      'checkin.review',
      'performance.read',
      'performance.review',
      'announcement.read',
      'announcement.create',
      'announcement.update',
      'announcement.delete',
      'notification.read',
      'message.read',
      'message.send',
      'certificate.read',
      'certificate.create',
      'certificate.verify',
      'certificate.revoke',
      'ai.use',
      'knowledge.read',
      'knowledge.manage',
      'analytics.read',
      'settings.read',
    ]),
  },

  manager: {
    ...orgWide([
      'organization.read',
      'department.read',
      'team.read',
      'position.read',
      'project.read',
      'project.create',
      'project.update',
      'project.manage_members',
      'task.read',
      'task.create',
      'task.update',
      'task.assign',
      'task.review',
      'task.comment',
      'course.read',
      'calendar.read',
      'calendar.create',
      'calendar.update',
      'calendar.delete',
      'meeting.read',
      'meeting.manage',
      'announcement.read',
      'announcement.create',
      'notification.read',
      'message.read',
      'message.send',
      'ai.use',
      'knowledge.read',
    ]),
    ...grants('ASSIGNED', [
      'intern.read',
      'intern_profile.read',
      'internship.read',
      'onboarding.read',
      'onboarding.complete',
      'attendance.read',
      'attendance_correction.review',
      'leave.read',
      'leave.approve',
      'leave.reject',
      'document.read',
      'learning.read',
      'feedback.read',
      'feedback.create',
      'checkin.read',
      'checkin.review',
      'performance.read',
      'performance.create',
      'performance.update',
    ]),
  },

  mentor: {
    ...orgWide([
      'organization.read',
      'department.read',
      'team.read',
      'course.read',
      'calendar.read',
      'meeting.read',
      'announcement.read',
      'notification.read',
      'message.read',
      'message.send',
      'ai.use',
      'knowledge.read',
    ]),
    ...grants('ASSIGNED', [
      'intern.read',
      'intern_profile.read',
      'internship.read',
      'onboarding.read',
      'onboarding.complete',
      'project.read',
      'task.read',
      'task.review',
      'task.comment',
      'learning.read',
      'feedback.read',
      'feedback.create',
      'checkin.read',
      'checkin.review',
    ]),
  },

  intern: {
    ...orgWide([
      'organization.read',
      'department.read',
      'team.read',
      'course.read',
      'calendar.read',
      'announcement.read',
      'message.read',
      'message.send',
      'ai.use',
      'knowledge.read',
    ]),
    ...grants('ASSIGNED', ['project.read', 'task.read', 'task.submit', 'task.comment', 'meeting.read']),
    ...grants('OWN', [
      'intern_profile.read',
      'intern_profile.update',
      'internship.read',
      'onboarding.read',
      'onboarding.complete',
      'attendance.read',
      'attendance.create',
      'attendance_correction.request',
      'leave.read',
      'leave.request',
      'leave.cancel',
      'document.read',
      'document.upload',
      'learning.read',
      'learning.track',
      'feedback.read',
      'checkin.read',
      'checkin.create',
      'performance.read',
      'notification.read',
      'certificate.read',
    ]),
  },
}

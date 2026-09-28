/**
 * Shared type exports. Database entity types come from the generated Prisma
 * client; application-level types are re-exported from where they are defined
 * so there is one source of truth.
 */
export type {
  Organization,
  User,
  Role,
  Permission,
  Intern,
  Internship,
  Project,
  Task,
  Course,
  Announcement,
  AuditLog,
  UserStatus,
  InternStatus,
  InternshipStatus,
  ProjectStatus,
  TaskStatus,
  TaskPriority,
  SubmissionStatus,
  AttendanceStatus,
  LeaveStatus,
  CourseStatus,
} from '@prisma/client'

export type { ApiResult, ApiSuccess, ApiFailure } from '@/lib/http/response'
export type { ErrorBody, ErrorCode, FieldErrors } from '@/lib/errors'
export type { PermissionKey, PermissionSet, SystemRoleSlug } from '@/lib/permissions'
export type { Pagination } from '@/lib/validation'
export type { Page } from '@/server/services/pagination'
export type { RequestContext, Actor, CurrentOrganization } from '@/server/context'
export type { SearchGroup, SearchResult, SearchEntityType, SearchProvider } from '@/server/services/search.service'
export type { NavItem, NavSection } from '@/config/navigation'

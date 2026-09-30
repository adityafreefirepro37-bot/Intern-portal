import type { AnnouncementAudience, AnnouncementCategory, AnnouncementStatus } from '@prisma/client'

/** Announcement targeting and lifecycle (pure). */

export const ANNOUNCEMENT_CATEGORY_LABELS: Record<AnnouncementCategory, string> = {
  COMPANY: 'Company',
  HR: 'HR',
  HOLIDAY: 'Holiday',
  POLICY: 'Policy',
  INTERNSHIP: 'Internship',
  DEADLINE: 'Deadline',
}

export const ANNOUNCEMENT_AUDIENCE_LABELS: Record<AnnouncementAudience, string> = {
  EVERYONE: 'Everyone',
  DEPARTMENT: 'Department',
  TEAM: 'Team',
  INTERNS: 'All interns',
  MANAGERS: 'Managers',
  MENTORS: 'Mentors',
  SPECIFIC: 'Specific people',
}

/** Audiences that need explicit ids (department, team or user ids). */
export const TARGETED_AUDIENCES: readonly AnnouncementAudience[] = ['DEPARTMENT', 'TEAM', 'SPECIFIC']

/**
 * Relationship facts about a viewer. "Managers" and "mentors" are people who
 * manage or mentor interns (data), not role names.
 */
export interface AudienceFacts {
  userId: string
  isIntern: boolean
  managesInterns: boolean
  mentorsInterns: boolean
  departmentIds: readonly string[]
  teamIds: readonly string[]
}

export function inAudience(
  announcement: { audience: AnnouncementAudience; audience_ids: readonly string[] },
  viewer: AudienceFacts,
): boolean {
  switch (announcement.audience) {
    case 'EVERYONE':
      return true
    case 'INTERNS':
      return viewer.isIntern
    case 'MANAGERS':
      return viewer.managesInterns
    case 'MENTORS':
      return viewer.mentorsInterns
    case 'DEPARTMENT':
      return viewer.departmentIds.some((id) => announcement.audience_ids.includes(id))
    case 'TEAM':
      return viewer.teamIds.some((id) => announcement.audience_ids.includes(id))
    case 'SPECIFIC':
      return announcement.audience_ids.includes(viewer.userId)
  }
}

/** A SCHEDULED announcement whose time has come is live, even before the job flips it. */
export function isLive(
  announcement: { status: AnnouncementStatus; published_at: Date | null; expires_at: Date | null },
  now: Date,
): boolean {
  const published =
    announcement.status === 'PUBLISHED' ||
    (announcement.status === 'SCHEDULED' && announcement.published_at !== null && announcement.published_at <= now)
  if (!published) return false
  return !announcement.expires_at || announcement.expires_at > now
}

export type AnnouncementAction = 'PUBLISH' | 'SCHEDULE' | 'ARCHIVE' | 'UNARCHIVE'

export function canApply(action: AnnouncementAction, status: AnnouncementStatus): boolean {
  switch (action) {
    case 'PUBLISH':
      return status === 'DRAFT' || status === 'SCHEDULED'
    case 'SCHEDULE':
      return status === 'DRAFT' || status === 'SCHEDULED'
    case 'ARCHIVE':
      return status !== 'ARCHIVED'
    case 'UNARCHIVE':
      return status === 'ARCHIVED'
  }
}

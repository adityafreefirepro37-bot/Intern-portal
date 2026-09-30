import type { HrRequestCategory, HrRequestStatus } from '@prisma/client'

/** HR request workflow (pure). */

export const HR_REQUEST_CATEGORIES: readonly HrRequestCategory[] = [
  'ATTENDANCE_CORRECTION',
  'LEAVE',
  'DOCUMENT_UPDATE',
  'CERTIFICATE',
  'EXPERIENCE_LETTER',
  'PROFILE_CHANGE',
  'OTHER',
]

export const HR_REQUEST_CATEGORY_LABELS: Record<HrRequestCategory, string> = {
  ATTENDANCE_CORRECTION: 'Attendance correction',
  LEAVE: 'Leave',
  DOCUMENT_UPDATE: 'Document update',
  CERTIFICATE: 'Certificate',
  EXPERIENCE_LETTER: 'Experience letter',
  PROFILE_CHANGE: 'Profile change',
  OTHER: 'Other',
}

export const HR_REQUEST_STATUSES: readonly HrRequestStatus[] = [
  'OPEN',
  'IN_REVIEW',
  'WAITING_FOR_USER',
  'APPROVED',
  'REJECTED',
  'RESOLVED',
  'CANCELLED',
]

export const HR_REQUEST_STATUS_LABELS: Record<HrRequestStatus, string> = {
  OPEN: 'Open',
  IN_REVIEW: 'In review',
  WAITING_FOR_USER: 'Waiting for you',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  RESOLVED: 'Resolved',
  CANCELLED: 'Cancelled',
}

export const CLOSED_REQUEST_STATUSES: readonly HrRequestStatus[] = ['REJECTED', 'RESOLVED', 'CANCELLED']

/** Moves HR staff (hr_request.manage) may make. Rejections need a reason. */
const STAFF_TRANSITIONS: Record<HrRequestStatus, readonly HrRequestStatus[]> = {
  OPEN: ['IN_REVIEW', 'WAITING_FOR_USER', 'APPROVED', 'REJECTED', 'RESOLVED'],
  IN_REVIEW: ['WAITING_FOR_USER', 'APPROVED', 'REJECTED', 'RESOLVED'],
  WAITING_FOR_USER: ['IN_REVIEW', 'APPROVED', 'REJECTED', 'RESOLVED'],
  APPROVED: ['RESOLVED'],
  REJECTED: ['IN_REVIEW'],
  RESOLVED: ['IN_REVIEW'],
  CANCELLED: [],
}

export function staffTargets(status: HrRequestStatus): readonly HrRequestStatus[] {
  return STAFF_TRANSITIONS[status]
}

/** Requesters may cancel anything not yet decided. */
export function requesterCanCancel(status: HrRequestStatus): boolean {
  return status === 'OPEN' || status === 'IN_REVIEW' || status === 'WAITING_FOR_USER'
}

export function isClosed(status: HrRequestStatus): boolean {
  return CLOSED_REQUEST_STATUSES.includes(status)
}

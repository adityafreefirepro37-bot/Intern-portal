import type { DocumentStatus } from '@prisma/client'

/** Document review rules (pure). "REQUIRED" is derived: a required type with no current document. */

export type RequirementStatus = DocumentStatus | 'REQUIRED'

export const DOCUMENT_STATUS_LABELS: Record<RequirementStatus, string> = {
  REQUIRED: 'Required',
  UPLOADED: 'Uploaded',
  UNDER_REVIEW: 'Under review',
  VERIFIED: 'Verified',
  REJECTED: 'Rejected',
  EXPIRED: 'Expired',
}

export type DocumentDecision = 'START_REVIEW' | 'VERIFY' | 'REJECT' | 'REQUEST_REPLACEMENT'

const ALLOWED: Record<DocumentDecision, readonly DocumentStatus[]> = {
  START_REVIEW: ['UPLOADED'],
  VERIFY: ['UPLOADED', 'UNDER_REVIEW'],
  // Rejecting a verified document (e.g. found to be wrong later) is allowed with a reason.
  REJECT: ['UPLOADED', 'UNDER_REVIEW', 'VERIFIED'],
  REQUEST_REPLACEMENT: ['UPLOADED', 'UNDER_REVIEW', 'VERIFIED', 'EXPIRED'],
}

export function canDecide(decision: DocumentDecision, status: DocumentStatus): boolean {
  return ALLOWED[decision].includes(status)
}

export function decisionTarget(decision: DocumentDecision): DocumentStatus {
  return decision === 'START_REVIEW' ? 'UNDER_REVIEW' : decision === 'VERIFY' ? 'VERIFIED' : 'REJECTED'
}

/** Stored status, with expiry applied for dates that have passed. */
export function effectiveDocumentStatus(status: DocumentStatus, expiresAt: Date | null, today: Date): DocumentStatus {
  if (expiresAt && expiresAt < today && status !== 'REJECTED') return 'EXPIRED'
  return status
}

export function isExpiringSoon(expiresAt: Date | null, today: Date, withinDays: number): boolean {
  if (!expiresAt || expiresAt < today) return false
  return expiresAt.getTime() - today.getTime() <= withinDays * 86_400_000
}

export interface DocumentCompletion {
  required: number
  verified: number
  submitted: number
  missing: number
  rejected: number
  expired: number
  percent: number
  complete: boolean
}

/**
 * Completion against the organization's required document types, using each
 * type's current document. Only VERIFIED counts as complete.
 */
export function documentCompletion(
  requiredTypeIds: readonly string[],
  current: ReadonlyMap<string, DocumentStatus>,
): DocumentCompletion {
  let verified = 0
  let submitted = 0
  let rejected = 0
  let expired = 0
  let missing = 0
  for (const typeId of requiredTypeIds) {
    const status = current.get(typeId)
    if (!status) missing++
    else if (status === 'VERIFIED') verified++
    else if (status === 'REJECTED') rejected++
    else if (status === 'EXPIRED') expired++
    else submitted++
  }
  const required = requiredTypeIds.length
  return {
    required,
    verified,
    submitted,
    missing,
    rejected,
    expired,
    percent: required === 0 ? 100 : Math.round((verified / required) * 100),
    complete: verified === required,
  }
}

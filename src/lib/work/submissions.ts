import type { SubmissionStatus } from '@prisma/client'

/**
 * Submission rules (pure).
 *
 *   (none) ─submit─▶ SUBMITTED ─review─▶ APPROVED
 *                        │                  │ (task reopened)
 *                        ▼                  ▼
 *               CHANGES_REQUESTED ─resubmit─▶ RESUBMITTED ─review─▶ …
 *
 * Every submit/resubmit creates a new immutable version (message, files,
 * submitter, time); reviews write their decision onto that version. Earlier
 * versions are never modified.
 */
export const PENDING_REVIEW: readonly SubmissionStatus[] = ['SUBMITTED', 'RESUBMITTED', 'UNDER_REVIEW']

export const SUBMISSION_STATUS_LABELS: Record<SubmissionStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  UNDER_REVIEW: 'Under review',
  CHANGES_REQUESTED: 'Changes requested',
  RESUBMITTED: 'Resubmitted',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
}

export type SubmitOutcome = { ok: true; status: 'SUBMITTED' | 'RESUBMITTED' } | { ok: false; reason: string }

/** What a new submission becomes given the current submission state. */
export function nextSubmission(current: SubmissionStatus | null): SubmitOutcome {
  if (current === null || current === 'DRAFT') return { ok: true, status: 'SUBMITTED' }
  if (PENDING_REVIEW.includes(current)) return { ok: false, reason: 'This work is already waiting for review' }
  // CHANGES_REQUESTED, or APPROVED/REJECTED on a task that was reopened.
  return { ok: true, status: 'RESUBMITTED' }
}

export type ReviewDecision = 'APPROVE' | 'REQUEST_CHANGES'

export function canReview(current: SubmissionStatus | null): boolean {
  return current !== null && PENDING_REVIEW.includes(current)
}

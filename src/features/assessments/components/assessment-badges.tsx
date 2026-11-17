import Link from 'next/link'
import { ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { INTEGRITY_LABELS } from '@/lib/assessments/integrity'

export const STATUS_LABELS: Record<string, string> = {
  PREPARING: 'Drafting questions',
  AWAITING_APPROVAL: 'Awaiting approval',
  READY: 'Ready to take',
  IN_PROGRESS: 'In progress',
  SUBMITTED: 'Awaiting grading',
  GRADED: 'Graded',
  WAIVED: 'Waived',
  CANCELLED: 'Cancelled',
}

/** Integrity score with its level; the icon and label carry the meaning, not just the colour. */
export function IntegrityBadge({ score }: { score: number }) {
  const level = score >= 80 ? 'CLEAN' : score >= 50 ? 'REVIEW' : 'HIGH_RISK'
  const Icon = level === 'CLEAN' ? ShieldCheck : level === 'REVIEW' ? ShieldQuestion : ShieldAlert
  return (
    <Badge variant={level === 'CLEAN' ? 'success' : level === 'REVIEW' ? 'warning' : 'destructive'} title="Integrity score">
      <Icon aria-hidden className="size-3.5" />
      {INTEGRITY_LABELS[level]} · {score}
    </Badge>
  )
}

/** The task page's line about the latest submission's assessment. */
export function AssessmentStrip({
  assessment: a,
  isIntern,
}: {
  assessment: { id: string; status: string; score_percent: number | null; passed: boolean | null; integrity_score: number | null; version: { version_number: number } }
  isIntern: boolean
}) {
  const todo = isIntern ? a.status === 'READY' || a.status === 'IN_PROGRESS' : a.status === 'AWAITING_APPROVAL' || a.status === 'SUBMITTED'
  return (
    <div className={`mb-4 flex flex-wrap items-center gap-2 rounded-md border p-3 text-small ${todo ? 'border-warning/50 bg-warning/5' : ''}`}>
      <ShieldCheck className="size-4 text-muted-foreground" aria-hidden />
      <span className="font-medium">Assessment (v{a.version.version_number})</span>
      <Badge variant={a.status === 'GRADED' ? (a.passed ? 'success' : 'destructive') : todo ? 'warning' : 'neutral'}>
        {a.status === 'GRADED' ? `${a.score_percent}% · ${a.passed ? 'passed' : 'not passed'}` : STATUS_LABELS[a.status]}
      </Badge>
      {!isIntern && a.integrity_score !== null && <IntegrityBadge score={a.integrity_score} />}
      <Link href={`/assessments/${a.id}`} className="ml-auto font-medium text-primary hover:underline">
        {isIntern && todo ? 'Take it' : 'Open'}
      </Link>
      {!isIntern && a.status !== 'GRADED' && a.status !== 'WAIVED' && (
        <p className="w-full text-caption text-muted-foreground">The submission can be approved once the assessment is passed or waived.</p>
      )}
    </div>
  )
}

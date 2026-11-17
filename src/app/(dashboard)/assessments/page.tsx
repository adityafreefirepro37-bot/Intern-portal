import type { Metadata } from 'next'
import Link from 'next/link'
import { ShieldCheck } from 'lucide-react'
import { StatusBadge } from '@/components/common/badges'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied, EmptyState } from '@/components/common/states'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { IntegrityBadge, STATUS_LABELS } from '@/features/assessments/components/assessment-badges'
import { formatDate, fullName } from '@/lib/utils'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { assessmentService } from '@/server/services/assessment.service'

export const metadata: Metadata = { title: 'Assessments' }

type Row = Awaited<ReturnType<typeof assessmentService.list>>['recent'][number]

function Rows({ rows, tz, showIntern = true, empty }: { rows: Row[]; tz: string; showIntern?: boolean; empty: string }) {
  if (rows.length === 0) return <p className="py-3 text-small text-muted-foreground">{empty}</p>
  return (
    <ul className="divide-y">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
          <div className="min-w-0 flex-1">
            <Link href={`/assessments/${r.id}`} className="font-medium hover:underline">
              {r.task.title}
            </Link>
            <p className="text-caption text-muted-foreground">
              {showIntern && `${fullName(r.intern)} · `}Submission v{r.version.version_number} · Updated {formatDate(r.updated_at, tz)}
              {r.attempt?.auto_submitted && ' · Auto-submitted'}
            </p>
          </div>
          {r.score_percent !== null && (
            <span className="text-small tabular-nums">
              {r.score_percent}% {r.passed === false && <span className="text-destructive">(not passed)</span>}
            </span>
          )}
          {r.integrity_score !== null && <IntegrityBadge score={r.integrity_score} />}
          <StatusBadge status={r.status} label={STATUS_LABELS[r.status]} />
        </li>
      ))}
    </ul>
  )
}

/**
 * Interns: assessments to take and their results.
 * Mentors, managers, HR: questions to approve, attempts to grade and recent results.
 */
export default async function AssessmentsPage() {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'assessment.read')) return <AccessDenied what="assessments" />
  const tz = ctx.organization.timezone
  const data = await assessmentService.list(ctx)
  const isTaker = authorizationService.can(ctx, 'assessment.take')
  const reviewer = data.canManage || Boolean(authorizationService.scopeOf(ctx, 'assessment.review'))

  return (
    <>
      <PageHeader
        title="Assessments"
        description={
          reviewer
            ? 'Every intern task submission comes with a short proctored assessment. Approve the questions, then review the result and the recording.'
            : 'Each task you submit has a short, timed assessment to confirm the work is yours. It is recorded (camera, microphone and screen) — no one watches live.'
        }
      />
      <div className="space-y-6">
        {isTaker && (
          <Card>
            <CardHeader>
              <CardTitle>To take</CardTitle>
            </CardHeader>
            <CardContent>
              {data.toTake.length === 0 ? (
                <EmptyState
                  compact
                  icon={ShieldCheck}
                  title="Nothing to take right now"
                  description="When you submit a task and your mentor approves its questions, the assessment appears here."
                />
              ) : (
                <ul className="divide-y">
                  {data.toTake.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{r.task.title}</p>
                        <p className="text-caption text-muted-foreground">Submission v{r.version.version_number}</p>
                      </div>
                      <StatusBadge status={r.status} label={STATUS_LABELS[r.status]} />
                      <Link href={`/assessments/${r.id}`} className={buttonVariants({ size: 'sm' })}>
                        {r.status === 'IN_PROGRESS' ? 'Resume' : 'Start'}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
        {isTaker && data.myResults.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>My results</CardTitle>
            </CardHeader>
            <CardContent>
              <Rows rows={data.myResults} tz={tz} showIntern={false} empty="" />
            </CardContent>
          </Card>
        )}
        {reviewer && (
          <>
            {data.canManage && (
              <Card>
                <CardHeader>
                  <CardTitle>Questions to approve ({data.toApprove.length})</CardTitle>
                  <p className="text-caption text-muted-foreground">AI drafts the questions from the submission. Check them, edit if needed, and approve.</p>
                </CardHeader>
                <CardContent>
                  <Rows rows={data.toApprove} tz={tz} empty="No questions waiting for approval." />
                </CardContent>
              </Card>
            )}
            <Card>
              <CardHeader>
                <CardTitle>To grade ({data.toGrade.length})</CardTitle>
                <p className="text-caption text-muted-foreground">Multiple choice is marked automatically; AI suggests points for written answers.</p>
              </CardHeader>
              <CardContent>
                <Rows rows={data.toGrade} tz={tz} empty="No attempts waiting to be graded." />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Recent</CardTitle>
              </CardHeader>
              <CardContent>
                <Rows rows={data.recent} tz={tz} empty="No assessments yet." />
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </>
  )
}

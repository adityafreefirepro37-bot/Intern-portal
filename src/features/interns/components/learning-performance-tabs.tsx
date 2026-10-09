import Link from 'next/link'
import { StatusBadge } from '@/components/common/badges'
import { AccessDenied } from '@/components/common/states'
import { DataTable } from '@/components/tables/data-table'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EnrollmentStatusBadge } from '@/features/learning/components/learning-ui'
import { GiveFeedbackDialog, GoalDialog } from '@/features/performance/components/performance-forms'
import { EvidenceGroups, FeedbackList, GoalCards, PerformanceTimelineList } from '@/features/performance/components/performance-views'
import { CreatePlanDialog } from '@/features/performance/components/setup-forms'
import { ForbiddenError, NotFoundError } from '@/lib/errors'
import { ENROLLMENT_TYPE_LABELS } from '@/lib/learning/rules'
import { DEVELOPMENT_PLAN_STATUS_LABELS, REVIEW_STATUS_LABELS } from '@/lib/performance/rules'
import { SUBMISSION_STATUS_LABELS } from '@/lib/work/submissions'
import { formatDay, pluralize } from '@/lib/utils'
import type { RequestContext } from '@/server/context'
import { developmentPlanService } from '@/server/services/development-plan.service'
import { feedbackService } from '@/server/services/feedback.service'
import { goalService } from '@/server/services/goal.service'
import { learningService } from '@/server/services/learning.service'
import { performanceDashboardService } from '@/server/services/performance-dashboard.service'
import { performanceReviewService } from '@/server/services/performance-review.service'

/** Learning and Performance tabs of the intern profile (each section checks its own permission). */

async function orDenied<T>(load: () => Promise<T>): Promise<T | null> {
  try {
    return await load()
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof NotFoundError) return null
    throw error
  }
}

export async function LearningTab({ ctx, userId }: { ctx: RequestContext; userId: string }) {
  const data = await orDenied(() => learningService.forUser(ctx, userId))
  if (!data) return <AccessDenied what="this intern’s learning" />
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Courses</CardTitle>
          <CardDescription>Progress is calculated from completed lessons, passed quizzes and approved assignments.</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            caption="Course enrollments"
            rows={data.enrollments}
            getRowId={(e) => e.id}
            empty={<p className="text-small text-muted-foreground">No courses yet.</p>}
            columns={[
              {
                key: 'course',
                header: 'Course',
                cell: (e) => (
                  <Link href={`/learning/courses/${e.course.id}`} className="font-medium hover:underline">
                    {e.course.title}
                  </Link>
                ),
              },
              { key: 'type', header: 'Type', cell: (e) => ENROLLMENT_TYPE_LABELS[e.enrollment_type], hideBelow: 'sm' },
              { key: 'status', header: 'Status', cell: (e) => <EnrollmentStatusBadge status={e.effectiveStatus} /> },
              { key: 'progress', header: 'Progress', cell: (e) => `${e.progress_percentage}%`, align: 'right' },
              { key: 'due', header: 'Due', cell: (e) => (e.due_date ? formatDay(e.due_date) : '—'), hideBelow: 'md' },
              { key: 'done', header: 'Completed', cell: (e) => (e.completed_at ? formatDay(e.completed_at) : '—'), hideBelow: 'md' },
            ]}
          />
        </CardContent>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Quiz attempts</CardTitle>
          </CardHeader>
          <CardContent>
            {data.attempts.length === 0 ? (
              <p className="text-small text-muted-foreground">No quiz attempts yet.</p>
            ) : (
              <ul className="divide-y text-small">
                {data.attempts.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <Link href={`/learning/quizzes/attempts/${a.id}`} className="hover:underline">
                      {a.quiz.title} · attempt {a.attempt_number}
                    </Link>
                    <span className="text-caption text-muted-foreground">
                      {a.percentage ?? 0}% · {a.passed ? 'passed' : 'not passed'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Assignments</CardTitle>
          </CardHeader>
          <CardContent>
            {data.submissions.length === 0 ? (
              <p className="text-small text-muted-foreground">No assignments submitted yet.</p>
            ) : (
              <ul className="divide-y text-small">
                {data.submissions.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <Link href={`/learning/reviews/${s.id}`} className="hover:underline">
                      {s.assignment.title}
                    </Link>
                    <span className="flex items-center gap-2">
                      {s.points_awarded !== null && s.assignment.max_points !== null && (
                        <span className="text-caption text-muted-foreground">
                          {s.points_awarded}/{s.assignment.max_points}
                        </span>
                      )}
                      <StatusBadge status={s.status} label={SUBMISSION_STATUS_LABELS[s.status]} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export async function PerformanceTab({ ctx, internId, isSelf }: { ctx: RequestContext; internId: string; isSelf: boolean }) {
  const [evidence, timeline, goals, feedback, plans, reviews] = await Promise.all([
    orDenied(() => performanceDashboardService.evidence(ctx, internId)),
    orDenied(() => performanceDashboardService.timeline(ctx, internId, 25)),
    orDenied(() => goalService.list(ctx, { internId })),
    orDenied(() => feedbackService.forIntern(ctx, internId)),
    orDenied(() => developmentPlanService.forIntern(ctx, internId)),
    orDenied(() => performanceReviewService.list(ctx, { internId })),
  ])
  if (!evidence) return <AccessDenied what="this intern’s performance record" />
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div>
          <h2 className="text-h2">Evidence</h2>
          <p className="text-small text-muted-foreground">Counts of real records — select one to see them.</p>
        </div>
        <EvidenceGroups evidence={evidence} />
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          {goals && (
            <Card>
              <CardHeader className="flex-row items-center justify-between gap-3">
                <CardTitle>Goals</CardTitle>
                {goals.can.create && <GoalDialog internId={isSelf ? undefined : internId} />}
              </CardHeader>
              <CardContent>
                {goals.goals.length ? <GoalCards goals={goals.goals} /> : <p className="text-small text-muted-foreground">No goals yet.</p>}
              </CardContent>
            </Card>
          )}
          {feedback && (
            <Card>
              <CardHeader className="flex-row items-center justify-between gap-3">
                <CardTitle>Feedback</CardTitle>
                {feedback.can.give && <GiveFeedbackDialog interns={[]} internId={internId} />}
              </CardHeader>
              <CardContent>
                <FeedbackList items={feedback.feedback} />
              </CardContent>
            </Card>
          )}
          {reviews && (
            <Card>
              <CardHeader>
                <CardTitle>Reviews</CardTitle>
              </CardHeader>
              <CardContent>
                {reviews.reviews.length === 0 ? (
                  <p className="text-small text-muted-foreground">No reviews yet.</p>
                ) : (
                  <ul className="divide-y text-small">
                    {reviews.reviews.map((r) => (
                      <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <Link href={`/performance/reviews/${r.id}`} className="font-medium hover:underline">
                          {r.cycle?.name ?? 'Performance review'}
                        </Link>
                        <span className="flex items-center gap-2 text-caption text-muted-foreground">
                          {formatDay(r.review_period_start)} – {formatDay(r.review_period_end)}
                          <StatusBadge status={r.status} label={REVIEW_STATUS_LABELS[r.status]} />
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}
          {plans && (
            <Card>
              <CardHeader className="flex-row items-center justify-between gap-3">
                <CardTitle>Development plans</CardTitle>
                {plans.can.create && <CreatePlanDialog internId={internId} />}
              </CardHeader>
              <CardContent>
                {plans.plans.length === 0 ? (
                  <p className="text-small text-muted-foreground">No development plans yet.</p>
                ) : (
                  <ul className="divide-y text-small">
                    {plans.plans.map((p) => (
                      <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <Link href={`/performance/development/${p.id}`} className="font-medium hover:underline">
                          {p.title}
                        </Link>
                        <span className="flex items-center gap-2 text-caption text-muted-foreground">
                          {p.done}/{pluralize(p.total, 'item')} done
                          <StatusBadge status={p.status} label={DEVELOPMENT_PLAN_STATUS_LABELS[p.status]} />
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}
        </div>
        {timeline && (
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <PerformanceTimelineList timeline={timeline} />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

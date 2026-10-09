import type { Metadata } from 'next'
import Link from 'next/link'
import { ExternalLink, Trash2 } from 'lucide-react'
import { StatusBadge } from '@/components/common/badges'
import { PageHeader } from '@/components/common/page-header'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/misc'
import { ConfirmActionButton } from '@/features/learning/components/confirm-action'
import { LessonText } from '@/features/learning/components/learning-ui'
import { EvidenceForm, GiveFeedbackDialog, GoalDialog, GoalProgressForm } from '@/features/performance/components/performance-forms'
import { formatDateOnly } from '@/lib/interns/dates'
import { EVIDENCE_TYPE_LABELS, GOAL_CATEGORY_LABELS, GOAL_STATUS_LABELS } from '@/lib/performance/rules'
import { formatDay, fullName } from '@/lib/utils'
import { removeGoalEvidenceAction } from '@/server/actions/performance'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { goalService } from '@/server/services/goal.service'

export const metadata: Metadata = { title: 'Goal' }

export default async function GoalPage({ params }: PageProps<'/performance/goals/[id]'>) {
  const ctx = await requirePageContext()
  const { id } = await params
  const { goal, overdue, relation, can } = await goalService.get(ctx, id)
  const records = can.update ? await goalService.evidenceOptions(ctx, goal.id) : null
  const canGiveFeedback = !relation.isSelf && authorizationService.can(ctx, 'feedback.create')

  return (
    <>
      <PageHeader
        title={goal.title}
        breadcrumbs={[
          { label: 'Performance', href: '/performance' },
          { label: 'Goals', href: '/performance/goals' },
          { label: goal.title },
        ]}
        description={relation.isSelf ? undefined : `Goal for ${fullName(goal.intern.user)}`}
        actions={
          <>
            {canGiveFeedback && (
              <GiveFeedbackDialog
                interns={[]}
                internId={goal.intern.id}
                context={{ type: 'GOAL', id: goal.id, label: goal.title }}
                label="Feedback on this goal"
              />
            )}
            {can.update && (
              <GoalDialog
                goal={{
                  id: goal.id,
                  title: goal.title,
                  description: goal.description,
                  category: goal.category,
                  start_date: goal.start_date ? formatDateOnly(goal.start_date) : null,
                  target_date: goal.target_date ? formatDateOnly(goal.target_date) : null,
                }}
              />
            )}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <Card className="space-y-4 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={goal.status} label={GOAL_STATUS_LABELS[goal.status]} />
              <Badge variant="outline">{GOAL_CATEGORY_LABELS[goal.category]}</Badge>
              {overdue && <StatusBadge status="OVERDUE" label="Past target date" />}
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between text-small">
                <span>Progress</span>
                <span className="tabular font-medium">{goal.progress}%</span>
              </div>
              <Progress value={goal.progress} label="Goal progress" />
            </div>
            {goal.description ? <LessonText text={goal.description} /> : <p className="text-small text-muted-foreground">No description.</p>}
          </Card>

          <section className="space-y-3">
            <h2 className="text-h2">Evidence</h2>
            {goal.evidence.length === 0 ? (
              <p className="text-small text-muted-foreground">No evidence linked yet.</p>
            ) : (
              <ul className="grid gap-2">
                {goal.evidence.map((e) => (
                  <li key={e.id}>
                    <Card className="flex flex-wrap items-start gap-3 p-4 text-small">
                      <Badge variant="neutral">{EVIDENCE_TYPE_LABELS[e.evidence_type]}</Badge>
                      <div className="min-w-0 flex-1 space-y-1">
                        {e.record && (
                          <Link href={e.record.href} className="font-medium hover:underline">
                            {e.record.title}
                          </Link>
                        )}
                        {e.reference_id && !e.record && <p className="text-muted-foreground">The linked record is no longer available.</p>}
                        {e.url && (
                          <a href={e.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 font-medium hover:underline">
                            {e.url} <ExternalLink className="size-3.5" aria-hidden />
                          </a>
                        )}
                        {e.note && <p className="whitespace-pre-line">{e.note}</p>}
                        <p className="text-caption text-muted-foreground">
                          {e.adder ? `${fullName(e.adder)} · ` : ''}
                          {formatDay(e.created_at)}
                        </p>
                      </div>
                      {(can.review || can.update) && (
                        <ConfirmActionButton
                          action={removeGoalEvidenceAction}
                          fields={{ evidenceId: e.id }}
                          title="Remove this evidence?"
                          description="Only the link is removed — the record itself isn’t changed."
                          confirmLabel="Remove"
                          destructive
                          size="sm"
                          variant="ghost"
                          aria-label="Remove evidence"
                        >
                          <Trash2 aria-hidden />
                        </ConfirmActionButton>
                      )}
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <aside className="space-y-4">
          {can.update && (
            <Card className="p-5">
              <h2 className="mb-3 text-h3">Update progress</h2>
              <GoalProgressForm goalId={goal.id} status={goal.status} progress={goal.progress} canClose={can.close} />
              {!can.close && <p className="mt-2 text-caption text-muted-foreground">Your manager or mentor closes goals they set.</p>}
            </Card>
          )}
          {records && (
            <Card className="p-5">
              <h2 className="mb-3 text-h3">Add evidence</h2>
              <EvidenceForm goalId={goal.id} records={records} />
            </Card>
          )}
          <Card className="space-y-1.5 p-5 text-small">
            <h2 className="mb-1 text-h3">Details</h2>
            <p>Owner: {fullName(goal.owner)}</p>
            {goal.creator && <p>Set by: {fullName(goal.creator)}</p>}
            {goal.start_date && <p>Start: {formatDay(goal.start_date)}</p>}
            {goal.target_date && <p>Target: {formatDay(goal.target_date)}</p>}
            {goal.completed_at && <p>Completed: {formatDay(goal.completed_at)}</p>}
            {!relation.isSelf && (
              <Link href={`/interns/${goal.intern.id}?tab=performance`} className="inline-block pt-1 text-primary hover:underline">
                Intern’s performance record
              </Link>
            )}
          </Card>
        </aside>
      </div>
    </>
  )
}

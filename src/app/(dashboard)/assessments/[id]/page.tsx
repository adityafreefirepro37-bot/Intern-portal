import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AlertTriangle, Camera, CheckCircle2, Clock, MonitorUp, XCircle } from 'lucide-react'
import { StatusBadge } from '@/components/common/badges'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied } from '@/components/common/states'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { IntegrityBadge, STATUS_LABELS } from '@/features/assessments/components/assessment-badges'
import { GradingForm, QuestionEditor, WaiveButton } from '@/features/assessments/components/reviewer-forms'
import { EVENT_LABELS, INTEGRITY_LABELS, RECORDING_RETENTION_DAYS, VIOLATION_TYPES, type ProctorEventType } from '@/lib/assessments/integrity'
import { ForbiddenError, NotFoundError } from '@/lib/errors'
import { cn, formatDate, fullName, humanizeEnum } from '@/lib/utils'
import { idSchema } from '@/lib/validation'
import { aiSettingsService } from '@/server/ai/settings.service'
import { requirePageContext } from '@/server/context'
import { assessmentService } from '@/server/services/assessment.service'

export const metadata: Metadata = { title: 'Assessment' }

type View = Awaited<ReturnType<typeof assessmentService.get>>

function offset(from: Date, at: Date) {
  const s = Math.max(0, Math.round((at.getTime() - from.getTime()) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function minutes(seconds: number) {
  return seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)} min`
}

export default async function AssessmentPage({ params }: PageProps<'/assessments/[id]'>) {
  const ctx = await requirePageContext()
  const { id } = await params
  if (!idSchema.safeParse(id).success) notFound()
  let a: View
  try {
    a = await assessmentService.get(ctx, id)
  } catch (error) {
    if (error instanceof NotFoundError) notFound()
    if (error instanceof ForbiddenError) return <AccessDenied what="this assessment" />
    throw error
  }
  const tz = ctx.organization.timezone
  const reviewer = a.canManage || a.canReview
  const open = !['GRADED', 'WAIVED', 'CANCELLED'].includes(a.status)

  return (
    <>
      <PageHeader
        title={a.task.title}
        breadcrumbs={[{ label: 'Assessments', href: '/assessments' }, { label: `Submission v${a.version.version_number}` }]}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={a.status} label={STATUS_LABELS[a.status]} />
            {!a.isIntern && <span>{fullName(a.intern)}</span>}
            <span>
              · {a.time_limit_minutes} min · pass mark {a.pass_percent}%
            </span>
            {a.integrity_score !== null && reviewer && <IntegrityBadge score={a.integrity_score} />}
          </span>
        }
        actions={
          <>
            <Link href={`/tasks/${a.task.id}`} className={buttonVariants({ variant: 'outline' })}>
              Open task
            </Link>
            {a.canReview && open && <WaiveButton assessmentId={a.id} />}
          </>
        }
      />
      {a.isIntern ? <InternView a={a} /> : reviewer ? <ReviewerView a={a} tz={tz} organizationId={ctx.organization.id} /> : <Summary a={a} />}
    </>
  )
}

function Result({ a }: { a: View }) {
  if (a.status === 'WAIVED') {
    return (
      <Card>
        <CardContent className="p-5 text-small">
          This assessment was waived{a.waived_at && ` on ${formatDate(a.waived_at)}`}. The task can be reviewed without it.
        </CardContent>
      </Card>
    )
  }
  if (a.status !== 'GRADED' || a.score_percent === null) return null
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-4 p-5">
        {a.passed ? <CheckCircle2 className="size-8 text-success" aria-hidden /> : <XCircle className="size-8 text-destructive" aria-hidden />}
        <div>
          <p className="text-h2 tabular-nums">{a.score_percent}%</p>
          <p className="text-small text-muted-foreground">
            {a.passed ? 'Passed' : 'Not passed'} · pass mark {a.pass_percent}%
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

function Summary({ a }: { a: View }) {
  return <Result a={a} />
}

/** The intern's page: what to expect, a start button, and the result once graded. */
function InternView({ a }: { a: View }) {
  const answers = new Map(a.attempt?.answers.map((x) => [x.question_id, x]) ?? [])
  return (
    <div className="grid max-w-3xl gap-6">
      {a.canTake && (
        <Card>
          <CardHeader>
            <CardTitle>{a.status === 'IN_PROGRESS' ? 'Resume your assessment' : 'Before you start'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-small">
            <ul className="space-y-2">
              <li className="flex gap-2">
                <Clock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                {a.questions.length} questions, {a.time_limit_minutes} minutes. The timer keeps running if you leave, and it submits itself at the end.
              </li>
              <li className="flex gap-2">
                <Camera className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                Your camera and microphone are recorded for the whole attempt. Sit in a quiet, well-lit place, alone.
              </li>
              <li className="flex gap-2">
                <MonitorUp className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                You share your entire screen and stay in full screen. Leaving full screen, switching tabs, staying in another window for more than a few
                seconds or stopping the share is recorded; after{' '}
                {a.max_violations} of these the assessment submits automatically.
              </li>
              <li className="flex gap-2">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                Copy, paste and right-click are disabled. Use a laptop or desktop with Chrome, Edge or Firefox.
              </li>
            </ul>
            <p className="text-caption text-muted-foreground">
              No one watches live. Your mentor reviews the recording afterwards; it is deleted after {RECORDING_RETENTION_DAYS} days.
            </p>
            <Link href={`/assessments/${a.id}/take`} className={buttonVariants()}>
              {a.status === 'IN_PROGRESS' ? 'Resume assessment' : 'Continue to start'}
            </Link>
          </CardContent>
        </Card>
      )}
      {(a.status === 'PREPARING' || a.status === 'AWAITING_APPROVAL') && (
        <Card>
          <CardContent className="p-5 text-small">Your mentor is preparing the questions for this submission. You’ll get a notification when it’s ready.</CardContent>
        </Card>
      )}
      {a.status === 'SUBMITTED' && (
        <Card>
          <CardContent className="p-5 text-small">
            Submitted{a.attempt?.submitted_at && ` ${formatDate(a.attempt.submitted_at)}`}
            {a.attempt?.auto_submitted && ' (automatically)'}. Your mentor will review it and you’ll be notified of the result.
          </CardContent>
        </Card>
      )}
      <Result a={a} />
      {a.status === 'GRADED' && a.questions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Your answers</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-4">
              {a.questions.map((q, i) => {
                const ans = answers.get(q.id)
                return (
                  <li key={q.id} className="space-y-1 text-small">
                    <p className="font-medium">
                      {i + 1}. {q.prompt}
                    </p>
                    <p className="text-muted-foreground">
                      {q.kind === 'MULTIPLE_CHOICE' ? (ans?.choice !== null && ans?.choice !== undefined ? q.options[ans.choice] : 'No answer') : ans?.text || 'No answer'}
                    </p>
                    <p className="text-caption tabular-nums">
                      {ans?.points ?? 0} / {q.points} points
                    </p>
                  </li>
                )
              })}
            </ol>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

async function ReviewerView({ a, tz, organizationId }: { a: View; tz: string; organizationId: string }) {
  const attempt = a.attempt
  const answers = new Map(attempt?.answers.map((x) => [x.question_id, x]) ?? [])
  const aiAvailable = a.canManage && (await aiSettingsService.get(organizationId).catch(() => null))?.enabled === true

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="space-y-6">
        <Result a={a} />
        {a.status === 'PREPARING' && (
          <Card>
            <CardContent className="p-5 text-small">Drafting questions from the submission… refresh in a moment.</CardContent>
          </Card>
        )}
        {a.generation_error && a.status === 'AWAITING_APPROVAL' && (
          <p className="rounded-md border border-warning/40 bg-warning/5 p-3 text-small">
            The AI couldn’t draft questions ({a.generation_error}). Starter questions were added — edit them before approving.
          </p>
        )}
        {a.status === 'AWAITING_APPROVAL' && a.canManage ? (
          <Card>
            <CardHeader>
              <CardTitle>Questions</CardTitle>
              <p className="text-caption text-muted-foreground">
                {a.source === 'AI' ? 'Drafted by AYAVA AI from the submission. ' : ''}Check that they test whether the intern really did the work, then approve.
              </p>
            </CardHeader>
            <CardContent>
              <QuestionEditor
                assessmentId={a.id}
                aiAvailable={aiAvailable}
                settings={{ timeLimitMinutes: a.time_limit_minutes, passPercent: a.pass_percent, maxViolations: a.max_violations }}
                initial={a.questions.map((q) => ({
                  kind: q.kind,
                  prompt: q.prompt,
                  options: q.kind === 'MULTIPLE_CHOICE' ? q.options : [],
                  correct: q.correct_option ?? 0,
                  points: q.points,
                  rubric: q.rubric ?? '',
                }))}
              />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>{attempt ? 'Answers' : 'Questions'}</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-5">
                {a.questions.map((q, i) => {
                  const ans = answers.get(q.id)
                  return (
                    <li key={q.id} className="space-y-2 text-small">
                      <p className="font-medium">
                        {i + 1}. {q.prompt} <span className="text-caption font-normal text-muted-foreground">({q.points} pt)</span>
                      </p>
                      {q.kind === 'MULTIPLE_CHOICE' ? (
                        <ul className="grid gap-1">
                          {q.options.map((o, oi) => (
                            <li
                              key={oi}
                              className={cn(
                                'rounded border px-2 py-1',
                                oi === q.correct_option && 'border-success bg-success/5',
                                ans?.choice === oi && oi !== q.correct_option && 'border-destructive bg-destructive/5',
                              )}
                            >
                              {o}
                              {oi === q.correct_option && <span className="ml-2 text-caption text-success">correct</span>}
                              {ans?.choice === oi && <span className="ml-2 text-caption">← answered</span>}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <>
                          {attempt && <p className="whitespace-pre-wrap rounded border bg-muted/40 p-2">{ans?.text || <em className="text-muted-foreground">No answer</em>}</p>}
                          {q.rubric && <p className="text-caption text-muted-foreground">Rubric: {q.rubric}</p>}
                          {ans?.ai_feedback && (
                            <p className="text-caption">
                              AI: {ans.ai_points ?? '–'} / {q.points} — {ans.ai_feedback}
                            </p>
                          )}
                        </>
                      )}
                      {attempt && (a.status === 'GRADED' || q.kind === 'MULTIPLE_CHOICE') && (
                        <p className="text-caption tabular-nums text-muted-foreground">
                          {ans?.points ?? 0} / {q.points} points
                        </p>
                      )}
                    </li>
                  )
                })}
              </ol>
            </CardContent>
          </Card>
        )}
        {attempt && a.canReview && (a.status === 'SUBMITTED' || a.status === 'GRADED') && (
          <Card>
            <CardHeader>
              <CardTitle>{a.status === 'GRADED' ? 'Change the grade' : 'Grade'}</CardTitle>
              <p className="text-caption text-muted-foreground">
                Watch the recording and check the timeline before deciding. The task can only be approved once the assessment is passed (or waived).
              </p>
            </CardHeader>
            <CardContent>
              <GradingForm
                assessmentId={a.id}
                answers={a.questions
                  .filter((q) => q.kind === 'SHORT_ANSWER' && answers.has(q.id))
                  .map((q) => {
                    const ans = answers.get(q.id)!
                    return { answerId: ans.id, max: q.points, suggested: ans.ai_points, current: a.status === 'GRADED' ? ans.points : null }
                  })}
              />
            </CardContent>
          </Card>
        )}
      </div>

      {attempt && (
        <div className="space-y-6">
          {a.integrity && (
            <Card>
              <CardHeader>
                <CardTitle>Integrity</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-small">
                <div className="flex items-center gap-2">
                  <IntegrityBadge score={a.integrity.score} />
                  <span className="text-muted-foreground">{INTEGRITY_LABELS[a.integrity.level]}</span>
                </div>
                {a.integrity.reasons.length > 0 ? (
                  <ul className="list-disc space-y-1 pl-5">
                    {a.integrity.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground">No suspicious activity was detected.</p>
                )}
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-caption">
                  <dt className="text-muted-foreground">Started</dt>
                  <dd>{formatDate(attempt.started_at, tz)}</dd>
                  <dt className="text-muted-foreground">Submitted</dt>
                  <dd>
                    {attempt.submitted_at ? formatDate(attempt.submitted_at, tz) : 'Not yet'}
                    {attempt.auto_submitted && ' (automatically)'}
                  </dd>
                  {attempt.submit_reason && (
                    <>
                      <dt className="text-muted-foreground">Reason</dt>
                      <dd>{attempt.submit_reason}</dd>
                    </>
                  )}
                  <dt className="text-muted-foreground">Violations</dt>
                  <dd>
                    {attempt.violations} (limit {a.max_violations})
                  </dd>
                  <dt className="text-muted-foreground">Screen shared</dt>
                  <dd>{attempt.screen_surface ? humanizeEnum(attempt.screen_surface) : '—'}</dd>
                  <dt className="text-muted-foreground">Recorded</dt>
                  <dd>
                    camera {minutes(a.recordings.camera)}, screen {minutes(a.recordings.screen)}
                  </dd>
                  {attempt.ip_address && (
                    <>
                      <dt className="text-muted-foreground">IP</dt>
                      <dd className="font-mono">{attempt.ip_address}</dd>
                    </>
                  )}
                </dl>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Recordings</CardTitle>
              <p className="text-caption text-muted-foreground">Kept for {RECORDING_RETENTION_DAYS} days. Every viewing is recorded in the audit log.</p>
            </CardHeader>
            <CardContent className="space-y-4">
              {a.segments.length === 0 && <p className="text-small text-muted-foreground">No recording was uploaded.</p>}
              {a.segments.map((s) => (
                <figure key={`${s.stream}-${s.segment}`} className="space-y-1">
                  <figcaption className="text-caption text-muted-foreground">
                    {s.stream === 'CAMERA' ? 'Camera and microphone' : 'Screen'}
                    {s.segment > 0 && ` · part ${s.segment + 1}`} · about {minutes(s.seconds)}
                  </figcaption>
                  {s.deleted ? (
                    <p className="rounded border p-2 text-caption text-muted-foreground">Deleted after {RECORDING_RETENTION_DAYS} days.</p>
                  ) : (
                    <video
                      controls
                      preload="none"
                      className="aspect-video w-full rounded-md bg-black"
                      src={`/api/assessments/attempts/${attempt.id}/recording/${s.stream.toLowerCase()}?segment=${s.segment}`}
                    />
                  )}
                </figure>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              {a.timeline.length === 0 ? (
                <p className="text-small text-muted-foreground">No events.</p>
              ) : (
                <ol className="max-h-[28rem] space-y-1 overflow-y-auto text-caption">
                  {a.timeline.map((e, i) => {
                    const violation = VIOLATION_TYPES.includes(e.type as ProctorEventType)
                    return (
                      <li key={i} className={cn('flex gap-2', violation && 'font-medium text-destructive')}>
                        <span className="w-12 shrink-0 tabular-nums text-muted-foreground">{offset(attempt.started_at, e.occurred_at)}</span>
                        <span>
                          {violation && <AlertTriangle className="mr-1 inline size-3" aria-hidden />}
                          {EVENT_LABELS[e.type as ProctorEventType] ?? humanizeEnum(e.type)}
                          {e.type === 'WINDOW_FOCUS' && typeof (e.detail as { seconds?: unknown } | null)?.seconds === 'number' && (
                            <span className="text-muted-foreground"> (away {(e.detail as { seconds: number }).seconds} s)</span>
                          )}
                          {e.type === 'UPLOAD_FAILED' && e.detail && typeof e.detail === 'object' && (
                            <span className="text-muted-foreground">
                              {' '}
                              ({[
                                (e.detail as { stream?: string }).stream,
                                (e.detail as { reason?: string }).reason,
                                typeof (e.detail as { tries?: unknown }).tries === 'number' && `${(e.detail as { tries: number }).tries} tries`,
                              ]
                                .filter(Boolean)
                                .join(', ')}
                              )
                            </span>
                          )}
                        </span>
                      </li>
                    )
                  })}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { AccessDenied } from '@/components/common/states'
import { ProctorSession } from '@/features/assessments/components/proctor-session'
import { ForbiddenError, NotFoundError } from '@/lib/errors'
import { idSchema } from '@/lib/validation'
import { requirePageContext } from '@/server/context'
import { assessmentService } from '@/server/services/assessment.service'

export const metadata: Metadata = { title: 'Take assessment' }

/** The proctored session (consent → camera, microphone and screen → timed questions). */
export default async function TakeAssessmentPage({ params }: PageProps<'/assessments/[id]/take'>) {
  const ctx = await requirePageContext()
  const { id } = await params
  if (!idSchema.safeParse(id).success) notFound()
  let a: Awaited<ReturnType<typeof assessmentService.get>>
  try {
    a = await assessmentService.get(ctx, id)
  } catch (error) {
    if (error instanceof NotFoundError) notFound()
    if (error instanceof ForbiddenError) return <AccessDenied what="this assessment" />
    throw error
  }
  if (!a.canTake) redirect(`/assessments/${a.id}`)
  return (
    <ProctorSession
      assessmentId={a.id}
      taskTitle={a.task.title}
      timeLimitMinutes={a.time_limit_minutes}
      maxViolations={a.max_violations}
      questionCount={a.questions.length}
      resuming={a.status === 'IN_PROGRESS'}
    />
  )
}

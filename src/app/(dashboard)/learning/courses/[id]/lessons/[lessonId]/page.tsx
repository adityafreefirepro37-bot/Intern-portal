import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, ArrowRight, CheckCircle2, ExternalLink } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { CompleteLessonButton, EnrollButton } from '@/features/learning/components/learner-actions'
import { LessonText, LockedNotice } from '@/features/learning/components/learning-ui'
import { CONTENT_TYPE_LABELS, formatMinutes } from '@/lib/learning/rules'
import { requirePageContext } from '@/server/context'
import { learningService } from '@/server/services/learning.service'

export const metadata: Metadata = { title: 'Lesson' }

/** External resources open in a new tab; the URLs were validated as https when authored. */
function ResourceLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className={buttonVariants({ variant: 'outline' })}>
      <ExternalLink aria-hidden /> {label}
    </a>
  )
}

export default async function LessonPage({ params }: PageProps<'/learning/courses/[id]/lessons/[lessonId]'>) {
  const ctx = await requirePageContext()
  const { id, lessonId } = await params
  const view = await learningService.lessonView(ctx, lessonId)
  const { lesson } = view
  if (lesson.course_id !== id) notFound()
  const base = `/learning/courses/${lesson.course_id}`

  return (
    <>
      <PageHeader
        title={lesson.title}
        breadcrumbs={[
          { label: 'Learning Hub', href: '/learning' },
          { label: lesson.course.title, href: base },
          { label: `Lesson ${view.position.index} of ${view.position.total}` },
        ]}
        description={lesson.description ?? undefined}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge variant="neutral">{CONTENT_TYPE_LABELS[lesson.content_type]}</Badge>
        {lesson.module && <Badge variant="outline">{lesson.module.title}</Badge>}
        {lesson.estimated_minutes ? <Badge variant="outline">{formatMinutes(lesson.estimated_minutes)}</Badge> : null}
        {!lesson.is_required && <Badge variant="outline">Optional</Badge>}
        {view.completed && (
          <Badge variant="success">
            <CheckCircle2 aria-hidden /> Completed
          </Badge>
        )}
      </div>
      <Card className="space-y-5 p-5 sm:p-8">
        {view.locked ? (
          <LockedNotice />
        ) : (
          <>
            {lesson.content_type === 'TEXT' && <LessonText text={view.content} />}
            {lesson.content_type !== 'TEXT' && view.content && <LessonText text={view.content} />}
            {lesson.content_type === 'VIDEO' && lesson.video_url && <ResourceLink href={lesson.video_url} label="Watch the video" />}
            {lesson.content_type === 'DOCUMENT' && lesson.document_url && (
              <ResourceLink href={lesson.document_url} label="Open the document" />
            )}
            {lesson.content_type === 'LINK' && lesson.link_url && <ResourceLink href={lesson.link_url} label="Open the resource" />}
          </>
        )}
        {!view.enrolled && !view.locked && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg bg-muted/60 p-4 text-small">
            <p className="flex-1">Enroll in the course to track your progress.</p>
            {lesson.course.status === 'PUBLISHED' && <EnrollButton courseId={lesson.course_id} />}
          </div>
        )}
        {view.can.complete && (
          <div className="border-t pt-5">
            <CompleteLessonButton lessonId={lesson.id} />
          </div>
        )}
      </Card>
      <nav aria-label="Lesson navigation" className="mt-6 flex flex-wrap justify-between gap-3">
        {view.previous ? (
          <Link href={`${base}/lessons/${view.previous.id}`} className={buttonVariants({ variant: 'outline' })}>
            <ArrowLeft aria-hidden /> {view.previous.title}
          </Link>
        ) : (
          <Link href={base} className={buttonVariants({ variant: 'outline' })}>
            <ArrowLeft aria-hidden /> Course outline
          </Link>
        )}
        {view.next ? (
          <Link href={`${base}/lessons/${view.next.id}`} className={buttonVariants({ variant: 'outline' })}>
            {view.next.title} <ArrowRight aria-hidden />
          </Link>
        ) : (
          <Link href={base} className={buttonVariants({ variant: 'outline' })}>
            Back to course <ArrowRight aria-hidden />
          </Link>
        )}
      </nav>
    </>
  )
}

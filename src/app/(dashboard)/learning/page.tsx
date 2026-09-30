import type { Metadata } from 'next'
import { BookOpen, Clock, Layers } from 'lucide-react'
import { StatusBadge } from '@/components/common/badges'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied, EmptyState } from '@/components/common/states'
import { Card } from '@/components/ui/card'
import { pluralize } from '@/lib/utils'
import { firstParam } from '@/lib/validation/list-params'
import { cn } from '@/lib/utils'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { learningService } from '@/server/services/content.service'

export const metadata: Metadata = { title: 'Learning Hub' }

export default async function LearningPage({ searchParams }: PageProps<'/learning'>) {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'course.read')) return <AccessDenied what="the Learning Hub" />

  const highlight = firstParam(await searchParams, 'highlight')
  const courses = await learningService.listCourses(ctx)

  return (
    <>
      <PageHeader
        title="Learning Hub"
        description="Courses for onboarding and skill-building. Lessons, quizzes and progress tracking open in Phase 07."
      />
      {courses.length === 0 ? (
        <EmptyState icon={BookOpen} title="No courses yet" description="Published courses will appear here." />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {courses.map((course) => (
            <li key={course.id}>
              <Card className={cn('flex h-full flex-col p-5', highlight === course.id && 'ring-2 ring-ring')}>
                <span className="mb-4 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <BookOpen className="size-5" aria-hidden />
                </span>
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-h3">{course.title}</h2>
                  {course.status !== 'PUBLISHED' && <StatusBadge status={course.status} />}
                </div>
                {course.description && <p className="mt-2 text-small text-muted-foreground">{course.description}</p>}
                <div className="mt-auto flex gap-4 pt-5 text-caption text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Layers className="size-3.5" aria-hidden /> {pluralize(course.lessonCount, 'lesson')}
                  </span>
                  {course.estimatedMinutes > 0 && (
                    <span className="flex items-center gap-1.5">
                      <Clock className="size-3.5" aria-hidden /> {course.estimatedMinutes} min
                    </span>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

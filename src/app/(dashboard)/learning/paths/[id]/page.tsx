import type { Metadata } from 'next'
import Link from 'next/link'
import { StatusBadge } from '@/components/common/badges'
import { PageHeader } from '@/components/common/page-header'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { ActionButton } from '@/features/hr/components/action-form'
import { ConfirmActionButton } from '@/features/learning/components/confirm-action'
import { AssignDialog } from '@/features/learning/components/learner-actions'
import { PathCoursesEditor, PathDialog } from '@/features/learning/components/path-editor'
import { DIFFICULTY_LABELS, formatMinutes } from '@/lib/learning/rules'
import { formatDay, pluralize } from '@/lib/utils'
import { pathStatusAction } from '@/server/actions/learning'
import { requirePageContext } from '@/server/context'
import { learningService } from '@/server/services/learning.service'

export const metadata: Metadata = { title: 'Learning path' }

export default async function PathPage({ params }: PageProps<'/learning/paths/[id]'>) {
  const ctx = await requirePageContext()
  const { id } = await params
  const { path, myPlan, can } = await learningService.path(ctx, id)
  const [people, editorOptions] = await Promise.all([
    can.assign ? learningService.assignablePeople(ctx) : Promise.resolve([]),
    can.edit ? learningService.authoringOptions(ctx) : Promise.resolve(null),
  ])
  const minutes = path.courses.reduce((sum, c) => sum + (c.course.estimated_minutes ?? 0), 0)

  return (
    <>
      <PageHeader
        title={path.name}
        breadcrumbs={[{ label: 'Learning Hub', href: '/learning' }, { label: 'Learning paths', href: '/learning?view=paths' }, { label: path.name }]}
        description={path.description ?? undefined}
        actions={
          <>
            {path.status !== 'PUBLISHED' && <StatusBadge status={path.status} />}
            {can.assign && <AssignDialog kind="path" targetId={path.id} title={path.name} people={people} />}
            {editorOptions && (
              <>
                <PathDialog path={path} departments={editorOptions.departments} positions={editorOptions.positions} />
                {path.status !== 'PUBLISHED' ? (
                  <ActionButton action={pathStatusAction} fields={{ pathId: path.id, action: 'PUBLISH' }} pendingLabel="Publishing…">
                    Publish
                  </ActionButton>
                ) : (
                  <ConfirmActionButton
                    action={pathStatusAction}
                    fields={{ pathId: path.id, action: 'ARCHIVE' }}
                    title="Archive this path?"
                    description="People who already have it keep their plan. It can’t be assigned again."
                    variant="outline"
                  >
                    Archive
                  </ConfirmActionButton>
                )}
              </>
            )}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          {editorOptions ? (
            <Card className="p-5">
              <h2 className="mb-3 text-h3">Courses</h2>
              <PathCoursesEditor
                pathId={path.id}
                courses={editorOptions.courses}
                initial={path.courses.map((c) => ({
                  courseId: c.course.id,
                  title: c.course.title,
                  required: c.is_required,
                  requiresPrevious: c.requires_previous,
                  dueDays: c.due_days,
                }))}
              />
            </Card>
          ) : (
            <ol className="grid gap-3">
              {path.courses.map((c, index) => (
                <li key={c.id}>
                  <Card className="flex flex-wrap items-center gap-3 p-4">
                    <span className="flex size-8 items-center justify-center rounded-full bg-muted text-small font-medium" aria-hidden>
                      {index + 1}
                    </span>
                    <Link href={`/learning/courses/${c.course.id}`} className="min-w-0 flex-1 font-medium hover:underline">
                      {c.course.title}
                    </Link>
                    <Badge variant="neutral">{DIFFICULTY_LABELS[c.course.difficulty]}</Badge>
                    {!c.is_required && <Badge variant="outline">Optional</Badge>}
                    {c.requires_previous && index > 0 && <span className="text-caption text-muted-foreground">After the previous course</span>}
                  </Card>
                </li>
              ))}
            </ol>
          )}
        </div>
        <aside>
          <Card className="space-y-2 p-5 text-small">
            <h2 className="text-h3">Overview</h2>
            <p>{pluralize(path.courses.length, 'course')}{minutes ? ` · about ${formatMinutes(minutes)}` : ''}</p>
            {path.department && <p className="text-muted-foreground">Department: {path.department.name}</p>}
            {path.position && <p className="text-muted-foreground">Position: {path.position.title}</p>}
            {myPlan && (
              <p className="pt-2">
                <StatusBadge status={myPlan.status} /> This path is assigned to you
                {myPlan.due_date ? ` — due ${formatDay(myPlan.due_date)}` : ''}.{' '}
                <Link href={`/learning?highlight=${myPlan.id}`} className="underline">
                  See your plan
                </Link>
              </p>
            )}
          </Card>
        </aside>
      </div>
    </>
  )
}

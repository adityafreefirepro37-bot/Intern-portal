import type { Metadata } from 'next'
import Link from 'next/link'
import { Award, BookOpen, CheckCircle2, Clock, GraduationCap, Route, Search } from 'lucide-react'
import { StatusBadge } from '@/components/common/badges'
import { PageHeader } from '@/components/common/page-header'
import { StatCard } from '@/components/common/stat-card'
import { AccessDenied, EmptyState } from '@/components/common/states'
import { Pagination } from '@/components/tables/pagination'
import { buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { inputClassName } from '@/components/ui/input'
import { Progress } from '@/components/ui/misc'
import { SubTabs } from '@/features/hr/components/hr-nav'
import { CourseCard, DeadlineBadge, EnrollmentCard } from '@/features/learning/components/learning-ui'
import { DIFFICULTY_LABELS, formatMinutes, learningDeadline } from '@/lib/learning/rules'
import { cn, formatDay, pluralize } from '@/lib/utils'
import { firstParam } from '@/lib/validation/list-params'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { learningCatalogService } from '@/server/services/learning-catalog.service'
import { learningService } from '@/server/services/learning.service'

export const metadata: Metadata = { title: 'Learning Hub' }

const VIEWS = ['my', 'catalog', 'paths'] as const
type View = (typeof VIEWS)[number]

export default async function LearningPage({ searchParams }: PageProps<'/learning'>) {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'course.read')) return <AccessDenied what="the Learning Hub" />
  const params = await searchParams
  const learner = authorizationService.can(ctx, 'learning.track')
  const requested = firstParam(params, 'view') as View | undefined
  const view: View = requested && VIEWS.includes(requested) ? requested : learner ? 'my' : 'catalog'
  const highlight = firstParam(params, 'highlight')
  const can = {
    manage: authorizationService.can(ctx, 'course.update'),
    review: authorizationService.can(ctx, 'learning_assignment.review'),
    analytics: authorizationService.can(ctx, 'learning.read') && !learner,
    paths: authorizationService.can(ctx, 'learning_path.read'),
  }
  const tabs = [
    ...(learner ? [{ key: 'my', href: '/learning', label: 'My learning' }] : []),
    { key: 'catalog', href: '/learning?view=catalog', label: 'Course catalog' },
    ...(can.paths ? [{ key: 'paths', href: '/learning?view=paths', label: 'Learning paths' }] : []),
  ]

  return (
    <>
      <PageHeader
        title="Learning Hub"
        description="Courses, learning paths and required training. Progress comes from completed lessons, passed quizzes and approved assignments."
        actions={
          <>
            {can.review && (
              <Link href="/learning/reviews" className={buttonVariants({ variant: 'outline' })}>
                Reviews
              </Link>
            )}
            {can.analytics && (
              <Link href="/learning/analytics" className={buttonVariants({ variant: 'outline' })}>
                Analytics
              </Link>
            )}
            {can.manage && (
              <Link href="/learning/manage" className={buttonVariants()}>
                Manage learning
              </Link>
            )}
          </>
        }
      />
      <SubTabs items={tabs} active={view} label="Learning views" />
      {view === 'my' && <MyLearning highlight={highlight} />}
      {view === 'catalog' && <Catalog params={params} highlight={highlight} />}
      {view === 'paths' && <Paths />}
    </>
  )
}

async function MyLearning({ highlight }: { highlight?: string }) {
  const ctx = await requirePageContext()
  const hub = await learningService.hub(ctx)
  const empty = !hub.required.length && !hub.assigned.length && !hub.selfEnrolled.length && !hub.completed.length

  return (
    <div className="space-y-8">
      <section aria-label="Your learning in numbers" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Courses completed" value={hub.stats.coursesCompleted} icon={Award} />
        <StatCard label="Courses in progress" value={hub.stats.coursesActive} icon={BookOpen} />
        <StatCard
          label="Quizzes passed"
          value={hub.stats.quizzesPassed}
          hint={`${pluralize(hub.stats.quizzesAttempted, 'attempt')} in total`}
          icon={CheckCircle2}
        />
        <StatCard
          label="Learning time"
          value={hub.stats.learningMinutes ? formatMinutes(hub.stats.learningMinutes) : '0 min'}
          hint={`${pluralize(hub.stats.lessonsCompleted, 'lesson')} completed (estimated time)`}
          icon={Clock}
        />
      </section>

      {empty && (
        <EmptyState
          icon={GraduationCap}
          title="No learning yet"
          description="Courses assigned to you will appear here. You can also browse the catalog and enroll yourself."
          action={
            <Link href="/learning?view=catalog" className={buttonVariants()}>
              Browse courses
            </Link>
          }
        />
      )}

      {hub.required.length > 0 && (
        <Section title="Required training" description="Training everyone in your role must complete.">
          <Grid>
            {hub.required.map((e) => (
              <EnrollmentCard key={e.id} enrollment={e} />
            ))}
          </Grid>
        </Section>
      )}

      {hub.continueLearning.length > 0 && (
        <Section title="Continue learning">
          <Grid>
            {hub.continueLearning.map((e) => (
              <EnrollmentCard key={e.id} enrollment={e} />
            ))}
          </Grid>
        </Section>
      )}

      {hub.plans.length > 0 && (
        <Section title="Your learning paths">
          <div className="grid gap-4 lg:grid-cols-2">
            {hub.plans.map((plan) => {
              const required = plan.items.filter((i) => i.is_required)
              const done = required.filter((i) => i.completed).length
              return (
                <Card
                  key={plan.id}
                  id={`plan-${plan.id}`}
                  className={cn('p-5', highlight === plan.id && 'ring-2 ring-ring')}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="flex items-center gap-2 text-h3">
                      <Route className="size-4 text-primary" aria-hidden /> {plan.path_name}
                    </h3>
                    <StatusBadge status={plan.status} />
                  </div>
                  <p className="mt-1 text-caption text-muted-foreground">
                    {done} of {pluralize(required.length, 'required course')} done
                    {plan.due_date ? ` · due ${formatDay(plan.due_date)}` : ''}
                  </p>
                  <Progress className="mt-3" value={required.length ? (done / required.length) * 100 : 0} label={`${plan.path_name} progress`} />
                  <ol className="mt-4 space-y-2">
                    {plan.items.map((item, index) => (
                      <li key={item.course_id} className="flex items-center gap-3 text-small">
                        <span
                          className={cn(
                            'flex size-6 shrink-0 items-center justify-center rounded-full border text-caption',
                            item.completed && 'border-success bg-success/12 text-success',
                          )}
                          aria-hidden
                        >
                          {item.completed ? '✓' : index + 1}
                        </span>
                        <Link href={`/learning/courses/${item.course.id}`} className="min-w-0 flex-1 truncate hover:underline">
                          {item.course.title}
                        </Link>
                        {item.blocked && <span className="text-caption text-muted-foreground">Finish the previous course first</span>}
                        {!item.is_required && <span className="text-caption text-muted-foreground">Optional</span>}
                        {item.due_date && !item.completed && (
                          <span className="text-caption text-muted-foreground">{formatDay(item.due_date)}</span>
                        )}
                      </li>
                    ))}
                  </ol>
                </Card>
              )
            })}
          </div>
        </Section>
      )}

      {hub.upcoming.length > 0 && (
        <Section title="Upcoming deadlines">
          <Card className="divide-y">
            {hub.upcoming.map((e) => (
              <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-small">
                <Link href={`/learning/courses/${e.course_id}`} className="font-medium hover:underline">
                  {e.course.title}
                </Link>
                <DeadlineBadge deadline={learningDeadline(e.due_date, false, hub.today)} due={e.due_date} />
              </div>
            ))}
          </Card>
        </Section>
      )}

      {hub.assigned.filter((e) => e.enrollment_type === 'ASSIGNED').length > 0 && (
        <Section title="Assigned to you">
          <Grid>
            {hub.assigned
              .filter((e) => e.enrollment_type === 'ASSIGNED')
              .map((e) => (
                <EnrollmentCard key={e.id} enrollment={e} />
              ))}
          </Grid>
        </Section>
      )}

      {hub.selfEnrolled.length > 0 && (
        <Section title="Courses you joined">
          <Grid>
            {hub.selfEnrolled.map((e) => (
              <EnrollmentCard key={e.id} enrollment={e} />
            ))}
          </Grid>
        </Section>
      )}

      {hub.recommended.length > 0 && (
        <Section title="Recommended for you" description="Required courses and courses in learning paths for your department or position.">
          <Grid>
            {hub.recommended.map((c) => (
              <CourseCard key={c.id} course={{ ...c, category: null }} />
            ))}
          </Grid>
        </Section>
      )}

      {hub.completed.length > 0 && (
        <Section title="Completed">
          <Card className="divide-y">
            {hub.completed.map((e) => (
              <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-small">
                <Link href={`/learning/courses/${e.course_id}`} className="font-medium hover:underline">
                  {e.course.title}
                </Link>
                <span className="text-caption text-muted-foreground">
                  Completed {e.completed_at ? formatDay(e.completed_at) : ''}
                </span>
              </div>
            ))}
          </Card>
        </Section>
      )}
    </div>
  )
}

async function Catalog({ params, highlight }: { params: Record<string, string | string[] | undefined>; highlight?: string }) {
  const ctx = await requirePageContext()
  const flat = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]))
  const [{ query, page }, categories] = await Promise.all([
    learningCatalogService.catalog(ctx, flat),
    learningCatalogService.categories(ctx),
  ])
  return (
    <div className="space-y-5">
      <form className="grid gap-3 sm:grid-cols-[1fr_12rem_12rem_auto]" role="search" aria-label="Search courses">
        <input type="hidden" name="view" value="catalog" />
        <label className="relative">
          <span className="sr-only">Search courses</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input name="q" defaultValue={query.q} placeholder="Search courses" className={cn(inputClassName, 'pl-9')} />
        </label>
        <label>
          <span className="sr-only">Category</span>
          <select name="category" defaultValue={query.category ?? ''} className={inputClassName}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Difficulty</span>
          <select name="difficulty" defaultValue={query.difficulty ?? ''} className={inputClassName}>
            <option value="">Any difficulty</option>
            {Object.entries(DIFFICULTY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={buttonVariants({ variant: 'outline' })}>
          Filter
        </button>
      </form>
      {page.items.length === 0 ? (
        <EmptyState icon={BookOpen} title="No courses found" description="Try a different search or filter." />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {page.items.map((course) => (
            <li key={course.id}>
              <CourseCard course={course} highlight={highlight === course.id} />
            </li>
          ))}
        </ul>
      )}
      <Pagination pathname="/learning" params={flat} page={page.page} totalPages={page.totalPages} total={page.total} pageSize={page.pageSize} />
    </div>
  )
}

async function Paths() {
  const ctx = await requirePageContext()
  const paths = await learningService.paths(ctx)
  if (!paths.length) {
    return <EmptyState icon={Route} title="No learning paths yet" description="Learning paths group courses into a guided sequence." />
  }
  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {paths.map((path) => (
        <li key={path.id}>
          <Card className="relative flex h-full flex-col p-5 transition-colors hover:border-ring/40">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-h3">
                <Link
                  href={`/learning/paths/${path.id}`}
                  className="after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:rounded-xl focus-visible:after:outline-2 focus-visible:after:outline-ring"
                >
                  {path.name}
                </Link>
              </h3>
              {path.status !== 'PUBLISHED' && <StatusBadge status={path.status} />}
            </div>
            {path.description && <p className="mt-2 line-clamp-3 text-small text-muted-foreground">{path.description}</p>}
            <p className="mt-auto pt-4 text-caption text-muted-foreground">
              {pluralize(path._count.courses, 'course')}
              {path.department ? ` · ${path.department.name}` : ''}
              {path.position ? ` · ${path.position.title}` : ''}
            </p>
          </Card>
        </li>
      ))}
    </ul>
  )
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-h2">{title}</h2>
        {description && <p className="text-small text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  )
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{children}</div>
}

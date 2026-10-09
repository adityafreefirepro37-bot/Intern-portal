import type { Metadata } from 'next'
import Link from 'next/link'
import { BookOpen, Route, ShieldCheck } from 'lucide-react'
import { StatusBadge } from '@/components/common/badges'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied, EmptyState } from '@/components/common/states'
import { DataTable } from '@/components/tables/data-table'
import { Pagination } from '@/components/tables/pagination'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { SubTabs } from '@/features/hr/components/hr-nav'
import { ConfirmActionButton } from '@/features/learning/components/confirm-action'
import { CategoryDialog, CourseDialog } from '@/features/learning/components/course-builder'
import { PathDialog, RequiredRuleDialog } from '@/features/learning/components/path-editor'
import { DIFFICULTY_LABELS } from '@/lib/learning/rules'
import { formatDay, pluralize } from '@/lib/utils'
import { firstParam } from '@/lib/validation/list-params'
import { deactivateRequiredRuleAction } from '@/server/actions/learning'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { learningCatalogService } from '@/server/services/learning-catalog.service'
import { learningService } from '@/server/services/learning.service'

export const metadata: Metadata = { title: 'Manage learning' }

const TARGET_LABELS: Record<string, string> = {
  EVERYONE: 'Every intern',
  DEPARTMENT: 'Department',
  POSITION: 'Position',
  INTERN: 'Intern',
  ONBOARDING_TEMPLATE: 'Onboarding template',
}

export default async function ManageLearningPage({ searchParams }: PageProps<'/learning/manage'>) {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'course.update')) return <AccessDenied what="course management" />
  const params = await searchParams
  const flat = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]))
  const orgManage = authorizationService.scopeOf(ctx, 'learning.manage') === 'ORGANIZATION'
  const canPaths = authorizationService.can(ctx, 'learning_path.update')
  const view = (['courses', 'paths', 'required', 'categories'] as const).find((v) => v === firstParam(params, 'view')) ?? 'courses'
  const tabs = [
    { key: 'courses', href: '/learning/manage', label: 'Courses' },
    ...(canPaths ? [{ key: 'paths', href: '/learning/manage?view=paths', label: 'Learning paths' }] : []),
    ...(orgManage ? [{ key: 'required', href: '/learning/manage?view=required', label: 'Required training' }] : []),
    { key: 'categories', href: '/learning/manage?view=categories', label: 'Categories' },
  ]
  const options = await learningService.authoringOptions(ctx)

  return (
    <>
      <PageHeader
        title="Manage learning"
        breadcrumbs={[{ label: 'Learning Hub', href: '/learning' }, { label: 'Manage' }]}
        description="Build courses, group them into paths and set required training."
        actions={
          authorizationService.can(ctx, 'course.create') ? (
            <CourseDialog categories={await learningCatalogService.categories(ctx)} />
          ) : undefined
        }
      />
      <SubTabs items={tabs} active={view} label="Management views" />

      {view === 'courses' && <Courses flat={flat} />}

      {view === 'paths' && canPaths && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <PathDialog departments={options.departments} positions={options.positions} />
          </div>
          <PathList />
        </div>
      )}

      {view === 'required' && orgManage && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-2xl text-small text-muted-foreground">
              Rules enroll matching interns now and new interns automatically. Turning a rule off keeps existing enrollments.
            </p>
            <RequiredRuleDialog
              courses={options.publishedCourses}
              options={{
                DEPARTMENT: options.departments,
                POSITION: options.positions,
                ONBOARDING_TEMPLATE: options.templates,
                INTERN: options.interns,
              }}
            />
          </div>
          <Rules
            names={Object.fromEntries(
              [...options.departments, ...options.positions, ...options.templates, ...options.interns].map((o) => [o.id, o.name]),
            )}
          />
        </div>
      )}

      {view === 'categories' && <Categories />}
    </>
  )
}

async function Courses({ flat }: { flat: Record<string, string | undefined> }) {
  const ctx = await requirePageContext()
  const { page } = await learningCatalogService.manageList(ctx, flat)
  return (
    <>
      <DataTable
        caption="Courses"
        rows={page.items}
        getRowId={(c) => c.id}
        empty={<EmptyState icon={BookOpen} title="No courses yet" description="Create a course to start building content." />}
        columns={[
          {
            key: 'title',
            header: 'Course',
            cell: (c) => (
              <Link href={`/learning/manage/courses/${c.id}`} className="font-medium hover:underline">
                {c.title}
              </Link>
            ),
          },
          { key: 'status', header: 'Status', cell: (c) => <StatusBadge status={c.status} /> },
          { key: 'difficulty', header: 'Difficulty', cell: (c) => DIFFICULTY_LABELS[c.difficulty], hideBelow: 'md' },
          {
            key: 'content',
            header: 'Content',
            hideBelow: 'md',
            cell: (c) =>
              `${pluralize(c._count.lessons, 'lesson')} · ${pluralize(c._count.quizzes, 'quiz', 'quizzes')} · ${pluralize(c._count.assignments, 'assignment')}`,
          },
          { key: 'learners', header: 'Learners', cell: (c) => c._count.enrollments, align: 'right' },
          { key: 'updated', header: 'Updated', cell: (c) => formatDay(c.updated_at), hideBelow: 'sm' },
        ]}
      />
      <Pagination pathname="/learning/manage" params={flat} page={page.page} totalPages={page.totalPages} total={page.total} pageSize={page.pageSize} />
    </>
  )
}

async function PathList() {
  const ctx = await requirePageContext()
  const paths = await learningService.paths(ctx)
  return (
    <DataTable
      caption="Learning paths"
      rows={paths}
      getRowId={(p) => p.id}
      empty={<EmptyState icon={Route} title="No learning paths yet" description="Paths put courses in a guided order for a role." />}
      columns={[
        {
          key: 'name',
          header: 'Path',
          cell: (p) => (
            <Link href={`/learning/paths/${p.id}`} className="font-medium hover:underline">
              {p.name}
            </Link>
          ),
        },
        { key: 'status', header: 'Status', cell: (p) => <StatusBadge status={p.status} /> },
        { key: 'courses', header: 'Courses', cell: (p) => p._count.courses, align: 'right' },
        { key: 'plans', header: 'Active plans', cell: (p) => p._count.plans, align: 'right', hideBelow: 'sm' },
        { key: 'for', header: 'For', cell: (p) => p.department?.name ?? p.position?.title ?? 'Anyone', hideBelow: 'md' },
      ]}
    />
  )
}

async function Rules({ names }: { names: Record<string, string> }) {
  const ctx = await requirePageContext()
  const rules = await learningService.requiredRules(ctx)
  return (
    <DataTable
      caption="Required training rules"
      rows={rules}
      getRowId={(r) => r.id}
      empty={<EmptyState icon={ShieldCheck} title="No required training yet" description="Add a rule to enroll interns in a course automatically." />}
      columns={[
        {
          key: 'course',
          header: 'Course',
          cell: (r) => (
            <Link href={`/learning/courses/${r.course.id}`} className="font-medium hover:underline">
              {r.course.title}
            </Link>
          ),
        },
        {
          key: 'target',
          header: 'Applies to',
          cell: (r) => `${TARGET_LABELS[r.target_type]}${r.target_id ? `: ${names[r.target_id] ?? '—'}` : ''}`,
        },
        { key: 'due', header: 'Due within', cell: (r) => `${r.due_days} days`, hideBelow: 'sm' },
        { key: 'enrolled', header: 'Enrolled', cell: (r) => r._count.enrollments, align: 'right', hideBelow: 'sm' },
        {
          key: 'state',
          header: 'Status',
          cell: (r) =>
            r.is_active ? (
              <ConfirmActionButton
                action={deactivateRequiredRuleAction}
                fields={{ ruleId: r.id }}
                title="Turn off this rule?"
                description="New interns won’t be enrolled any more. Existing enrollments stay."
                size="sm"
                variant="outline"
              >
                Turn off
              </ConfirmActionButton>
            ) : (
              <Badge variant="outline">Off</Badge>
            ),
        },
      ]}
    />
  )
}

async function Categories() {
  const ctx = await requirePageContext()
  const categories = await learningCatalogService.allCategories(ctx)
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-h3">Categories</h2>
        <CategoryDialog />
      </div>
      <ul className="divide-y">
        {categories.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-3 py-2.5 text-small">
            <span className="min-w-0 flex-1 font-medium">{c.name}</span>
            {!c.is_active && <Badge variant="outline">Inactive</Badge>}
            <span className="text-caption text-muted-foreground">{pluralize(c._count.courses, 'course')}</span>
            <CategoryDialog category={c} />
          </li>
        ))}
        {categories.length === 0 && <li className="py-2.5 text-small text-muted-foreground">No categories yet.</li>}
      </ul>
    </Card>
  )
}

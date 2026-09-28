import type { Metadata } from 'next'
import { FolderKanban, FolderPlus } from 'lucide-react'
import { PhaseBadge, StatusBadge } from '@/components/common/badges'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied, EmptyState } from '@/components/common/states'
import { AvatarGroup } from '@/components/common/user-avatar'
import { FilterBar } from '@/components/tables/filter-bar'
import { Pagination } from '@/components/tables/pagination'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/misc'
import { cn, formatDate, fullName, humanizeEnum } from '@/lib/utils'
import { readListParams } from '@/lib/validation/list-params'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { projectService } from '@/server/services/project.service'

export const metadata: Metadata = { title: 'Projects' }

const STATUSES = ['PLANNED', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED'] as const

export default async function ProjectsPage({ searchParams }: PageProps<'/projects'>) {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'project.read')) return <AccessDenied what="projects" />

  const { pagination, status, highlight, raw } = readListParams(await searchParams, {
    statuses: STATUSES,
    pageSize: 12,
  })
  const page = await projectService.list(ctx, pagination, { statuses: status ? [status] : undefined })
  const tz = ctx.organization.timezone

  return (
    <>
      <PageHeader
        title="Projects"
        description="Client and internal work with progress from completed tasks. Project management tools arrive in Phase 04."
        actions={
          authorizationService.can(ctx, 'project.create') && (
            <Button disabled>
              <FolderPlus aria-hidden /> New project
              <PhaseBadge phase="04" className="border-primary-foreground/40 text-primary-foreground" />
            </Button>
          )
        }
      />

      <FilterBar
        label="Filter projects by status"
        param="status"
        pathname="/projects"
        params={raw}
        options={STATUSES.map((value) => ({ value, label: humanizeEnum(value) }))}
      />

      {page.items.length === 0 ? (
        <EmptyState icon={FolderKanban} title="No projects" description="Projects appear here once they’re created." />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {page.items.map((project) => (
            <li key={project.id} id={`row-${project.id}`}>
              <Card className={cn('flex h-full flex-col p-5', highlight === project.id && 'ring-2 ring-ring')}>
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-h3">{project.name}</h2>
                  <StatusBadge status={project.status} />
                </div>
                {project.description && (
                  <p className="mt-2 line-clamp-2 text-small text-muted-foreground">{project.description}</p>
                )}
                <div className="mt-5 space-y-2">
                  <div className="flex justify-between text-caption text-muted-foreground">
                    <span>
                      {project.taskCount > 0
                        ? `${project.completedTaskCount}/${project.taskCount} tasks`
                        : 'No tasks yet'}
                    </span>
                    <span className="tabular font-medium text-foreground">{project.progressPercent}%</span>
                  </div>
                  <Progress value={project.progressPercent} label={`${project.name} progress`} />
                </div>
                <dl className="mt-5 grid grid-cols-2 gap-3 border-t pt-4 text-small">
                  <div>
                    <dt className="text-caption text-muted-foreground">Owner</dt>
                    <dd className="truncate">{project.owner ? fullName(project.owner) : '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-caption text-muted-foreground">Target</dt>
                    <dd>{formatDate(project.target_end_date, tz)}</dd>
                  </div>
                </dl>
                <div className="mt-auto pt-4">
                  <AvatarGroup
                    people={project.members.map((member) => member.user)}
                    total={project._count.members}
                    max={5}
                  />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Pagination
        pathname="/projects"
        params={raw}
        page={page.page}
        totalPages={page.totalPages}
        total={page.total}
        pageSize={page.pageSize}
      />
    </>
  )
}

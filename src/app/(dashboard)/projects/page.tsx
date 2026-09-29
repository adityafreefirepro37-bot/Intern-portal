import type { Metadata } from 'next'
import Link from 'next/link'
import { FolderKanban } from 'lucide-react'
import { PriorityBadge, StatusBadge } from '@/components/common/badges'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied, EmptyState } from '@/components/common/states'
import { AvatarGroup, UserAvatar } from '@/components/common/user-avatar'
import { Pagination } from '@/components/tables/pagination'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/misc'
import { NewProjectButton } from '@/features/work/components/project-controls'
import { ProjectFilters } from '@/features/work/components/project-filters'
import { formatDay, fullName } from '@/lib/utils'
import { PROJECT_STATUS_LABELS, PROJECT_STATUSES } from '@/lib/work/projects'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { projectService } from '@/server/services/project.service'

export const metadata: Metadata = { title: 'Projects' }

const SORTS = [
  { value: 'status', label: 'Status' },
  { value: 'name', label: 'Name' },
  { value: 'due', label: 'Target date' },
  { value: 'start', label: 'Start date' },
  { value: 'progress', label: 'Progress' },
  { value: 'updated', label: 'Last updated' },
]

/** Projects within the viewer's scope (organization-wide, or ones they or their interns belong to). */
export default async function ProjectsPage({ searchParams }: PageProps<'/projects'>) {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'project.read')) return <AccessDenied what="projects" />

  const raw = Object.fromEntries(
    Object.entries(await searchParams).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v]] : [])),
  )
  const [{ page, byStatus }, managers] = await Promise.all([
    projectService.directory(ctx, raw),
    projectService.managerOptions(ctx),
  ])
  const canCreate = authorizationService.can(ctx, 'project.create')
  const filtered = Object.keys(raw).some((key) => !['page', 'sort', 'dir'].includes(key))
  const params = Object.fromEntries(Object.entries(raw).filter(([key]) => key !== 'page'))
  const active = (byStatus.ACTIVE ?? 0) + (byStatus.PLANNING ?? 0) + (byStatus.ON_HOLD ?? 0)

  return (
    <>
      <PageHeader
        title="Projects"
        description={`${active} open project${active === 1 ? '' : 's'} · progress is calculated from completed tasks.`}
        actions={canCreate && <NewProjectButton managers={managers} />}
      />
      <ProjectFilters
        statuses={PROJECT_STATUSES.map((s) => ({
          value: s,
          label: `${PROJECT_STATUS_LABELS[s]} (${byStatus[s] ?? 0})`,
        }))}
        managers={managers.map((m) => ({ value: m.id, label: m.name }))}
        sorts={SORTS}
      />
      {page.items.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title={filtered ? 'No projects match' : 'No projects yet'}
          description={
            filtered
              ? 'Try a different search or clear the filters.'
              : canCreate
                ? 'Create a project to organise milestones, tasks and files.'
                : 'Projects you’re added to will appear here.'
          }
          action={!filtered && canCreate && <NewProjectButton managers={managers} />}
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {page.items.map((project) => (
            <li key={project.id}>
              <Card className="relative flex h-full flex-col gap-4 p-5 transition-colors hover:border-ring/40">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <Link
                      href={`/projects/${project.id}`}
                      className="block truncate font-medium after:absolute after:inset-0"
                    >
                      {project.name}
                    </Link>
                    {project.description && (
                      <p className="line-clamp-2 text-small text-muted-foreground">{project.description}</p>
                    )}
                  </div>
                  <StatusBadge status={project.status} />
                </div>
                <div className="mt-auto space-y-3">
                  <div className="flex items-center gap-3">
                    <Progress
                      value={project.progress_percentage}
                      label={`${project.name} progress ${project.progress_percentage}%`}
                    />
                    <span className="tabular shrink-0 text-caption font-medium">{project.progress_percentage}%</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-caption text-muted-foreground">
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                      {project.manager && <UserAvatar person={project.manager} className="size-5" />}
                      <span className="truncate">{project.manager ? fullName(project.manager) : 'No manager'}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <PriorityBadge priority={project.priority} />
                      <AvatarGroup people={project.members.map((m) => m.user)} max={3} total={project._count.members} />
                    </span>
                  </div>
                  <p className="text-caption text-muted-foreground">
                    {formatDay(project.start_date)} → {formatDay(project.target_end_date)}
                  </p>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <Pagination
        pathname="/projects"
        params={params}
        page={page.page}
        totalPages={page.totalPages}
        total={page.total}
        pageSize={page.pageSize}
      />
    </>
  )
}

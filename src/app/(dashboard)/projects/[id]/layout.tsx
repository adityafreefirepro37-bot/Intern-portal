import { notFound } from 'next/navigation'
import { PriorityBadge, StatusBadge } from '@/components/common/badges'
import { AccessDenied } from '@/components/common/states'
import { UserAvatar } from '@/components/common/user-avatar'
import { Breadcrumbs } from '@/components/navigation/breadcrumbs'
import { Progress } from '@/components/ui/misc'
import { ProjectTabs } from '@/features/work/components/project-tabs'
import { ForbiddenError, NotFoundError } from '@/lib/errors'
import { formatDay, fullName, pluralize } from '@/lib/utils'
import { idSchema } from '@/lib/validation'
import { requirePageContext } from '@/server/context'
import { projectService } from '@/server/services/project.service'

/**
 * Project shell: header (status, manager, team, dates, progress) and section
 * tabs. Access is resolved here and again by each section's service call, so
 * an out-of-scope project is a 404 everywhere.
 */
export default async function ProjectLayout({ children, params }: LayoutProps<'/projects/[id]'>) {
  const ctx = await requirePageContext()
  const { id } = await params
  if (!idSchema.safeParse(id).success) notFound()

  let header: Awaited<ReturnType<typeof projectService.getHeader>>
  try {
    header = await projectService.getHeader(ctx, id)
  } catch (error) {
    if (error instanceof NotFoundError) notFound()
    if (error instanceof ForbiddenError) return <AccessDenied what="projects" />
    throw error
  }
  const { project, access } = header
  const base = `/projects/${project.id}`
  const tabs = [
    { segment: '', label: 'Overview' },
    { segment: 'tasks', label: 'Tasks' },
    { segment: 'milestones', label: 'Milestones' },
    { segment: 'files', label: 'Files' },
    { segment: 'team', label: 'Team' },
    { segment: 'activity', label: 'Activity' },
    ...(access.can.edit || access.can.archive ? [{ segment: 'settings', label: 'Settings' }] : []),
  ]

  return (
    <>
      <Breadcrumbs items={[{ label: 'Projects', href: '/projects' }, { label: project.name }]} />
      <header className="mb-5 mt-2 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-h1 text-balance">{project.name}</h1>
          <StatusBadge status={project.status} />
          <PriorityBadge priority={project.priority} />
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-small text-muted-foreground">
          <span className="inline-flex items-center gap-2">
            {project.manager ? (
              <>
                <UserAvatar person={project.manager} className="size-6" /> {fullName(project.manager)}
              </>
            ) : (
              'No manager'
            )}
          </span>
          <span>{pluralize(project._count.members, 'member')}</span>
          <span>
            {formatDay(project.start_date)} → {formatDay(project.target_end_date)}
          </span>
        </div>
        <div className="flex max-w-md items-center gap-3">
          <Progress value={project.progress_percentage} label={`Project progress ${project.progress_percentage}%`} />
          <span className="tabular shrink-0 text-small font-medium">{project.progress_percentage}%</span>
        </div>
      </header>
      <ProjectTabs base={base} tabs={tabs} />
      {children}
    </>
  )
}

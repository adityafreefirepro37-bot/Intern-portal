import Link from 'next/link'
import { FolderKanban } from 'lucide-react'
import { StatusBadge } from '@/components/common/badges'
import { EmptyState } from '@/components/common/states'
import { Progress } from '@/components/ui/misc'
import { formatDate } from '@/lib/utils'
import type { ProjectListItem } from '@/server/services/project.service'

export function ProjectProgress({ projects, timeZone }: { projects: ProjectListItem[]; timeZone: string }) {
  if (projects.length === 0) {
    return (
      <EmptyState
        compact
        icon={FolderKanban}
        title="No active projects"
        description="Projects in progress will show here."
      />
    )
  }
  return (
    <ul className="space-y-5">
      {projects.map((project) => (
        <li key={project.id} className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Link href={`/projects/${project.id}`} className="block truncate text-small font-medium hover:underline">
                {project.name}
              </Link>
              <p className="text-caption text-muted-foreground">
                {project.taskCount > 0
                  ? `${project.completedTaskCount} of ${project.taskCount} tasks done`
                  : 'No tasks yet'}
                {project.target_end_date && ` · Target ${formatDate(project.target_end_date, timeZone)}`}
              </p>
            </div>
            <StatusBadge status={project.status} />
          </div>
          <Progress value={project.progressPercent} label={`${project.name} progress`} />
        </li>
      ))}
    </ul>
  )
}

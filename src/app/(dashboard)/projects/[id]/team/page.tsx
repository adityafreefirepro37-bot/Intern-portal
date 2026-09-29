import type { Metadata } from 'next'
import { UserAvatar } from '@/components/common/user-avatar'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AddMemberForm, MemberMenu } from '@/features/work/components/project-controls'
import { formatDay, fullName } from '@/lib/utils'
import { MEMBER_ROLE_LABELS } from '@/lib/work/projects'
import { requirePageContext } from '@/server/context'
import { projectService } from '@/server/services/project.service'

export const metadata: Metadata = { title: 'Project team' }

export default async function ProjectTeamPage({ params }: PageProps<'/projects/[id]/team'>) {
  const ctx = await requirePageContext()
  const { id } = await params
  const { access, project, candidates } = await projectService.listMembers(ctx, id)
  const canManage = access.can.manageMembers

  return (
    <div className="space-y-6">
      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Add people</CardTitle>
            <CardDescription>
              Managers lead the project; mentors create tasks and review work; contributors do the work; viewers can
              only read. Interns can be contributors or viewers.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {candidates.length === 0 ? (
              <p className="text-small text-muted-foreground">
                Everyone in the organization is already on this project.
              </p>
            ) : (
              <AddMemberForm projectId={access.project.id} candidates={candidates} />
            )}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Members ({project.members.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {project.members.map((member) => {
              const isOwner = member.role === 'OWNER' || project.owner?.id === member.user.id
              return (
                <li key={member.user.id} className="flex items-center gap-3 py-3">
                  <UserAvatar person={member.user} className="size-9" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{fullName(member.user)}</p>
                    <p className="truncate text-caption text-muted-foreground">
                      {member.user.email} · added {formatDay(member.created_at)}
                    </p>
                  </div>
                  {member.user.intern && <Badge variant="outline">Intern</Badge>}
                  <Badge variant={member.role === 'OWNER' || member.role === 'MANAGER' ? 'primary' : 'neutral'}>
                    {MEMBER_ROLE_LABELS[member.role]}
                  </Badge>
                  {canManage && (
                    <MemberMenu
                      projectId={access.project.id}
                      member={{
                        id: member.user.id,
                        name: fullName(member.user),
                        role: member.role,
                        isIntern: Boolean(member.user.intern),
                        isOwner,
                      }}
                    />
                  )}
                </li>
              )
            })}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}

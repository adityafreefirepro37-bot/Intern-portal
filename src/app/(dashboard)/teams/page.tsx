import type { Metadata } from 'next'
import { Building2 } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied, EmptyState } from '@/components/common/states'
import { UserAvatar } from '@/components/common/user-avatar'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  ArchiveButton,
  DepartmentDialog,
  PositionDialog,
  TeamDialog,
} from '@/features/organization/components/structure-controls'
import { fullName, pluralize } from '@/lib/utils'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { organizationStructureService, type StructureView } from '@/server/services/organization-structure.service'

export const metadata: Metadata = { title: 'Teams' }

type Department = StructureView['departments'][number]
type Team = Department['teams'][number]
type Position = Department['positions'][number]
type Can = StructureView['can']
type Members = StructureView['members']
type Option = { id: string; name: string }

export default async function TeamsPage() {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'team.read')) return <AccessDenied what="teams" />

  const { departments, unassignedTeams, unassignedPositions, members, can } = await organizationStructureService.manage(ctx)
  const manages =
    can.department.update || can.department.archive || can.team.update || can.team.archive || can.position.manage
  const active = departments.filter((d) => d.is_active)
  const departmentOptions = active.map((d) => ({ id: d.id, name: d.name }))
  const looseTeams = unassignedTeams.filter((t) => t.is_active)
  const loosePositions = unassignedPositions.filter((p) => p.is_active)
  const archived = manages
    ? [
        ...departments.filter((d) => !d.is_active).map((d) => ({ kind: 'department' as const, id: d.id, name: d.name, where: null })),
        ...[...departments.flatMap((d) => d.teams.map((t) => ({ t, where: d.name }))), ...unassignedTeams.map((t) => ({ t, where: null }))]
          .filter(({ t }) => !t.is_active)
          .map(({ t, where }) => ({ kind: 'team' as const, id: t.id, name: t.name, where })),
        ...[
          ...departments.flatMap((d) => d.positions.map((p) => ({ p, where: d.name }))),
          ...unassignedPositions.map((p) => ({ p, where: null })),
        ]
          .filter(({ p }) => !p.is_active)
          .map(({ p, where }) => ({ kind: 'position' as const, id: p.id, name: p.title, where })),
      ]
    : []
  const canArchive = { department: can.department.archive, team: can.team.archive, position: can.position.manage }

  return (
    <>
      <PageHeader
        title="Teams"
        description={`How ${ctx.organization.name} is organised: departments, their teams and the positions interns are placed in.`}
        actions={
          <div className="flex flex-wrap gap-2">
            {can.department.create && <DepartmentDialog members={members} />}
            {can.team.create && <TeamDialog departments={departmentOptions} members={members} />}
            {can.position.manage && <PositionDialog departments={departmentOptions} />}
          </div>
        }
      />
      {active.length === 0 && looseTeams.length === 0 && loosePositions.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No departments"
          description={
            can.department.create
              ? 'Create the first department to start organising interns.'
              : 'Departments appear here once they’re set up.'
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {active.map((department) => (
            <Card key={department.id}>
              <CardHeader className="flex-row items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <CardTitle>{department.name}</CardTitle>
                  {department.description && (
                    <p className="text-small text-muted-foreground">{department.description}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Badge variant="neutral">{pluralize(department._count.interns, 'current intern')}</Badge>
                  {can.department.update && <DepartmentDialog department={department} members={members} />}
                  {can.department.archive && (
                    <ArchiveButton kind="department" id={department.id} name={department.name} active />
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {department.head && (
                  <div className="flex items-center gap-2 text-small">
                    <UserAvatar person={department.head} className="size-6" />
                    <span className="text-muted-foreground">Head:</span> {fullName(department.head)}
                  </div>
                )}
                <TeamList
                  teams={department.teams.filter((t) => t.is_active)}
                  can={can}
                  members={members}
                  departments={departmentOptions}
                />
                <PositionList
                  positions={department.positions.filter((p) => p.is_active)}
                  can={can}
                  departments={departmentOptions}
                />
              </CardContent>
            </Card>
          ))}
          {(looseTeams.length > 0 || loosePositions.length > 0) && (
            <Card>
              <CardHeader>
                <CardTitle>Not in a department</CardTitle>
                <p className="text-small text-muted-foreground">Teams and positions shared across departments.</p>
              </CardHeader>
              <CardContent className="space-y-4">
                {looseTeams.length > 0 && (
                  <TeamList teams={looseTeams} can={can} members={members} departments={departmentOptions} />
                )}
                <PositionList positions={loosePositions} can={can} departments={departmentOptions} />
              </CardContent>
            </Card>
          )}
        </div>
      )}
      {archived.length > 0 && (
        <section className="mt-8 space-y-3" aria-labelledby="archived-heading">
          <h2 id="archived-heading" className="text-h3">
            Archived
          </h2>
          <ul className="divide-y rounded-lg border bg-card">
            {archived.map((item) => (
              <li key={`${item.kind}:${item.id}`} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-small font-medium">{item.name}</p>
                  <p className="text-caption capitalize text-muted-foreground">
                    {item.kind}
                    {item.where && <span className="normal-case"> · {item.where}</span>}
                  </p>
                </div>
                {canArchive[item.kind] && <ArchiveButton kind={item.kind} id={item.id} name={item.name} active={false} />}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

function TeamList({ teams, can, members, departments }: { teams: Team[]; can: Can; members: Members; departments: Option[] }) {
  if (teams.length === 0) return <p className="text-small text-muted-foreground">No teams yet.</p>
  return (
    <ul className="divide-y rounded-lg border">
      {teams.map((team) => (
        <li key={team.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
          <div className="min-w-0">
            <p className="text-small font-medium">{team.name}</p>
            {team.team_lead && (
              <p className="truncate text-caption text-muted-foreground">Lead: {fullName(team.team_lead)}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <span className="tabular text-caption text-muted-foreground">{pluralize(team._count.interns, 'intern')}</span>
            {can.team.update && <TeamDialog team={team} departments={departments} members={members} />}
            {can.team.archive && <ArchiveButton kind="team" id={team.id} name={team.name} active />}
          </div>
        </li>
      ))}
    </ul>
  )
}

function PositionList({ positions, can, departments }: { positions: Position[]; can: Can; departments: Option[] }) {
  if (positions.length === 0) return null
  if (!can.position.manage) {
    return (
      <div className="flex flex-wrap gap-1.5" aria-label="Positions">
        {positions.map((position) => (
          <Badge key={position.id} variant="outline">
            {position.title}
          </Badge>
        ))}
      </div>
    )
  }
  return (
    <div className="space-y-1.5">
      <p className="text-caption font-medium text-muted-foreground">Positions</p>
      <ul className="divide-y rounded-lg border">
        {positions.map((position) => (
          <li key={position.id} className="flex items-center justify-between gap-3 px-3 py-2">
            <span className="min-w-0 truncate text-small">{position.title}</span>
            <div className="flex shrink-0 items-center gap-1">
              <span className="tabular text-caption text-muted-foreground">
                {pluralize(position._count.interns, 'intern')}
              </span>
              <PositionDialog position={position} departments={departments} />
              <ArchiveButton kind="position" id={position.id} name={position.title} active />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

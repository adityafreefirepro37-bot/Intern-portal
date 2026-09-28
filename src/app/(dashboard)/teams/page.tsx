import type { Metadata } from 'next'
import { Building2 } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied, EmptyState } from '@/components/common/states'
import { UserAvatar } from '@/components/common/user-avatar'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { fullName, pluralize } from '@/lib/utils'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { organizationService } from '@/server/services/content.service'

export const metadata: Metadata = { title: 'Teams' }

export default async function TeamsPage() {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'team.read')) return <AccessDenied what="teams" />

  const departments = await organizationService.getStructure(ctx)

  return (
    <>
      <PageHeader
        title="Teams"
        description={`How ${ctx.organization.name} is organised. Editing departments and teams arrives in Phase 03.`}
      />
      {departments.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No departments"
          description="Departments appear here once they’re set up."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {departments.map((department) => (
            <Card key={department.id}>
              <CardHeader className="flex-row items-start justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle>{department.name}</CardTitle>
                  {department.description && (
                    <p className="text-small text-muted-foreground">{department.description}</p>
                  )}
                </div>
                <Badge variant="neutral">{pluralize(department._count.interns, 'intern')}</Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                {department.head && (
                  <div className="flex items-center gap-2 text-small">
                    <UserAvatar person={department.head} className="size-6" />
                    <span className="text-muted-foreground">Head:</span> {fullName(department.head)}
                  </div>
                )}
                {department.teams.length > 0 ? (
                  <ul className="divide-y rounded-lg border">
                    {department.teams.map((team) => (
                      <li key={team.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                        <div className="min-w-0">
                          <p className="text-small font-medium">{team.name}</p>
                          {team.team_lead && (
                            <p className="truncate text-caption text-muted-foreground">
                              Lead: {fullName(team.team_lead)}
                            </p>
                          )}
                        </div>
                        <span className="tabular shrink-0 text-caption text-muted-foreground">
                          {pluralize(team._count.interns, 'intern')}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-small text-muted-foreground">No teams yet.</p>
                )}
                {department.positions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5" aria-label="Positions">
                    {department.positions.map((position) => (
                      <Badge key={position.id} variant="outline">
                        {position.title}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}

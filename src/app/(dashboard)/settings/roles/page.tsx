import type { Metadata } from 'next'
import { Lock } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied } from '@/components/common/states'
import { Badge, type BadgeVariant } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { humanizeEnum, pluralize } from '@/lib/utils'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { userService } from '@/server/services/user.service'

export const metadata: Metadata = { title: 'Roles & permissions' }

const SCOPE_TONE: Record<string, BadgeVariant> = {
  ORGANIZATION: 'primary',
  DEPARTMENT: 'info',
  TEAM: 'info',
  ASSIGNED: 'warning',
  OWN: 'neutral',
}

export default async function RolesPage() {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'role.read')) return <AccessDenied what="roles" />
  const roles = await userService.listRoles(ctx)

  return (
    <>
      <PageHeader
        title="Roles & permissions"
        breadcrumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Roles & permissions' }]}
        description="Each permission applies within a scope: Own records, Assigned interns, Team, Department or the whole Organization. System roles are protected; editing custom roles arrives in Phase 09."
      />
      <div className="grid gap-4">
        {roles.map((role) => {
          const byResource = new Map<string, { action: string; scope: string; description: string | null }[]>()
          for (const grant of role.role_permissions) {
            const list = byResource.get(grant.permission.resource) ?? []
            list.push({
              action: grant.permission.action,
              scope: grant.scope,
              description: grant.permission.description,
            })
            byResource.set(grant.permission.resource, list)
          }
          return (
            <Card key={role.id}>
              <CardHeader className="gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle>{role.name}</CardTitle>
                  {role.is_system_role && (
                    <Badge variant="outline">
                      <Lock aria-hidden /> System role
                    </Badge>
                  )}
                  <Badge variant="neutral">{pluralize(role._count.user_roles, 'user')}</Badge>
                  <Badge variant="neutral">{pluralize(role.role_permissions.length, 'permission')}</Badge>
                </div>
                {role.description && <p className="text-small text-muted-foreground">{role.description}</p>}
              </CardHeader>
              <CardContent>
                <details className="group">
                  <summary className="cursor-pointer text-small font-medium text-primary">Show permissions</summary>
                  <dl className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {[...byResource.entries()]
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([resource, grants]) => (
                        <div key={resource} className="rounded-lg border p-3">
                          <dt className="mb-2 text-label">{humanizeEnum(resource)}</dt>
                          <dd className="flex flex-wrap gap-1.5">
                            {grants.map((grant) => (
                              <Badge
                                key={grant.action}
                                variant={SCOPE_TONE[grant.scope] ?? 'neutral'}
                                title={grant.description ?? undefined}
                              >
                                {grant.action.replace(/_/g, ' ')}
                                {grant.scope !== 'ORGANIZATION' && (
                                  <span className="opacity-75">· {grant.scope.toLowerCase()}</span>
                                )}
                              </Badge>
                            ))}
                          </dd>
                        </div>
                      ))}
                  </dl>
                </details>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </>
  )
}

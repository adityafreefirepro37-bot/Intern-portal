import type { Metadata } from 'next'
import { UsersRound } from 'lucide-react'
import { StatusBadge } from '@/components/common/badges'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied, EmptyState } from '@/components/common/states'
import { UserAvatar } from '@/components/common/user-avatar'
import { DataTable } from '@/components/tables/data-table'
import { Pagination } from '@/components/tables/pagination'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { inputClassName } from '@/components/ui/input'
import { InviteUserDialog, RevokeInvitationButton, UserRowActions } from '@/features/users/components/user-admin'
import { cn, formatDate, fullName } from '@/lib/utils'
import { firstParam, readListParams } from '@/lib/validation/list-params'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { organizationService } from '@/server/services/content.service'
import { invitationService } from '@/server/services/invitation.service'
import { userListFilterSchema, userService } from '@/server/services/user.service'

export const metadata: Metadata = { title: 'Users' }

export default async function UsersPage({ searchParams }: PageProps<'/users'>) {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'user.read')) return <AccessDenied what="user management" />

  const params = await searchParams
  const { pagination } = readListParams(params, { pageSize: 25 })
  const parsed = userListFilterSchema.safeParse({
    search: firstParam(params, 'q') || undefined,
    status: firstParam(params, 'status') || undefined,
    roleId: firstParam(params, 'role') || undefined,
    departmentId: firstParam(params, 'department') || undefined,
  })
  const filter = parsed.success ? parsed.data : {}

  const canInvite = authorizationService.can(ctx, 'user.invite')
  const [page, roles, assignable, invitations, departments] = await Promise.all([
    userService.list(ctx, pagination, filter),
    userService.listRoles(ctx).catch(() => []),
    userService.assignableRoles(ctx),
    canInvite ? invitationService.listPending(ctx) : Promise.resolve([]),
    organizationService.listDepartments(ctx).catch(() => []),
  ])
  const assignableIds = new Set(assignable.map((role) => role.id))
  const can = {
    assignRole: authorizationService.can(ctx, 'user.assign_role'),
    suspend: authorizationService.can(ctx, 'user.suspend'),
    deactivate: authorizationService.can(ctx, 'user.delete'),
  }
  type Row = (typeof page.items)[number]
  const raw = {
    q: filter.search,
    status: filter.status,
    role: filter.roleId,
    department: filter.departmentId,
    page: pagination.page > 1 ? String(pagination.page) : undefined,
  }

  return (
    <>
      <PageHeader
        title="Users"
        description="Everyone with an Intern OS account. Changes take effect on the person’s next request."
        actions={canInvite && <InviteUserDialog roles={assignable} />}
      />

      <form
        role="search"
        aria-label="Filter users"
        className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_repeat(3,11rem)_auto]"
      >
        <input
          name="q"
          type="search"
          placeholder="Search name or email"
          defaultValue={filter.search}
          aria-label="Search users"
          className={inputClassName}
        />
        <select name="status" defaultValue={filter.status ?? ''} aria-label="Status" className={inputClassName}>
          <option value="">All statuses</option>
          {['ACTIVE', 'INVITED', 'SUSPENDED', 'INACTIVE'].map((status) => (
            <option key={status} value={status}>
              {status.charAt(0) + status.slice(1).toLowerCase()}
            </option>
          ))}
        </select>
        <select name="role" defaultValue={filter.roleId ?? ''} aria-label="Role" className={inputClassName}>
          <option value="">All roles</option>
          {roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </select>
        <select
          name="department"
          defaultValue={filter.departmentId ?? ''}
          aria-label="Department"
          className={inputClassName}
        >
          <option value="">All departments</option>
          {departments.map((department) => (
            <option key={department.id} value={department.id}>
              {department.name}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline">
          Apply
        </Button>
      </form>

      <DataTable<Row>
        caption="Users"
        rows={page.items}
        getRowId={(user) => user.id}
        empty={<EmptyState icon={UsersRound} title="No users match" description="Try a different search or filter." />}
        columns={[
          {
            key: 'user',
            header: 'User',
            cell: (user) => (
              <div className="flex min-w-52 items-center gap-3">
                <UserAvatar person={user} className="size-8" />
                <div className="min-w-0">
                  <p className="truncate font-medium">{fullName(user)}</p>
                  <p className="truncate text-caption text-muted-foreground">{user.email}</p>
                </div>
              </div>
            ),
          },
          {
            key: 'role',
            header: 'Role',
            cell: (user) => (
              <div className="flex flex-wrap gap-1">
                {user.user_roles.map(({ role }) => (
                  <Badge key={role.id} variant="neutral">
                    {role.name}
                  </Badge>
                ))}
              </div>
            ),
          },
          { key: 'status', header: 'Status', cell: (user) => <StatusBadge status={user.status} /> },
          {
            key: 'department',
            header: 'Department',
            hideBelow: 'lg',
            cell: (user) => user.intern?.department?.name ?? <span className="text-muted-foreground">—</span>,
          },
          {
            key: 'phone',
            header: 'Phone',
            hideBelow: 'lg',
            cell: (user) => <span className="font-mono text-caption">{user.phone ?? '—'}</span>,
          },
          {
            key: 'last',
            header: 'Last sign-in',
            hideBelow: 'md',
            cell: (user) => (
              <span className="whitespace-nowrap text-muted-foreground">
                {user.last_login_at ? formatDate(user.last_login_at, ctx.organization.timezone) : 'Never'}
              </span>
            ),
          },
          {
            key: 'actions',
            header: 'Actions',
            align: 'right',
            cell: (user) => {
              // Rows are only actionable when the person's highest role is one this viewer may assign.
              const primaryRole = user.user_roles
                .map(({ role }) => role)
                .reduce<Row['user_roles'][number]['role'] | undefined>(
                  (top, role) => (!top || role.rank > top.rank ? role : top),
                  undefined,
                )
              const manageable = user.id !== ctx.actor.userId && (!primaryRole || assignableIds.has(primaryRole.id))
              if (!manageable) return <span className="sr-only">No actions</span>
              return (
                <UserRowActions
                  user={{ id: user.id, name: fullName(user), status: user.status, roleId: primaryRole?.id ?? null }}
                  roles={assignable}
                  can={can}
                />
              )
            },
          },
        ]}
      />
      <Pagination
        pathname="/users"
        params={raw}
        page={page.page}
        totalPages={page.totalPages}
        total={page.total}
        pageSize={page.pageSize}
      />

      {canInvite && (
        <Card className="mt-8">
          <CardHeader>
            <CardTitle>Pending invitations</CardTitle>
          </CardHeader>
          <CardContent>
            {invitations.length === 0 ? (
              <p className="text-small text-muted-foreground">No pending invitations.</p>
            ) : (
              <ul className="divide-y">
                {invitations.map((invitation) => (
                  <li key={invitation.id} className={cn('flex flex-wrap items-center gap-3 py-3 text-small')}>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{invitation.email}</p>
                      <p className="text-caption text-muted-foreground">
                        {invitation.role.name} · expires {formatDate(invitation.expires_at, ctx.organization.timezone)}
                        {invitation.creator ? ` · invited by ${fullName(invitation.creator)}` : ''}
                      </p>
                    </div>
                    <RevokeInvitationButton invitationId={invitation.id} email={invitation.email} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </>
  )
}

import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { PageHeader } from '@/components/common/page-header'
import { UserAvatar } from '@/components/common/user-avatar'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AvatarForm, ProfileForm } from '@/features/account/components/account-forms'
import { formatDate, fullName } from '@/lib/utils'
import { requirePageContext } from '@/server/context'
import { userService } from '@/server/services/user.service'

export const metadata: Metadata = { title: 'Profile' }

function ReadOnly({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="text-small">{value || '—'}</dd>
    </div>
  )
}

export default async function ProfilePage() {
  const ctx = await requirePageContext()
  const profile = await userService.getOwnProfile(ctx)
  const intern = profile.intern

  return (
    <>
      <PageHeader title="Profile" description="Your personal details. Organization details are managed by HR." />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Personal information</CardTitle>
              <CardDescription>You can edit these details yourself.</CardDescription>
            </CardHeader>
            <CardContent>
              <ProfileForm profile={profile} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Organization</CardTitle>
              <CardDescription>Read-only. Ask HR if something here needs to change.</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 sm:grid-cols-2">
                <ReadOnly label="Organization" value={profile.organization.name} />
                <ReadOnly label="Email" value={profile.email} />
                <ReadOnly
                  label="Department"
                  value={intern?.department?.name ?? profile.departments_led.map((d) => d.name).join(', ')}
                />
                <ReadOnly label="Team" value={intern?.team?.name ?? profile.teams_led.map((t) => t.name).join(', ')} />
                {intern && <ReadOnly label="Position" value={intern.position?.title} />}
                {intern && <ReadOnly label="Employee code" value={intern.employee_code} />}
                {intern && <ReadOnly label="Manager" value={intern.manager ? fullName(intern.manager) : null} />}
                {intern && <ReadOnly label="Mentor" value={intern.mentor ? fullName(intern.mentor) : null} />}
              </dl>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Photo</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <UserAvatar person={profile} className="size-20 text-lg" />
              <AvatarForm />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Role</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {profile.user_roles.map(({ role }) => (
                  <Badge key={role.id} variant="primary">
                    {role.name}
                  </Badge>
                ))}
              </div>
              <p className="text-caption text-muted-foreground">
                {ctx.actor.permissions.size} permissions · member since{' '}
                {formatDate(profile.created_at, ctx.organization.timezone)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Security</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-small">
              <p>
                Email {profile.email_verified_at ? 'verified' : <strong className="text-warning">not verified</strong>}
              </p>
              <Link href="/security" className="font-medium text-primary hover:underline">
                Password and sessions →
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}

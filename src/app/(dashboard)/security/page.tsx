import type { Metadata } from 'next'
import { ShieldCheck } from 'lucide-react'
import { PhaseBadge } from '@/components/common/badges'
import { PageHeader } from '@/components/common/page-header'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChangePasswordForm, SessionList } from '@/features/account/components/account-forms'
import { config } from '@/lib/config'
import { formatDate } from '@/lib/utils'
import { requirePageContext } from '@/server/context'
import { sessionService } from '@/server/services/session.service'
import { userService } from '@/server/services/user.service'

export const metadata: Metadata = { title: 'Security' }

export default async function SecurityPage() {
  const ctx = await requirePageContext()
  const [profile, sessions] = await Promise.all([userService.getOwnProfile(ctx), sessionService.listOwn(ctx)])
  const tz = ctx.organization.timezone

  return (
    <>
      <PageHeader title="Security" description="Your password, sign-in sessions and account status." />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Change password</CardTitle>
              <CardDescription>Changing your password signs out every other session.</CardDescription>
            </CardHeader>
            <CardContent>
              <ChangePasswordForm minLength={config.auth.passwordMinLength} email={ctx.actor.email} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Sessions</CardTitle>
              <CardDescription>
                Devices where you’re signed in, as seen by Intern OS. Sign out any you don’t recognise.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SessionList
                sessions={sessions.map((session) => ({
                  id: session.id,
                  device: session.device,
                  ip_address: session.ip_address,
                  created_at: session.created_at.toISOString(),
                  last_seen_at: session.last_seen_at.toISOString(),
                  current: session.current,
                }))}
              />
            </CardContent>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Account</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 text-small">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Status</dt>
                  <dd>
                    <Badge variant="success">{profile.status === 'ACTIVE' ? 'Active' : profile.status}</Badge>
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Email</dt>
                  <dd>
                    <Badge variant={profile.email_verified_at ? 'success' : 'warning'}>
                      {profile.email_verified_at ? 'Verified' : 'Not verified'}
                    </Badge>
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Last sign-in</dt>
                  <dd>{profile.last_login_at ? formatDate(profile.last_login_at, tz) : '—'}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Two-factor authentication</CardTitle>
              <PhaseBadge phase="09" />
            </CardHeader>
            <CardContent className="flex gap-3 text-small text-muted-foreground">
              <ShieldCheck className="size-5 shrink-0" aria-hidden />
              Authenticator-app 2FA will be offered in Phase 09. It isn’t available yet.
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}

import type { Metadata } from 'next'
import Link from 'next/link'
import { Building2, ChevronRight, KeyRound, ScrollText, ShieldCheck, UserCog } from 'lucide-react'
import { PhaseBadge } from '@/components/common/badges'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied } from '@/components/common/states'
import { Card } from '@/components/ui/card'
import type { PermissionKey } from '@/lib/permissions'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'

export const metadata: Metadata = { title: 'Settings' }

const SECTIONS: {
  title: string
  description: string
  href?: string
  icon: typeof KeyRound
  permission: PermissionKey
  phase?: string
}[] = [
  {
    title: 'Roles & permissions',
    description: 'What each role can do, and how far each permission reaches.',
    href: '/settings/roles',
    icon: ShieldCheck,
    permission: 'role.read',
  },
  {
    title: 'Users',
    description: 'Invite people, change roles, suspend or deactivate accounts.',
    href: '/users',
    icon: UserCog,
    permission: 'user.read',
  },
  {
    title: 'Security & audit log',
    description: 'Sign-ins, access denials and administrative changes.',
    href: '/audit-logs',
    icon: ScrollText,
    permission: 'audit_log.read',
  },
  {
    title: 'Organization profile',
    description: 'Name, branding, working week and attendance rules.',
    icon: Building2,
    permission: 'settings.read',
    phase: '09',
  },
]

export default async function SettingsPage() {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'settings.read')) return <AccessDenied what="settings" />
  const sections = SECTIONS.filter((section) => authorizationService.can(ctx, section.permission))

  return (
    <>
      <PageHeader title="Settings" description={`Configuration for ${ctx.organization.name}.`} />
      <ul className="grid gap-4 md:grid-cols-2">
        {sections.map(({ title, description, href, icon: Icon, phase }) => {
          const body = (
            <Card
              className={`flex h-full items-start gap-4 p-5 ${href ? 'transition-colors hover:border-ring/40' : 'opacity-80'}`}
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="size-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <h2 className="flex items-center gap-2 text-h3">
                  {title} {phase && <PhaseBadge phase={phase} />}
                </h2>
                <p className="text-small text-muted-foreground">{description}</p>
              </div>
              {href && <ChevronRight className="mt-1 size-4 text-muted-foreground" aria-hidden />}
            </Card>
          )
          return (
            <li key={title}>
              {href ? (
                <Link href={href} className="block rounded-xl">
                  {body}
                </Link>
              ) : (
                body
              )}
            </li>
          )
        })}
      </ul>
    </>
  )
}

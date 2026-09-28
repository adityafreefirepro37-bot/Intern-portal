import { cookies } from 'next/headers'
import { AppShell } from '@/components/layout/app-shell'
import { visibleNav } from '@/config/navigation'
import { SITE } from '@/config/site'
import { requirePageContext } from '@/server/context'
import { internService } from '@/server/services/intern.service'

/**
 * Authenticated area. The user is resolved (and every account state checked)
 * on the server before anything renders, so private content never flashes for
 * visitors who aren't allowed to see it.
 */
export default async function DashboardLayout({ children }: LayoutProps<'/'>) {
  const ctx = await requirePageContext()
  const [cookieStore, facts] = await Promise.all([cookies(), internService.navFacts(ctx)])

  return (
    <AppShell
      user={{
        displayName: ctx.actor.displayName,
        email: ctx.actor.email,
        avatarUrl: ctx.actor.avatarUrl,
        roleNames: ctx.actor.roles.map((role) => role.name),
      }}
      organizationName={ctx.organization.name}
      nav={visibleNav(ctx.actor.permissions, facts)}
      initialCollapsed={cookieStore.get(SITE.sidebarCookie)?.value === 'collapsed'}
    >
      {children}
    </AppShell>
  )
}

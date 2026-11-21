import type { Metadata } from 'next'
import Link from 'next/link'
import { Flame, Radar, Search, Sparkles, ThermometerSun } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { StatCard } from '@/components/common/stat-card'
import { AccessDenied, EmptyState } from '@/components/common/states'
import { Button, buttonVariants } from '@/components/ui/button'
import { inputClassName } from '@/components/ui/input'
import { ActionButton } from '@/features/hr/components/action-form'
import { LEAD_STATUS_LABELS, RESEARCH_LABELS } from '@/features/growth/components/lead-badges'
import { AddLeadButton } from '@/features/growth/components/lead-forms'
import { LeadTable } from '@/features/growth/components/lead-table'
import { cn, formatDate, timeAgo } from '@/lib/utils'
import { runWorkerNowAction } from '@/server/actions/leads'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { leadService, type LeadListFilter } from '@/server/services/lead.service'

export const metadata: Metadata = { title: 'Leads' }

function one(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value
  return v?.trim() || undefined
}

/**
 * Growth leads: businesses found by the searches (or added by hand), audited and
 * scored. Managers see everything and assign leads; interns see the ones assigned to them.
 */
export default async function LeadsPage({ searchParams }: PageProps<'/growth/leads'>) {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'lead.read')) return <AccessDenied what="leads" />
  const params = await searchParams
  const filter: LeadListFilter = {
    tier: one(params.tier) as LeadListFilter['tier'],
    status: one(params.status) as LeadListFilter['status'],
    research: one(params.research) as LeadListFilter['research'],
    industryId: one(params.industry),
    city: one(params.city),
    assigned: one(params.assigned) as LeadListFilter['assigned'],
    q: one(params.q),
    page: Math.max(1, Number(one(params.page) ?? 1) || 1),
  }
  const canManage = authorizationService.scopeOf(ctx, 'lead.manage') === 'ORGANIZATION'
  const [overview, list, filters, people] = await Promise.all([
    leadService.overview(ctx),
    leadService.list(ctx, filter).catch(() => leadService.list(ctx, { page: 1 })),
    leadService.filters(ctx),
    canManage ? leadService.assignableUsers(ctx) : Promise.resolve([]),
  ])
  const tz = ctx.organization.timezone
  const admin = overview.admin
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize))
  const pageHref = (page: number) => {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) if (typeof v === 'string' && v && k !== 'page') q.set(k, v)
    q.set('page', String(page))
    return `/growth/leads?${q}`
  }

  return (
    <>
      <PageHeader
        title={canManage ? 'Leads' : 'My leads'}
        description={
          canManage
            ? 'Businesses the portal found and audited: what they’re missing, which Ayava service fixes it, and how good a prospect they are.'
            : 'Businesses assigned to you. Check each audit, complete the checklist and mark it ready for outreach or not a fit.'
        }
        actions={canManage ? <AddLeadButton industries={filters.industries} /> : undefined}
      />

      {admin && !admin.enabled && (
        <div className="mb-6 rounded-lg border border-warning/40 bg-warning/10 p-4 text-small">
          Automatic search is off. Turn it on in{' '}
          <Link href="/growth/settings" className="font-medium text-primary hover:underline">
            Growth settings
          </Link>
          {admin.tomtomConfigured || admin.googleConfigured ? '.' : ' (add TOMTOM_API_KEY for the best results; OpenStreetMap works without a key).'}
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Hot" value={overview.tiers.HOT ?? 0} icon={Flame} href="/growth/leads?tier=HOT" hint="Big need, good fit" tone="attention" />
        <StatCard label="Warm" value={overview.tiers.WARM ?? 0} icon={ThermometerSun} href="/growth/leads?tier=WARM" />
        <StatCard label="Ready for outreach" value={overview.ready} icon={Sparkles} href="/growth/leads?status=READY" />
        <StatCard label="Being audited" value={(overview.research.PENDING ?? 0) + (overview.research.RUNNING ?? 0)} icon={Radar} hint={`${overview.total} leads in total`} />
      </div>

      {admin && (
        <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border p-4 text-small">
          {admin.running.includes('TOMTOM') && (
            <span>
              TomTom today: <strong className="tabular-nums">{admin.tomtom.today}</strong>/{admin.tomtom.dailyCap} · month{' '}
              <strong className="tabular-nums">{admin.tomtom.month}</strong>/{admin.tomtom.monthlyCap}
            </span>
          )}
          {admin.running.includes('GOOGLE_PLACES') && (
            <span>
              Google today: <strong className="tabular-nums">{admin.places.today}</strong>/{admin.places.dailyCap} · month{' '}
              <strong className="tabular-nums">{admin.places.month}</strong>/{admin.places.monthlyCap}
            </span>
          )}
          {admin.running.length === 0 && <span className="text-warning">No source is switched on</span>}
          <span>
            Searches: {admin.searchesOpen} open · {admin.searchesDone} done
          </span>
          <span className="text-muted-foreground">Last worker run: {admin.lastWorkerRun ? `${timeAgo(admin.lastWorkerRun)} (${formatDate(admin.lastWorkerRun, tz)})` : 'never'}</span>
          <span className="ml-auto">
            <ActionButton action={runWorkerNowAction} fields={{}} size="sm" variant="outline" pendingLabel="Running… (up to 40 s)">
              Run now
            </ActionButton>
          </span>
        </div>
      )}

      <form className="mb-4 flex flex-wrap items-end gap-2" action="/growth/leads">
        <label className="grid gap-1 text-caption text-muted-foreground">
          Search
          <input name="q" defaultValue={filter.q} placeholder="Name or website" className={cn(inputClassName, 'h-8 w-48')} />
        </label>
        <label className="grid gap-1 text-caption text-muted-foreground">
          Tier
          <select name="tier" defaultValue={filter.tier ?? ''} className={cn(inputClassName, 'h-8 w-28')}>
            <option value="">All</option>
            <option value="HOT">Hot</option>
            <option value="WARM">Warm</option>
            <option value="SKIP">Skip</option>
          </select>
        </label>
        <label className="grid gap-1 text-caption text-muted-foreground">
          Status
          <select name="status" defaultValue={filter.status ?? ''} className={cn(inputClassName, 'h-8 w-40')}>
            <option value="">All open</option>
            {Object.entries(LEAD_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-caption text-muted-foreground">
          Audit
          <select name="research" defaultValue={filter.research ?? ''} className={cn(inputClassName, 'h-8 w-36')}>
            <option value="">Any</option>
            {Object.entries(RESEARCH_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-caption text-muted-foreground">
          Industry
          <select name="industry" defaultValue={filter.industryId ?? ''} className={cn(inputClassName, 'h-8 w-52')}>
            <option value="">All industries</option>
            {filters.industries.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-caption text-muted-foreground">
          City
          <select name="city" defaultValue={filter.city ?? ''} className={cn(inputClassName, 'h-8 w-36')}>
            <option value="">All cities</option>
            {filters.cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        {canManage && (
          <label className="grid gap-1 text-caption text-muted-foreground">
            Assigned
            <select name="assigned" defaultValue={filter.assigned ?? ''} className={cn(inputClassName, 'h-8 w-40')}>
              <option value="">Anyone</option>
              <option value="none">Unassigned</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <Button type="submit" size="sm" variant="secondary">
          <Search aria-hidden /> Filter
        </Button>
        <Link href="/growth/leads" className={buttonVariants({ size: 'sm', variant: 'ghost' })}>
          Reset
        </Link>
      </form>

      {list.items.length === 0 ? (
        <EmptyState
          icon={Radar}
          title={overview.total === 0 ? 'No leads yet' : 'No leads match these filters'}
          description={
            overview.total === 0
              ? canManage
                ? 'Turn on automatic search in Growth settings, or add a lead by hand.'
                : 'Leads assigned to you will appear here.'
              : 'Try removing a filter.'
          }
        />
      ) : (
        <>
          <LeadTable rows={list.items} canManage={canManage} people={people} />
          <div className="mt-4 flex items-center justify-between text-small text-muted-foreground">
            <span>
              {list.total} lead{list.total === 1 ? '' : 's'} · page {list.page} of {pages}
            </span>
            <span className="flex gap-2">
              {list.page > 1 && (
                <Link href={pageHref(list.page - 1)} className={buttonVariants({ size: 'sm', variant: 'outline' })}>
                  Previous
                </Link>
              )}
              {list.page < pages && (
                <Link href={pageHref(list.page + 1)} className={buttonVariants({ size: 'sm', variant: 'outline' })}>
                  Next
                </Link>
              )}
            </span>
          </div>
        </>
      )}
    </>
  )
}

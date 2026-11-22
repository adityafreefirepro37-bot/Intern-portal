import type { Metadata } from 'next'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied } from '@/components/common/states'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { GrowthSettingsForm, IndustryRow } from '@/features/growth/components/growth-settings-form'
import { timeAgo } from '@/lib/utils'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { leadService } from '@/server/services/lead.service'

export const metadata: Metadata = { title: 'Growth settings' }

/** Growth settings: cities, sources and free-allowance limits, the industry catalogue and search progress. */
export default async function GrowthSettingsPage() {
  const ctx = await requirePageContext()
  if (authorizationService.scopeOf(ctx, 'lead.manage') !== 'ORGANIZATION') return <AccessDenied what="Growth settings" />
  const [{ settings, industries, googleConfigured, tomtomConfigured, webSearchConfigured }, searches] = await Promise.all([leadService.settings(ctx), leadService.searches(ctx)])
  const sourceLabel = { TOMTOM: 'TomTom', GOOGLE_PLACES: 'Google', OPENSTREETMAP: 'OSM', MANUAL: 'Manual' } as const
  const done = searches.filter((s) => s.exhausted).length
  const failing = searches.filter((s) => s.last_error)

  return (
    <>
      <PageHeader
        title="Growth settings"
        breadcrumbs={[{ label: 'Leads', href: '/growth/leads' }, { label: 'Settings' }]}
        description="Where and how the portal looks for businesses. Every paid source stays inside its free allowance."
      />
      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Search</CardTitle>
            <CardDescription>
              {[
                tomtomConfigured ? 'TomTom is connected.' : 'TomTom isn’t connected (TOMTOM_API_KEY).',
                googleConfigured ? 'Google Places is connected.' : 'Google Places isn’t connected (GOOGLE_MAPS_API_KEY).',
                'OpenStreetMap needs no key.',
                webSearchConfigured ? 'Web search (Brave) is connected.' : 'Web search isn’t connected (BRAVE_SEARCH_API_KEY).',
              ].join(' ')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <GrowthSettingsForm initial={settings} googleConfigured={googleConfigured} tomtomConfigured={tomtomConfigured} webSearchConfigured={webSearchConfigured} />
          </CardContent>
        </Card>

        <div className="space-y-6 lg:col-span-3">
          <Card>
            <CardHeader>
              <CardTitle>Industries ({industries.filter((i) => i.active).length} of {industries.length} active)</CardTitle>
              <CardDescription>High-priority industries are searched first and score higher. Search terms are comma-separated (“dentist, dental clinic”).</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full min-w-[560px] text-small">
                <thead className="bg-muted/50 text-left text-caption text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Industry</th>
                    <th className="px-3 py-2 font-medium">Priority</th>
                    <th className="px-3 py-2 font-medium">Search terms</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {industries.map((i) => (
                    <IndustryRow key={i.id} industry={{ id: i.id, name: i.name, active: i.active, priority: i.priority, search_terms: i.search_terms, leads: i._count.leads }} />
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Search progress</CardTitle>
              <CardDescription>
                {searches.length} searches · {done} finished (they run again after 30 days to catch new businesses)
              </CardDescription>
            </CardHeader>
            <CardContent>
              {failing.length > 0 && (
                <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-small">
                  <p className="font-medium">{failing.length} search{failing.length === 1 ? '' : 'es'} failed last time</p>
                  <p className="text-muted-foreground">{failing[0]!.last_error}</p>
                </div>
              )}
              {searches.length === 0 ? (
                <p className="text-small text-muted-foreground">Save the settings to create the searches.</p>
              ) : (
                <div className="max-h-[420px] overflow-y-auto">
                  <table className="w-full text-small">
                    <thead className="sticky top-0 bg-card text-left text-caption text-muted-foreground">
                      <tr>
                        <th className="py-2 pr-3 font-medium">Search</th>
                        <th className="py-2 pr-3 font-medium">Found / added</th>
                        <th className="py-2 font-medium">Last run</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {searches.map((s) => (
                        <tr key={s.id}>
                          <td className="py-2 pr-3">
                            <span className="font-medium">{s.source === 'OPENSTREETMAP' ? s.industry.name : `“${s.term}”`}</span>{' '}
                            <span className="text-muted-foreground">in {s.city}</span>{' '}
                            <Badge variant={s.source === 'OPENSTREETMAP' ? 'outline' : 'neutral'}>{sourceLabel[s.source]}</Badge>
                          </td>
                          <td className="py-2 pr-3 tabular-nums">
                            {s.found} / {s.added}
                          </td>
                          <td className="py-2 text-muted-foreground">{s.exhausted ? 'Finished' : s.last_run_at ? timeAgo(s.last_run_at) : 'Waiting'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}

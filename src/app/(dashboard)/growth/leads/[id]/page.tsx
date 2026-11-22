import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ExternalLink, Globe, Mail, MapPin, Phone, Star } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ActionButton } from '@/features/hr/components/action-form'
import { LeadStatusBadge, RESEARCH_LABELS, SeverityBadge, TierBadge } from '@/features/growth/components/lead-badges'
import { LeadReviewForm } from '@/features/growth/components/lead-forms'
import { NotFoundError } from '@/lib/errors'
import { formatDate } from '@/lib/utils'
import { researchLeadAction } from '@/server/actions/leads'
import { requirePageContext } from '@/server/context'
import { leadService } from '@/server/services/lead.service'

export const metadata: Metadata = { title: 'Lead' }

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-1.5 text-small">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  )
}

const yes = (v: boolean | null | undefined) => (v === null || v === undefined ? '—' : v ? 'Yes' : 'No')

export default async function LeadPage({ params }: PageProps<'/growth/leads/[id]'>) {
  const ctx = await requirePageContext()
  const { id } = await params
  let lead: Awaited<ReturnType<typeof leadService.get>>
  try {
    lead = await leadService.get(ctx, id)
  } catch (error) {
    if (error instanceof NotFoundError) notFound()
    throw error
  }
  const tz = ctx.organization.timezone
  const site = lead.audit?.site ?? null
  const adLibrary = `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=IN&q=${encodeURIComponent(lead.name)}`

  return (
    <>
      <PageHeader
        title={lead.name}
        breadcrumbs={[{ label: 'Leads', href: '/growth/leads' }, { label: lead.name }]}
        description={[lead.industry?.name ?? lead.category, lead.city].filter(Boolean).join(' · ')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <TierBadge tier={lead.tier} />
            <LeadStatusBadge status={lead.status} />
            {lead.canManage && lead.status !== 'DO_NOT_CONTACT' && (
              <ActionButton action={researchLeadAction} fields={{ leadId: lead.id }} size="sm" variant="outline" pendingLabel="Queuing…">
                Audit again
              </ActionButton>
            )}
          </div>
        }
      />

      {lead.status === 'DO_NOT_CONTACT' && (
        <div className="mb-6 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-small">
          This business asked to be removed. Its details were erased and it will never be imported or contacted again.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>What they’re missing</CardTitle>
              <CardDescription>
                {lead.research_status === 'DONE'
                  ? `Audited ${formatDate(lead.researched_at, tz)}${lead.summary_source === 'AI' ? ' · summary by AYAVA AI' : ''}`
                  : RESEARCH_LABELS[lead.research_status]}
                {lead.research_error && ` · ${lead.research_error}`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {lead.summary?.problems?.length ? (
                <ol className="space-y-3">
                  {lead.summary.problems.map((p, i) => (
                    <li key={i} className="rounded-lg border p-3">
                      <p className="font-medium">
                        {i + 1}. {p.title}
                      </p>
                      <p className="text-small text-muted-foreground">{p.detail}</p>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-small text-muted-foreground">The summary appears once the audit has finished.</p>
              )}
              {lead.summary?.opener && (
                <div className="rounded-lg bg-muted/50 p-3 text-small">
                  <p className="text-caption font-medium text-muted-foreground">Suggested opening line</p>
                  <p>{lead.summary.opener}</p>
                </div>
              )}
              {lead.services.length > 0 && (
                <div>
                  <p className="mb-2 text-caption font-medium text-muted-foreground">Ayava services to pitch</p>
                  <div className="flex flex-wrap gap-2">
                    {lead.services.slice(0, 5).map((s) => (
                      <Badge key={s.service} variant="primary">
                        {s.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>All findings ({lead.findings.length})</CardTitle>
              <CardDescription>Checked automatically from their website and Google listing.</CardDescription>
            </CardHeader>
            <CardContent>
              {lead.findings.length === 0 ? (
                <p className="text-small text-muted-foreground">{lead.research_status === 'DONE' ? 'No problems found.' : 'Not audited yet.'}</p>
              ) : (
                <ul className="divide-y">
                  {lead.findings.map((f) => (
                    <li key={f.key} className="flex flex-wrap items-start gap-3 py-3">
                      <SeverityBadge severity={f.severity} />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{f.title}</p>
                        <p className="text-small text-muted-foreground">{f.detail}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {site && (
            <Card>
              <CardHeader>
                <CardTitle>Website check</CardTitle>
                <CardDescription>{site.finalUrl}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-x-8 sm:grid-cols-2">
                <div>
                  <Fact label="Mobile speed" value={lead.audit?.speed ? `${lead.audit.speed.performance}/100` : '—'} />
                  <Fact label="Works on mobile" value={yes(site.viewport)} />
                  <Fact label="Secure (HTTPS)" value={yes(site.https)} />
                  <Fact label="Platform" value={site.platform ?? 'Custom / unknown'} />
                  <Fact label="Last updated (©)" value={site.copyrightYear ?? '—'} />
                  <Fact label="Sitemap" value={yes(lead.audit?.sitemap)} />
                </div>
                <div>
                  <Fact label="Google Analytics / GTM" value={yes(site.ga4 || site.gtm)} />
                  <Fact label="Meta Pixel" value={yes(site.metaPixel)} />
                  <Fact label="Enquiry form" value={yes(site.contactForm)} />
                  <Fact label="WhatsApp button" value={yes(site.whatsapp)} />
                  <Fact label="Booking / ordering" value={[...site.booking, ...site.ordering].join(', ') || 'None'} />
                  <Fact label="Socials linked" value={Object.keys(site.socials).join(', ') || 'None'} />
                </div>
              </CardContent>
            </Card>
          )}

          {lead.audit?.websiteLookup && (
            <Card>
              <CardHeader>
                <CardTitle>Website search</CardTitle>
                <CardDescription>
                  {lead.audit.websiteLookup.result === 'found'
                    ? `The listing had no website; this one was found ${lead.audit.websiteSource === 'search' ? 'by a web search' : 'at a likely address'} and shows the business’s details.`
                    : lead.audit.websiteLookup.result === 'not_found'
                      ? 'The listing had no website, and a web search found none of the business’s own.'
                      : 'The listing had no website. Likely addresses didn’t match; the web search runs automatically when there’s allowance.'}
                </CardDescription>
              </CardHeader>
              {lead.audit.websiteLookup.tried.length > 0 && (
                <CardContent>
                  <ul className="grid gap-1 text-small">
                    {lead.audit.websiteLookup.tried.map((t) => (
                      <li key={t.url} className="flex flex-wrap justify-between gap-2">
                        <span className="break-all">{t.url}</span>
                        <span className="text-muted-foreground">{t.reason}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              )}
            </Card>
          )}

          {lead.canUpdate && lead.status !== 'DO_NOT_CONTACT' && (
            <Card>
              <CardHeader>
                <CardTitle>Your review</CardTitle>
                <CardDescription>The checks the portal can’t do automatically, then your decision.</CardDescription>
              </CardHeader>
              <CardContent>
                <LeadReviewForm
                  leadId={lead.id}
                  status={lead.status}
                  notes={lead.notes}
                  email={lead.email}
                  checklist={lead.checklist}
                  links={{ instagram: site?.socials.instagram, facebook: site?.socials.facebook, adLibrary }}
                />
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Contact</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-small">
              {lead.website && (
                <a href={lead.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-primary hover:underline">
                  <Globe className="size-4 shrink-0" aria-hidden /> <span className="truncate">{lead.website.replace(/^https?:\/\//, '')}</span>
                </a>
              )}
              {lead.email && (
                <p className="flex items-center gap-2">
                  <Mail className="size-4 shrink-0 text-muted-foreground" aria-hidden /> {lead.email}
                </p>
              )}
              {lead.phone && (
                <p className="flex items-center gap-2">
                  <Phone className="size-4 shrink-0 text-muted-foreground" aria-hidden /> {lead.phone}
                </p>
              )}
              {lead.address && (
                <p className="flex items-start gap-2">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden /> {lead.address}
                </p>
              )}
              {lead.rating !== null && (
                <p className="flex items-center gap-2">
                  <Star className="size-4 shrink-0 text-muted-foreground" aria-hidden /> {lead.rating.toFixed(1)} from {lead.review_count ?? 0} reviews
                </p>
              )}
              {lead.maps_url && (
                <a href={lead.maps_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-primary hover:underline">
                  <ExternalLink className="size-4 shrink-0" aria-hidden /> {lead.source === 'OPENSTREETMAP' ? 'OpenStreetMap listing' : 'Google Maps'}
                </a>
              )}
              {!lead.website && !lead.email && !lead.phone && <p className="text-muted-foreground">No contact details.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Private audit page</CardTitle>
              <CardDescription>Their free audit, to link in outreach. Only people with the link can open it.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-small">
              {lead.auditUrl ? (
                <>
                  <Link href={lead.auditUrl} target="_blank" className="break-all text-primary hover:underline">
                    {lead.auditUrl}
                  </Link>
                  <Fact label="Opened" value={lead.audit_views ? `${lead.audit_views}× (last ${formatDate(lead.audit_last_viewed_at, tz)})` : 'Not yet'} />
                  <Fact label="Open until" value={formatDate(lead.audit_expires_at, tz)} />
                </>
              ) : (
                <p className="text-muted-foreground">Made for Hot and Warm leads once the audit has finished.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Score</CardTitle>
            </CardHeader>
            <CardContent className="text-small">
              <Fact label="Need" value={lead.need_score ?? '—'} />
              <Fact label="Fit" value={lead.fit_score ?? '—'} />
              {lead.scoreReasons.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-caption text-muted-foreground">
                  {lead.scoreReasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="text-small">
              <Fact label="Found via" value={lead.source === 'MANUAL' ? 'Added by hand' : lead.search ? `“${lead.search.term}” in ${lead.search.city}` : { GOOGLE_PLACES: 'Google Places', TOMTOM: 'TomTom', OPENSTREETMAP: 'OpenStreetMap' }[lead.source]} />
              <Fact label="Added" value={formatDate(lead.created_at, tz)} />
              <Fact label="Assigned to" value={lead.assignee?.name ?? '—'} />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}

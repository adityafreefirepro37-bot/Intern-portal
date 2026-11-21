import type { Metadata } from 'next'
import { CircleAlert, SearchX } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { AuditViewBeacon, RemoveDataButton } from '@/features/growth/components/audit-page-client'
import { SeverityBadge } from '@/features/growth/components/lead-badges'
import { publicAuditService } from '@/server/services/lead.service'

export const metadata: Metadata = { title: 'Free website & marketing audit', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

function formatDay(iso: string | null) {
  if (!iso) return null
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(iso))
}

/**
 * A business's private, free audit (linked from Ayava's outreach). Shows only
 * the business name and what the public checks found — never contact details.
 */
export default async function AuditPage({ params }: PageProps<'/audit/[token]'>) {
  const { token } = await params
  const audit = await publicAuditService.get(token)

  if (!audit) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border bg-card p-8 text-center shadow-sm">
        <span className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <SearchX className="size-6" aria-hidden />
        </span>
        <h1 className="text-h2">This audit isn’t available</h1>
        <p className="mt-2 text-small text-muted-foreground">The link may have expired or been removed.</p>
      </div>
    )
  }

  const contact = audit.agency.website ? `${audit.agency.website.replace(/\/+$/, '')}/contact` : null
  const problems = audit.summary?.problems?.length ? audit.summary.problems : audit.findings.slice(0, 3).map((f) => ({ title: f.title, detail: f.detail }))
  const services = audit.summary?.services?.length ? audit.summary.services : [...new Set(audit.findings.map((f) => f.service))].slice(0, 3)

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <AuditViewBeacon token={token} />
      <header className="rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
        <p className="text-caption font-medium uppercase tracking-wide text-primary">Free website & marketing audit</p>
        <h1 className="mt-2 text-h1">{audit.businessName}</h1>
        <p className="mt-2 text-small text-muted-foreground">
          {[audit.industry, audit.city].filter(Boolean).join(' · ')}
          {audit.checkedAt && ` · checked ${formatDay(audit.checkedAt)}`}
        </p>
        <p className="mt-4 text-small">
          We looked at your website and public listing the way a customer would. Here is what is most likely costing you enquiries, and how it can be fixed.
        </p>
      </header>

      <section className="rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
        <h2 className="text-h3">The three biggest opportunities</h2>
        <ol className="mt-4 space-y-4">
          {problems.map((p, i) => (
            <li key={i} className="flex gap-3">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-small font-semibold text-primary">{i + 1}</span>
              <div>
                <p className="font-medium">{p.title}</p>
                <p className="text-small text-muted-foreground">{p.detail}</p>
              </div>
            </li>
          ))}
        </ol>
        {services.length > 0 && (
          <div className="mt-6">
            <p className="text-caption font-medium text-muted-foreground">What would fix it</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {services.map((s) => (
                <Badge key={s} variant="primary">
                  {s}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </section>

      {audit.findings.length > 0 && (
        <section className="rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
          <h2 className="text-h3">Everything we checked</h2>
          {audit.speed !== null && (
            <p className="mt-2 text-small text-muted-foreground">Google’s mobile speed test: {audit.speed}/100.</p>
          )}
          <ul className="mt-4 divide-y">
            {audit.findings.map((f) => (
              <li key={f.key} className="flex flex-wrap items-start gap-3 py-3">
                <SeverityBadge severity={f.severity as 'high' | 'medium' | 'low'} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{f.title}</p>
                  <p className="text-small text-muted-foreground">{f.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-2xl border bg-card p-6 text-center shadow-sm sm:p-8">
        <h2 className="text-h3">Want help fixing these?</h2>
        <p className="mt-2 text-small text-muted-foreground">A 20-minute call with {audit.agency.name}. No obligation; we’ll tell you plainly what’s worth doing first.</p>
        {contact && (
          <a
            href={contact}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex h-10 items-center justify-center rounded-md bg-primary px-6 text-label font-medium text-primary-foreground hover:bg-primary/90"
          >
            Book a free call
          </a>
        )}
      </section>

      <footer className="space-y-3 px-2 pb-6 text-center">
        <p className="flex items-start justify-center gap-2 text-caption text-muted-foreground">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          This audit uses only public information (your website and public business listing), checked automatically.
        </p>
        <RemoveDataButton token={token} />
      </footer>
    </div>
  )
}

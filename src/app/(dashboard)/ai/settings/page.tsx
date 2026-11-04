import type { Metadata } from 'next'
import { CheckCircle2, TriangleAlert } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { StatCard } from '@/components/common/stat-card'
import { AccessDenied } from '@/components/common/states'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AiSettingsForm } from '@/features/ai/components/ai-settings-form'
import { humanizeEnum } from '@/lib/utils'
import { requirePageContext } from '@/server/context'
import { aiSettingsService } from '@/server/ai/settings.service'
import { authorizationService } from '@/server/services/authorization.service'

export const metadata: Metadata = { title: 'AI settings' }

function Rows({ rows, empty }: { rows: { label: string; value: number | string }[]; empty: string }) {
  if (!rows.length) return <p className="text-small text-muted-foreground">{empty}</p>
  return (
    <dl className="divide-y text-small">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center justify-between gap-3 py-1.5">
          <dt className="min-w-0 truncate">{row.label}</dt>
          <dd className="tabular shrink-0 font-medium">{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export default async function AiSettingsPage() {
  const ctx = await requirePageContext()
  if (!authorizationService.can(ctx, 'ai.manage')) return <AccessDenied what="AI settings" />
  const [{ settings, provider }, metrics] = await Promise.all([aiSettingsService.view(ctx), aiSettingsService.metrics(ctx)])

  return (
    <>
      <PageHeader
        title="AI settings"
        description="Control AYAVA AI for your organization and see how it’s used. Conversations stay private: nothing here shows what people asked."
        breadcrumbs={[{ label: 'AYAVA AI', href: '/ai' }, { label: 'Settings' }]}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Provider</CardTitle>
          </CardHeader>
          <CardContent>
            {provider.configured ? (
              <p className="mb-3 flex items-center gap-2 text-small text-success">
                <CheckCircle2 className="size-4" aria-hidden /> Connected
              </p>
            ) : (
              <p className="mb-3 flex items-start gap-2 text-small text-warning">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                Not configured. Set AI_PROVIDER and AI_API_KEY on the server (see .env.example).
              </p>
            )}
            <Rows
              empty=""
              rows={[
                { label: 'Provider', value: provider.name ?? '—' },
                { label: 'Chat model', value: provider.model ?? '—' },
                { label: 'Fallback model', value: provider.fallbackModel ?? 'None' },
                { label: 'Embedding model', value: provider.embeddingModel ?? 'None (keyword search only)' },
              ]}
            />
            <p className="mt-3 text-caption text-muted-foreground">These come from server settings. The API key is never shown or sent to the browser.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Settings</CardTitle>
          </CardHeader>
          <CardContent>
            <AiSettingsForm settings={settings} />
          </CardContent>
        </Card>
      </div>

      <h2 className="mb-3 mt-8 text-h3">Usage, last {metrics.days} days</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Questions" value={metrics.requests} />
        <StatCard label="Active people" value={metrics.activeUsers} />
        <StatCard label="Average response" value={`${(metrics.averageLatencyMs / 1000).toFixed(1)} s`} />
        <StatCard label="Used company knowledge" value={`${metrics.knowledgeRate}%`} />
        <StatCard label="Tokens this month" value={metrics.monthTokens.toLocaleString()} />
        <StatCard label="Rated helpful" value={metrics.feedback.helpful} />
        <StatCard label="Rated not helpful" value={metrics.feedback.notHelpful} />
        <StatCard label="Errors" value={metrics.errors.reduce((n, e) => n + e.count, 0)} />
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle>By role</CardTitle>
          </CardHeader>
          <CardContent>
            <Rows empty="No questions yet." rows={metrics.byRole.map((r) => ({ label: humanizeEnum(r.role), value: r.count }))} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Data sources used</CardTitle>
          </CardHeader>
          <CardContent>
            <Rows empty="No tools used yet." rows={metrics.tools.map((t) => ({ label: t.tool, value: t.uses }))} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Action proposals</CardTitle>
          </CardHeader>
          <CardContent>
            <Rows empty="No proposals yet." rows={metrics.actions.map((a) => ({ label: humanizeEnum(a.status), value: a.count }))} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Errors</CardTitle>
          </CardHeader>
          <CardContent>
            <Rows empty="No errors." rows={metrics.errors.map((e) => ({ label: humanizeEnum(e.code), value: e.count }))} />
          </CardContent>
        </Card>
      </div>
    </>
  )
}

import type { Metadata } from 'next'
import { CircleCheck, CircleAlert, Inbox } from 'lucide-react'
import { PageHeader } from '@/components/common/page-header'
import { AccessDenied, EmptyState } from '@/components/common/states'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ApprovalCard, OutreachSettingsForm } from '@/features/growth/components/outreach-client'
import { timeAgo } from '@/lib/utils'
import { requirePageContext } from '@/server/context'
import { authorizationService } from '@/server/services/authorization.service'
import { outreachService } from '@/server/services/outreach.service'

export const metadata: Metadata = { title: 'Outreach' }
export const dynamic = 'force-dynamic'

const STATUS_LABELS: Record<string, string> = {
  AWAITING_APPROVAL: 'Waiting for approval',
  ACTIVE: 'In sequence',
  REPLIED: 'Replied',
  COMPLETED: 'Finished, no reply',
  BOUNCED: 'Bounced',
  UNSUBSCRIBED: 'Unsubscribed',
  STOPPED: 'Stopped',
}

function Check({ ok, label, hint }: { ok: boolean | null; label: string; hint?: string }) {
  return (
    <li className="flex items-start gap-2 text-small">
      {ok ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> : <CircleAlert className={`mt-0.5 size-4 shrink-0 ${ok === null ? 'text-muted-foreground' : 'text-warning'}`} aria-hidden />}
      <span>
        {label}
        {hint && <span className="block text-caption text-muted-foreground">{hint}</span>}
      </span>
    </li>
  )
}

/** Automatic outreach: readiness, mailboxes, the approval queue, what was sent and who replied. */
export default async function OutreachPage() {
  const ctx = await requirePageContext()
  if (authorizationService.scopeOf(ctx, 'lead.manage') !== 'ORGANIZATION') return <AccessDenied what="Outreach" />
  const o = await outreachService.overview(ctx)
  const s = o.settings

  return (
    <>
      <PageHeader
        title="Outreach"
        breadcrumbs={[{ label: 'Leads', href: '/growth/leads' }, { label: 'Outreach' }]}
        description="Automatic emails to Hot and Warm leads with a published email. Replies, bounces and unsubscribes stop the emails; replies go to a person."
      />
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <Card>
            <CardHeader>
              <CardTitle>{o.readiness.ready ? 'Ready to send' : 'Not sending yet'}</CardTitle>
              <CardDescription>
                Audit links open at {o.readiness.linkBase}. Emails go out {s.sendFromHour}:00–{s.sendUntilHour}:00 India time. {o.scheduled} scheduled.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="grid gap-2">
                {o.readiness.problems.map((p) => (
                  <Check key={p} ok={false} label={p} />
                ))}
                {o.domainAuth.map((d) => (
                  <li key={d.domain} className="grid gap-1">
                    <span className="text-caption font-medium text-muted-foreground">{d.domain}</span>
                    <ul className="grid gap-1">
                      <Check ok={d.spf} label="SPF record" hint={d.spf ? undefined : 'Required: without it, emails go to spam. Your mail host gives the record.'} />
                      <Check ok={d.dkim} label="DKIM signing" hint={d.dkim ? undefined : 'Not found under the usual names; check it is switched on at your mail host.'} />
                      <Check ok={d.dmarc} label="DMARC record" hint={d.dmarc ? undefined : 'Recommended: add “v=DMARC1; p=none” at _dmarc.' + d.domain} />
                    </ul>
                  </li>
                ))}
                {o.readiness.ready && <Check ok label="Everything is set: emails go out on their own in the sending window." />}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Waiting for your approval ({o.queue.length})</CardTitle>
              <CardDescription>
                {o.approvalsLeft > 0
                  ? `The next ${o.approvalsLeft} first emails wait here so you can check them; after that they send on their own.`
                  : 'Approvals are done: new emails send on their own.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              {o.queue.length ? o.queue.map((m) => <ApprovalCard key={m.id} message={m} />) : <EmptyState compact icon={Inbox} title="Nothing to approve" description="Emails appear here when Hot and Warm leads are ready." />}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recently sent</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              {o.sent.length ? (
                <table className="w-full min-w-[560px] text-small">
                  <thead className="bg-muted/50 text-left text-caption text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Business</th>
                      <th className="px-3 py-2 font-medium">Email</th>
                      <th className="px-3 py-2 font-medium">From</th>
                      <th className="px-3 py-2 font-medium">When</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {o.sent.map((m) => (
                      <tr key={m.id}>
                        <td className="px-3 py-2">
                          <a href={`/growth/leads/${m.lead.id}`} className="hover:underline">
                            {m.lead.name}
                          </a>
                        </td>
                        <td className="px-3 py-2">
                          {m.step === 1 ? 'First email' : `Follow-up ${m.step - 1}`}
                          {m.status === 'FAILED' && <span className="block text-caption text-destructive">{m.error}</span>}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{m.mailbox}</td>
                        <td className="px-3 py-2 text-muted-foreground">{m.sentAt ? timeAgo(m.sentAt) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="p-4 text-small text-muted-foreground">Nothing sent yet.</p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Leads in outreach</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {Object.entries(STATUS_LABELS).map(([status, label]) => (
                <Badge key={status} variant={status === 'REPLIED' ? 'success' : status === 'BOUNCED' || status === 'UNSUBSCRIBED' ? 'neutral' : 'secondary'}>
                  {label}: {o.counts[status] ?? 0}
                </Badge>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Replies and opt-outs</CardTitle>
              <CardDescription>Answer replies personally from the mailbox that sent the email.</CardDescription>
            </CardHeader>
            <CardContent>
              {o.replies.length ? (
                <ul className="grid gap-2 text-small">
                  {o.replies.map((r) => (
                    <li key={r.id} className="flex justify-between gap-2">
                      <a href={`/growth/leads/${r.id}`} className="hover:underline">
                        {r.name}
                      </a>
                      <span className="text-muted-foreground">{STATUS_LABELS[r.outreach_status]}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-small text-muted-foreground">No replies yet.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Mailboxes</CardTitle>
              <CardDescription>From OUTREACH_MAILBOXES. A new mailbox starts at 5 emails a day and adds 3 a day up to the limit.</CardDescription>
            </CardHeader>
            <CardContent>
              {o.mailboxes.length ? (
                <ul className="grid gap-3 text-small">
                  {o.mailboxes.map((m) => (
                    <li key={m.email}>
                      <div className="flex justify-between gap-2">
                        <span className="font-medium">{m.email}</span>
                        <span className="text-muted-foreground">
                          {m.sentToday}/{m.limit} today
                        </span>
                      </div>
                      <div className="text-caption text-muted-foreground">
                        Inbox checked {m.lastInboxCheckAt ? timeAgo(m.lastInboxCheckAt) : 'not yet'}
                        {m.lastError && <span className="block text-destructive">{m.lastError}</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-small text-muted-foreground">No mailboxes configured yet.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Settings</CardTitle>
            </CardHeader>
            <CardContent>
              <OutreachSettingsForm
                initial={{
                  outreachEnabled: s.outreachEnabled,
                  senderName: s.senderName,
                  companyName: s.companyName,
                  companyWebsite: s.companyWebsite,
                  postalAddress: s.postalAddress,
                  sendDays: s.sendDays,
                  sendFromHour: s.sendFromHour,
                  sendUntilHour: s.sendUntilHour,
                  mailboxDailyMax: s.mailboxDailyMax,
                  followUpGapDays: s.followUpGapDays,
                  approvalsRequired: s.approvalsRequired,
                }}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}

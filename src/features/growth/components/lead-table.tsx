'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Eye } from 'lucide-react'
import { useToast } from '@/components/feedback/toast'
import { Button } from '@/components/ui/button'
import { inputClassName } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { assignLeadsAction } from '@/server/actions/leads'
import { LeadStatusBadge, RESEARCH_LABELS, TierBadge } from './lead-badges'

export interface LeadRow {
  id: string
  name: string
  city: string | null
  industry: { name: string } | null
  category: string | null
  website: string | null
  email: string | null
  phone: string | null
  rating: number | null
  review_count: number | null
  tier: string | null
  need_score: number | null
  fit_score: number | null
  status: string
  research_status: string
  audit_views: number
  topProblem: string | null
  assignee: { id: string; name: string } | null
}

/** The leads list. Managers can select rows and assign them to someone (e.g. an intern) in one go. */
export function LeadTable({ rows, canManage, people }: { rows: LeadRow[]; canManage: boolean; people: { id: string; name: string }[] }) {
  const router = useRouter()
  const { toast } = useToast()
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [assignee, setAssignee] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id))

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function assign() {
    setBusy(true)
    const result = await assignLeadsAction({ leadIds: [...selected], userId: assignee === 'none' ? null : assignee })
    setBusy(false)
    toast({ title: result.message ?? 'Could not assign', variant: result.status === 'success' ? 'success' : 'error' })
    if (result.status === 'success') {
      setSelected(new Set())
      router.refresh()
    }
  }

  return (
    <div className="space-y-3">
      {canManage && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-3">
          <span className="text-small font-medium">{selected.size} selected</span>
          <label className="sr-only" htmlFor="assign-to">
            Assign to
          </label>
          <select id="assign-to" className={cn(inputClassName, 'h-8 w-56')} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">Assign to…</option>
            <option value="none">Nobody (unassign)</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <Button size="sm" disabled={!assignee || busy} onClick={assign}>
            {busy ? 'Assigning…' : 'Assign'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[760px] text-small">
          <thead className="bg-muted/50 text-left text-caption text-muted-foreground">
            <tr>
              {canManage && (
                <th className="w-10 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="Select all on this page"
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
                  />
                </th>
              )}
              <th className="px-3 py-2 font-medium">Business</th>
              <th className="px-3 py-2 font-medium">Biggest problem</th>
              <th className="px-3 py-2 font-medium">Score</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Assigned</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.id} className="align-top hover:bg-muted/30">
                {canManage && (
                  <td className="px-3 py-3">
                    <input type="checkbox" aria-label={`Select ${r.name}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                  </td>
                )}
                <td className="px-3 py-3">
                  <Link href={`/growth/leads/${r.id}`} className="font-medium hover:underline">
                    {r.name}
                  </Link>
                  <p className="text-caption text-muted-foreground">
                    {[r.industry?.name ?? r.category, r.city].filter(Boolean).join(' · ')}
                    {r.rating !== null && ` · ★ ${r.rating.toFixed(1)} (${r.review_count ?? 0})`}
                  </p>
                  <p className="text-caption text-muted-foreground">
                    {[r.email && 'email', r.phone && 'phone', r.website ? 'website' : 'no website'].filter(Boolean).join(' · ')}
                  </p>
                </td>
                <td className="px-3 py-3">
                  {r.research_status === 'DONE' ? (
                    <span>{r.topProblem ?? '—'}</span>
                  ) : (
                    <span className="text-muted-foreground">{RESEARCH_LABELS[r.research_status]}</span>
                  )}
                </td>
                <td className="px-3 py-3">
                  <div className="flex flex-col items-start gap-1">
                    <TierBadge tier={r.tier} />
                    {r.need_score !== null && (
                      <span className="text-caption tabular-nums text-muted-foreground">
                        need {r.need_score} · fit {r.fit_score}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-3">
                  <div className="flex flex-col items-start gap-1">
                    <LeadStatusBadge status={r.status} />
                    {r.audit_views > 0 && (
                      <span className="inline-flex items-center gap-1 text-caption text-success">
                        <Eye className="size-3" aria-hidden /> audit viewed {r.audit_views}×
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-3 text-muted-foreground">{r.assignee?.name ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

import { Badge } from '@/components/ui/badge'

export const LEAD_STATUS_LABELS: Record<string, string> = {
  NEW: 'New',
  REVIEWED: 'Reviewed',
  READY: 'Ready for outreach',
  NOT_A_FIT: 'Not a fit',
  DO_NOT_CONTACT: 'Do not contact',
}

export const RESEARCH_LABELS: Record<string, string> = {
  PENDING: 'Waiting for audit',
  RUNNING: 'Auditing…',
  DONE: 'Audited',
  FAILED: 'Audit failed',
}

export function TierBadge({ tier }: { tier: string | null }) {
  if (!tier) return <Badge variant="outline">Not scored</Badge>
  if (tier === 'HOT') return <Badge variant="destructive">Hot</Badge>
  if (tier === 'WARM') return <Badge variant="warning">Warm</Badge>
  return <Badge variant="neutral">Skip</Badge>
}

export function LeadStatusBadge({ status }: { status: string }) {
  const variant = status === 'READY' ? 'success' : status === 'REVIEWED' ? 'info' : status === 'NEW' ? 'outline' : 'neutral'
  return <Badge variant={variant}>{LEAD_STATUS_LABELS[status] ?? status}</Badge>
}

export function SeverityBadge({ severity }: { severity: 'high' | 'medium' | 'low' }) {
  if (severity === 'high') return <Badge variant="destructive">Serious</Badge>
  if (severity === 'medium') return <Badge variant="warning">Worth fixing</Badge>
  return <Badge variant="neutral">Minor</Badge>
}

import type { RequestContext } from '@/server/context'
import type { HrNavItem } from './components/hr-nav'

/** HR area sections this viewer may open (permission-derived, never role names). */
export function hrNavItems(ctx: RequestContext): HrNavItem[] {
  const has = (key: Parameters<RequestContext['actor']['permissions']['has']>[0]) => ctx.actor.permissions.has(key)
  const scope = (key: Parameters<RequestContext['actor']['permissions']['get']>[0]) => ctx.actor.permissions.get(key)
  const items: (HrNavItem | false)[] = [
    has('hr_dashboard.read') && { href: '/hr', label: 'Overview' },
    Boolean(scope('attendance.read') && scope('attendance.read') !== 'OWN') && {
      href: '/hr/attendance',
      label: 'Attendance',
    },
    Boolean(scope('leave.read') && scope('leave.read') !== 'OWN') && { href: '/hr/leave', label: 'Leave' },
    has('document.verify') && { href: '/hr/documents', label: 'Documents' },
    scope('hr_request.manage') === 'ORGANIZATION' && { href: '/hr/requests', label: 'Requests' },
    has('offboarding.read') && { href: '/hr/offboarding', label: 'Ending & offboarding' },
    has('hr_dashboard.read') && { href: '/hr/calendar', label: 'Calendar' },
    has('analytics.read') && has('hr_dashboard.read') && { href: '/hr/analytics', label: 'Analytics' },
    has('hr_settings.update') && { href: '/hr/settings', label: 'Settings' },
  ]
  return items.filter((item): item is HrNavItem => Boolean(item))
}

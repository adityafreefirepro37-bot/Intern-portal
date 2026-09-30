import type { LucideIcon } from 'lucide-react'
import {
  Award,
  BarChart3,
  BookOpen,
  CalendarDays,
  CheckSquare,
  Briefcase,
  CalendarClock,
  ClipboardList,
  Clock,
  FileCheck2,
  FileText,
  FolderKanban,
  GraduationCap,
  HeartHandshake,
  IdCard,
  Inbox,
  Gauge,
  KeyRound,
  LifeBuoy,
  LayoutDashboard,
  Megaphone,
  MessagesSquare,
  Palmtree,
  ScrollText,
  Settings,
  Sparkles,
  UserCog,
  UserRound,
  UsersRound,
} from 'lucide-react'
import { scopeRank, type PermissionKey, type PermissionScope, type PermissionSet } from '@/lib/permissions'

/**
 * Application navigation. Each item declares the permission needed to see it;
 * the server resolves the list per user from their permissions (never role
 * names). Items whose permission is granted with a narrower-than-organization
 * scope use `scopedLabel` ("My Tasks"). Hiding a link is a convenience, not
 * security — every page and service enforces its own permission.
 */
export interface NavItem {
  label: string
  /** Label used when the permission is granted with less than ORGANIZATION scope. */
  scopedLabel?: string
  href: string
  icon: LucideIcon
  permission?: PermissionKey
  phase?: string
  /** Candidate for the mobile bottom bar (first four visible are used). */
  mobile?: boolean
  /** Minimum scope of `permission` required to show the item. */
  minScope?: PermissionScope
  /** Shown only when this relationship fact is true for the viewer. */
  when?: keyof NavFacts
}

/** Per-user facts (from the database) that decide relationship-based items. */
export interface NavFacts {
  isIntern?: boolean
  managesInterns?: boolean
  mentorsInterns?: boolean
}

export interface NavSection {
  title: string
  items: NavItem[]
}

export const NAVIGATION: NavSection[] = [
  {
    title: 'Ayava',
    items: [{ label: 'Overview', href: '/', icon: LayoutDashboard, mobile: true }],
  },
  {
    title: 'Work',
    items: [
      { label: 'My Work', href: '/my-work', icon: Inbox, permission: 'task.read', mobile: true },
      {
        label: 'Tasks',
        scopedLabel: 'My Tasks',
        href: '/tasks',
        icon: CheckSquare,
        permission: 'task.read',
        mobile: true,
      },
      {
        label: 'Projects',
        scopedLabel: 'My Projects',
        href: '/projects',
        icon: FolderKanban,
        permission: 'project.read',
        mobile: true,
      },
      { label: 'Workload', href: '/workload', icon: Gauge, permission: 'task.review' },
      { label: 'Calendar', href: '/calendar', icon: CalendarDays, permission: 'calendar.read', phase: '06' },
    ],
  },
  {
    title: 'People',
    items: [
      { label: 'My Internship', href: '/my-internship', icon: IdCard, when: 'isIntern', mobile: true },
      {
        label: 'Interns',
        scopedLabel: 'Team Interns',
        href: '/interns',
        icon: UserRound,
        permission: 'intern.read',
        minScope: 'TEAM',
      },
      {
        label: 'My Interns',
        href: '/my-interns',
        icon: GraduationCap,
        permission: 'intern.read',
        when: 'managesInterns',
      },
      {
        label: 'My Mentees',
        href: '/my-mentees',
        icon: HeartHandshake,
        permission: 'intern.read',
        when: 'mentorsInterns',
      },
      { label: 'Onboarding', href: '/onboarding', icon: ClipboardList, permission: 'onboarding.manage' },
      { label: 'Teams', href: '/teams', icon: UsersRound, permission: 'team.read' },
    ],
  },
  {
    title: 'Learning',
    items: [{ label: 'Learning Hub', href: '/learning', icon: BookOpen, permission: 'course.read', mobile: true }],
  },
  {
    title: 'HR',
    items: [
      { label: 'HR Dashboard', href: '/hr', icon: Briefcase, permission: 'hr_dashboard.read' },
      // Personal HR self-service (people who record their own attendance/leave).
      { label: 'Attendance', href: '/attendance', icon: Clock, permission: 'attendance.create', mobile: true },
      { label: 'Leave', href: '/leave', icon: Palmtree, permission: 'leave.request' },
      { label: 'Documents', href: '/documents', icon: FileText, permission: 'document.upload', when: 'isIntern' },
      // Oversight views (scope-limited for managers).
      {
        label: 'Attendance',
        scopedLabel: 'Team Attendance',
        href: '/hr/attendance',
        icon: Clock,
        permission: 'attendance.read',
        minScope: 'ASSIGNED',
      },
      {
        label: 'Leave',
        scopedLabel: 'Team Leave',
        href: '/hr/leave',
        icon: Palmtree,
        permission: 'leave.read',
        minScope: 'ASSIGNED',
      },
      { label: 'Documents', href: '/hr/documents', icon: FileCheck2, permission: 'document.verify' },
      {
        label: 'HR Requests',
        href: '/hr/requests',
        icon: LifeBuoy,
        permission: 'hr_request.manage',
        minScope: 'ORGANIZATION',
      },
      { label: 'Ending Internships', href: '/hr/offboarding', icon: CalendarClock, permission: 'offboarding.read' },
      { label: 'My Requests', href: '/requests', icon: LifeBuoy, permission: 'hr_request.create' },
      { label: 'Performance', href: '/performance', icon: Gauge, permission: 'performance.read', phase: '06' },
      { label: 'Certificates', href: '/certificates', icon: Award, permission: 'certificate.read', phase: '08' },
    ],
  },
  {
    title: 'Communication',
    items: [
      { label: 'Announcements', href: '/announcements', icon: Megaphone, permission: 'announcement.read' },
      { label: 'Messages', href: '/messages', icon: MessagesSquare, permission: 'message.read', phase: '06' },
    ],
  },
  {
    title: 'AI',
    items: [{ label: 'AYAVA AI', href: '/ai', icon: Sparkles, permission: 'ai.use', phase: '07' }],
  },
  {
    title: 'Analytics',
    items: [{ label: 'Analytics', href: '/analytics', icon: BarChart3, permission: 'analytics.read', phase: '08' }],
  },
  {
    title: 'System',
    items: [
      { label: 'Users', href: '/users', icon: UserCog, permission: 'user.read' },
      { label: 'Audit Logs', href: '/audit-logs', icon: ScrollText, permission: 'audit_log.read' },
      { label: 'Settings', href: '/settings', icon: Settings, permission: 'settings.read' },
    ],
  },
  {
    title: 'Account',
    items: [
      { label: 'Profile', href: '/profile', icon: UserRound },
      { label: 'Security', href: '/security', icon: KeyRound },
    ],
  },
]

/** Serializable nav entry resolved for one user. */
export interface VisibleNavItem {
  href: string
  label: string
}

/** The navigation this permission set may see, with scope-aware labels. */
export function visibleNav(permissions: Pick<PermissionSet, 'get' | 'has'>, facts: NavFacts = {}): VisibleNavItem[] {
  return NAVIGATION.flatMap((section) => section.items)
    .filter((item) => !item.permission || permissions.has(item.permission))
    .filter((item) => !item.when || facts[item.when])
    .filter((item) => {
      if (!item.minScope || !item.permission) return true
      const scope = permissions.get(item.permission)
      return Boolean(scope && scopeRank(scope) >= scopeRank(item.minScope))
    })
    .map((item) => {
      const scope = item.permission ? permissions.get(item.permission) : undefined
      const label = item.scopedLabel && scope && scope !== 'ORGANIZATION' ? item.scopedLabel : item.label
      return { href: item.href, label }
    })
}

/** hrefs only (kept for callers that don't need labels). */
export function visibleNavHrefs(permissions: Pick<PermissionSet, 'get' | 'has'>): string[] {
  return visibleNav(permissions).map((item) => item.href)
}

export interface ResolvedNavItem extends NavItem {
  resolvedLabel: string
}

export function filterNavigation(visible: readonly VisibleNavItem[]): { title: string; items: ResolvedNavItem[] }[] {
  const labels = new Map(visible.map((item) => [item.href, item.label]))
  return NAVIGATION.map((section) => ({
    ...section,
    items: section.items
      .filter((item) => labels.has(item.href))
      .map((item) => ({ ...item, resolvedLabel: labels.get(item.href)! })),
  })).filter((section) => section.items.length > 0)
}

export function isActivePath(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`)
}

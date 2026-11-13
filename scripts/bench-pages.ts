/**
 * Page benchmark: the database work behind each page, timed against the
 * database in .env. Mirrors a request: auth lookup + session check, then the
 * layout and the page's data in parallel (as Next.js renders them). Read-only.
 *
 *   npx tsx --conditions=react-server scripts/bench-pages.ts [prod|dev] [email] [runs]
 *
 *   prod  DATABASE_URL as configured (Vercel: transaction pooler, connection_limit=1)
 *   dev   DIRECT_URL (session pooler) with connection_limit=5
 *
 * Prints per page: median wall time and the number of SQL queries.
 */
import { loadEnvConfig } from '@next/env'
import type { PrismaClient } from '@prisma/client'
import { createPrismaClient } from '../src/lib/db/pool'
import { performance } from 'node:perf_hooks'

loadEnvConfig(process.cwd())

const mode = process.argv[2] ?? 'prod'
const email = process.argv[3] ?? 'admin@ayavacreatives.com'
const runs = Number(process.argv[4] ?? 4)

function databaseUrl() {
  if (mode === 'dev') {
    const url = new URL(process.env.DIRECT_URL ?? process.env.DATABASE_URL!)
    url.searchParams.delete('pgbouncer')
    url.searchParams.set('connection_limit', '5')
    return url.toString()
  }
  // Production settings as configured; a longer pool timeout so slow pages finish instead of erroring.
  const url = new URL(process.env.DATABASE_URL!)
  url.searchParams.set('pool_timeout', '120')
  return url.toString()
}

const client: PrismaClient = createPrismaClient({ url: databaseUrl(), log: [{ emit: 'event', level: 'query' }] })
;(globalThis as { prisma?: PrismaClient }).prisma = client
let queries = 0
let timeline: { start: number; end: number; sql: string }[] = []
// createPrismaClient() isn't typed for query events; it does emit them (log: emit 'event').
;(client as unknown as { $on(e: 'query', cb: (event: { duration: number; query: string }) => void): void }).$on('query', (event) => {
  queries++
  const end = performance.now()
  timeline.push({ start: end - event.duration, end, sql: event.query })
})

/** Sequential rounds: a query starting after every earlier query ended begins a new round. */
function rounds(events: typeof timeline) {
  const sorted = [...events].sort((a, b) => a.start - b.start)
  const out: string[][] = []
  let frontier = -Infinity
  for (const e of sorted) {
    const table = /FROM "public"\."(\w+)"/.exec(e.sql)?.[1] ?? /^(\w+)/.exec(e.sql.trim())?.[1] ?? '?'
    if (e.start > frontier) out.push([])
    out[out.length - 1].push(table)
    frontier = Math.max(frontier, e.end)
  }
  return out
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]

async function main() {
  const { identityRepository } = await import('@/server/repositories/identity.repository')
  const { widerScope } = await import('@/lib/permissions')
  const { fullName } = await import('@/lib/utils/format')
  const s = {
    intern: (await import('@/server/services/intern.service')).internService,
    notification: (await import('@/server/services/notification.service')).notificationService,
    dashboard: (await import('@/server/services/dashboard.service')).dashboardService,
    perfDash: (await import('@/server/services/performance-dashboard.service')).performanceDashboardService,
    work: (await import('@/server/services/work.service')).workService,
    task: (await import('@/server/services/task.service')).taskService,
    project: (await import('@/server/services/project.service')).projectService,
    hr: (await import('@/server/services/hr-dashboard.service')).hrDashboardService,
    attendance: (await import('@/server/services/attendance.service')).attendanceService,
    leave: (await import('@/server/services/leave.service')).leaveService,
    learning: (await import('@/server/services/learning.service')).learningService,
    catalog: (await import('@/server/services/learning-catalog.service')).learningCatalogService,
    onboarding: (await import('@/server/services/onboarding.service')).onboardingService,
    announcement: (await import('@/server/services/announcement.service')).announcementService,
    workload: (await import('@/server/services/workload.service')).workloadService,
  }

  const record = await identityRepository.findActiveByEmail('ayava-creatives', email)
  if (!record?.auth_user_id) throw new Error(`no linked active user ${email}`)
  // Same as toRequestContext() in src/server/context.ts (which can't load outside Next).
  const permissions = new Map<string, never>()
  for (const { role } of record.user_roles) {
    for (const grant of role.role_permissions) {
      const key = `${grant.permission.resource}.${grant.permission.action}`
      const current = permissions.get(key)
      permissions.set(key, (current ? widerScope(current, grant.scope) : grant.scope) as never)
    }
  }
  const ctx = {
    actor: {
      userId: record.id,
      organizationId: record.organization_id,
      email: record.email,
      displayName: fullName(record),
      avatarUrl: record.avatar_url,
      roles: record.user_roles.map(({ role }) => ({ id: role.id, slug: role.slug, name: role.name, rank: role.rank })),
      rank: 0,
      permissions,
      ledTeamIds: record.teams_led.map((t) => t.id),
      headedDepartmentIds: record.departments_led.map((d) => d.id),
    },
    organization: { ...record.organization, logoUrl: record.organization.logo_url },
    authUser: { id: record.auth_user_id, email: record.email, sessionId: null },
    ...('_count' in record
      ? {
          shell: {
            isIntern: Boolean((record as { intern?: { deleted_at: Date | null } | null }).intern && !(record as { intern: { deleted_at: Date | null } }).intern.deleted_at),
            managesInterns: (record as { _count: { interns_managed: number } })._count.interns_managed > 0,
            mentorsInterns: (record as { _count: { interns_mentored: number } })._count.interns_mentored > 0,
            unreadNotifications: (record as { _count: { notifications: number } })._count.notifications,
          },
        }
      : {}),
  } as never
  const can = (key: string) => permissions.has(key)

  // Sample records the user can open.
  const [task, project, intern] = await Promise.all([
    client.task.findFirst({ where: { organization_id: record.organization_id, deleted_at: null, assignees: { some: {} } }, select: { id: true } }),
    client.project.findFirst({ where: { organization_id: record.organization_id, deleted_at: null }, select: { id: true } }),
    client.intern.findFirst({ where: { organization_id: record.organization_id, deleted_at: null, status: 'ACTIVE' }, select: { id: true, user_id: true } }),
  ])

  // Every request: resolve identity + session row (as src/server/context.ts does), then layout data.
  const parallelAuth = process.env.BENCH_SEQUENTIAL_AUTH !== '1'
  const auth = async () => {
    const session = () => client.userSession.findFirst({ where: { user_id: record.id }, select: { id: true } })
    if (parallelAuth) {
      await Promise.all([identityRepository.findByAuthUserId(record.auth_user_id!), session()])
    } else {
      await identityRepository.findByAuthUserId(record.auth_user_id!)
      await session()
    }
  }
  const layout = () => Promise.all([s.intern.navFacts(ctx), s.notification.listRecent(ctx)])
  const safe = <T,>(p: () => Promise<T>) => p().catch(() => null)

  const pages: [string, () => Promise<unknown>][] = [
    ['/ (overview)', () => Promise.all([s.dashboard.getOverview(ctx, new Date()), s.intern.dashboardSummary(ctx), s.perfDash.attention(ctx)])],
    ['/my-work', () => s.work.myWork(ctx)],
    ['/tasks', () => Promise.all([s.task.directory(ctx, {}), safe(() => s.task.createOptions(ctx))])],
    ['/tasks/[id]', () => s.task.getDetail(ctx, task!.id)],
    ['/projects', () => Promise.all([s.project.directory(ctx, {}), safe(() => s.project.managerOptions(ctx))])],
    ['/projects/[id]', () => Promise.all([s.project.getHeader(ctx, project!.id), s.project.getOverview(ctx, project!.id)])],
    ['/interns', () => Promise.all([s.intern.directory(ctx, {}), safe(() => s.intern.formOptions(ctx)), s.intern.myInternId(ctx)])],
    ['/interns/[id]', () => Promise.all([s.intern.getProfile(ctx, intern!.id), safe(() => s.intern.formOptions(ctx)), safe(() => s.intern.activity(ctx, intern!.id))])],
    ['/hr', () => (can('hr_dashboard.read') ? s.hr.overview(ctx) : Promise.resolve(null))],
    ['/attendance', () => Promise.all([s.attendance.today(ctx), s.attendance.month(ctx, {})])],
    ['/leave', () => Promise.all([s.leave.mine(ctx), s.leave.calendar(ctx)])],
    ['/learning', () => Promise.all([s.learning.hub(ctx), s.catalog.catalog(ctx, {}), s.catalog.categories(ctx), s.learning.paths(ctx)])],
    ['/performance', () => s.perfDash.overview(ctx)],
    ['/onboarding', () => Promise.all([safe(() => s.onboarding.dashboard(ctx)), s.intern.myInternId(ctx)])],
    ['/announcements', () => Promise.all([s.announcement.listActive(ctx, 50), safe(() => s.announcement.manageList(ctx)), safe(() => s.announcement.audienceOptions(ctx))])],
    ['/workload', () => Promise.all([safe(() => s.workload.forMyInterns(ctx)), safe(() => s.workload.forAllInterns(ctx))])],
  ]

  // Warm the connection once.
  await client.$queryRaw`SELECT 1`
  const rows: { page: string; ms: number; queries: number; rounds: string[][] }[] = []
  const only = process.env.ONLY
  for (const [name, page] of pages) {
    if (only && !name.includes(only)) continue
    const times: number[] = []
    let count = 0
    let waves: string[][] = []
    for (let i = 0; i < runs; i++) {
      queries = 0
      timeline = []
      const t = performance.now()
      await auth()
      await Promise.all([layout(), page()])
      times.push(performance.now() - t)
      count = queries
      waves = rounds(timeline)
    }
    rows.push({ page: name, ms: Math.round(median(times.slice(1).length ? times.slice(1) : times)), queries: count, rounds: waves })
  }
  const total = rows.reduce((n, r) => n + r.ms, 0)
  for (const r of rows) {
    console.log(`${r.page.padEnd(18)} ${String(r.ms).padStart(6)} ms  ${String(r.queries).padStart(4)} queries  ${String(r.rounds.length).padStart(3)} rounds`)
    if (process.env.DETAIL) r.rounds.forEach((w, i) => console.log(`    ${i + 1}: ${w.join(', ')}`))
  }
  console.log(`${'TOTAL'.padEnd(18)} ${String(total).padStart(6)} ms  ${String(rows.reduce((n, r) => n + r.queries, 0)).padStart(4)} queries  (${mode}, ${email})`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => client.$disconnect())

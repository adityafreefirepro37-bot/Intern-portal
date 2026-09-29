import type {
  MilestoneStatus,
  PrismaClient,
  ProjectMemberRole,
  ProjectStatus,
  SubmissionStatus,
  TaskPriority,
  TaskStatus,
} from '@prisma/client'
import { dateFrom, daysFrom, seedId } from './ids'

/**
 * DEVELOPMENT / DEMO work data: five agency projects with members, milestones
 * and tasks in every state — subtasks, checklists, dependencies, submission
 * histories (including changes requested → resubmitted → approved), comments
 * with mentions, time entries, project activity and a few notifications.
 * Deterministic ids; each run rebuilds the child rows so dates stay relative.
 */

type Key = string

interface ProjectSeed {
  key: Key
  slug: string
  name: string
  description: string
  status: ProjectStatus
  priority: TaskPriority
  start: number
  end: number
  owner: Key
  manager: Key
  members: [Key, ProjectMemberRole][]
}

interface MilestoneSeed {
  key: Key
  project: Key
  name: string
  status: MilestoneStatus
  start?: number
  due: number
}

interface VersionSeed {
  status: SubmissionStatus
  message: string
  daysAgo: number
  reviewer?: Key
  review?: string
}

interface TaskSeed {
  key: Key
  project: Key
  milestone?: Key
  parent?: Key
  title: string
  description?: string
  status: TaskStatus
  priority: TaskPriority
  start?: number
  due: number | null
  assignees: Key[]
  creator: Key
  estimate?: number
  blocked?: string
  checklist?: [string, boolean][]
  dependsOn?: Key[]
  versions?: VersionSeed[]
  comments?: { by: Key; body: string; replyTo?: number; mentions?: Key[] }[]
  time?: [Key, number][]
  completedDaysAgo?: number
}

const PROJECTS: ProjectSeed[] = [
  {
    key: 'website',
    slug: 'ayava-website-redesign',
    name: 'Ayava Website Redesign',
    description:
      'Redesign and rebuild ayavacreatives.com with a new case-study system, faster pages and accessible navigation.',
    status: 'ACTIVE',
    priority: 'HIGH',
    start: -35,
    end: 40,
    owner: 'devManager',
    manager: 'devManager',
    members: [
      ['devMentor', 'MENTOR'],
      ['mentor', 'MENTOR'],
      ['intern', 'CONTRIBUTOR'],
      ['neel', 'CONTRIBUTOR'],
      ['diya', 'VIEWER'],
    ],
  },
  {
    key: 'social',
    slug: 'social-media-campaign',
    name: 'Social Media Campaign',
    description: 'Quarter-long Instagram and LinkedIn growth push with weekly reporting for the agency brand.',
    status: 'ACTIVE',
    priority: 'MEDIUM',
    start: -40,
    end: 50,
    owner: 'manager',
    manager: 'manager',
    members: [
      ['mentor', 'MENTOR'],
      ['ishaan', 'CONTRIBUTOR'],
      ['tara', 'CONTRIBUTOR'],
      ['kabir', 'VIEWER'],
    ],
  },
  {
    key: 'onboarding',
    slug: 'intern-onboarding-system',
    name: 'Intern Onboarding System',
    description: 'Internal tooling to make the first two weeks of every internship consistent and measurable.',
    status: 'PLANNING',
    priority: 'MEDIUM',
    start: 7,
    end: 70,
    owner: 'hr',
    manager: 'devManager',
    members: [
      ['devMentor', 'MENTOR'],
      ['neel', 'CONTRIBUTOR'],
    ],
  },
  {
    key: 'seo',
    slug: 'seo-growth-initiative',
    name: 'SEO Growth Initiative',
    description: 'Technical SEO fixes and a content plan targeting design-studio search terms.',
    status: 'ON_HOLD',
    priority: 'LOW',
    start: -20,
    end: 60,
    owner: 'manager',
    manager: 'manager',
    members: [
      ['tara', 'CONTRIBUTOR'],
      ['ishaan', 'CONTRIBUTOR'],
    ],
  },
  {
    key: 'brand',
    slug: 'brand-identity-refresh',
    name: 'Brand Identity Refresh',
    description: 'Refresh the Ayava identity: logo refinements, palette, typography and a reusable template kit.',
    status: 'ACTIVE',
    priority: 'HIGH',
    start: -14,
    end: 45,
    owner: 'manager',
    manager: 'manager',
    members: [
      ['mentor', 'MENTOR'],
      ['zara', 'CONTRIBUTOR'],
    ],
  },
]

const MILESTONES: MilestoneSeed[] = [
  { key: 'website-research', project: 'website', name: 'Research', status: 'COMPLETED', start: -35, due: -25 },
  { key: 'website-design', project: 'website', name: 'Design', status: 'ACTIVE', start: -24, due: 5 },
  { key: 'website-build', project: 'website', name: 'Development', status: 'ACTIVE', start: -10, due: 25 },
  { key: 'website-testing', project: 'website', name: 'Testing', status: 'UPCOMING', start: 25, due: 33 },
  { key: 'website-launch', project: 'website', name: 'Launch', status: 'UPCOMING', start: 34, due: 40 },
  { key: 'social-q-plan', project: 'social', name: 'Quarterly content plan', status: 'COMPLETED', due: -20 },
  { key: 'social-mid', project: 'social', name: 'Mid-campaign report', status: 'ACTIVE', due: 9 },
  { key: 'social-wrap', project: 'social', name: 'Campaign wrap-up', status: 'UPCOMING', due: 48 },
  { key: 'onboarding-req', project: 'onboarding', name: 'Requirements', status: 'UPCOMING', due: 14 },
  { key: 'seo-audit', project: 'seo', name: 'Technical audit', status: 'ACTIVE', due: -5 },
  { key: 'seo-content', project: 'seo', name: 'Content plan', status: 'UPCOMING', due: 40 },
  { key: 'brand-discovery', project: 'brand', name: 'Discovery', status: 'ACTIVE', due: -2 },
  { key: 'brand-identity', project: 'brand', name: 'Identity system', status: 'UPCOMING', due: 20 },
]

const TASKS: TaskSeed[] = [
  // ── Website ──────────────────────────────────────────────────────────────
  {
    key: 'competitor-research',
    project: 'website',
    milestone: 'website-research',
    title: 'Competitor website research',
    description: 'Review 10 studio websites; note navigation patterns, case-study layouts and page speed.',
    status: 'COMPLETED',
    priority: 'MEDIUM',
    due: -27,
    assignees: ['neel'],
    creator: 'devManager',
    estimate: 360,
    completedDaysAgo: 28,
  },
  {
    key: 'sitemap',
    project: 'website',
    milestone: 'website-research',
    title: 'Draft the new sitemap',
    status: 'COMPLETED',
    priority: 'MEDIUM',
    due: -26,
    assignees: ['intern'],
    creator: 'devManager',
    estimate: 180,
    completedDaysAgo: 26,
  },
  {
    key: 'hero',
    project: 'website',
    milestone: 'website-design',
    title: 'Design homepage hero variations',
    description: 'Three hero options for desktop and mobile using the new brand typography.',
    status: 'COMPLETED',
    priority: 'HIGH',
    due: -3,
    assignees: ['intern'],
    creator: 'devManager',
    estimate: 480,
    completedDaysAgo: 2,
    versions: [
      {
        status: 'CHANGES_REQUESTED',
        message: 'Three hero variations attached as a Figma link: bold type, image-led and minimal.',
        daysAgo: 6,
        reviewer: 'devMentor',
        review:
          'Strong start. The headline is too small on mobile and option B loses contrast on the image — please fix both.',
      },
      {
        status: 'RESUBMITTED',
        message: 'Increased mobile headline to 32px and added a dark overlay to option B.',
        daysAgo: 3,
      },
    ],
    comments: [
      { by: 'devMentor', body: 'Option A is my favourite so far.' },
      { by: 'intern', body: 'Thanks! I’ll push A further for the next version.', replyTo: 0 },
    ],
  },
  {
    key: 'nav',
    project: 'website',
    milestone: 'website-build',
    title: 'Build responsive navigation component',
    description: 'Header navigation with a mobile drawer, keyboard support and visible focus states.',
    status: 'IN_PROGRESS',
    priority: 'HIGH',
    start: -4,
    due: 3,
    assignees: ['intern'],
    creator: 'devManager',
    estimate: 480,
    checklist: [
      ['Desktop layout', true],
      ['Mobile drawer', true],
      ['Keyboard navigation', false],
      ['Screen reader labels', false],
    ],
    comments: [
      {
        by: 'devMentor',
        body: 'Looks good so far — @[Aanya Sharma](intern) remember the focus ring on the menu button.',
        mentions: ['intern'],
      },
      { by: 'intern', body: 'Will do, adding it with the keyboard work.', replyTo: 0 },
    ],
    time: [['intern', 180]],
  },
  {
    key: 'nav-mobile',
    project: 'website',
    milestone: 'website-build',
    parent: 'nav',
    title: 'Mobile menu drawer',
    status: 'COMPLETED',
    priority: 'MEDIUM',
    due: 1,
    assignees: ['intern'],
    creator: 'devManager',
    completedDaysAgo: 1,
  },
  {
    key: 'nav-a11y',
    project: 'website',
    milestone: 'website-build',
    parent: 'nav',
    title: 'Keyboard focus states',
    status: 'IN_PROGRESS',
    priority: 'MEDIUM',
    due: 3,
    assignees: ['intern'],
    creator: 'devManager',
  },
  {
    key: 'case-study',
    project: 'website',
    milestone: 'website-build',
    title: 'Case study page template',
    description: 'Reusable template with hero, challenge, process gallery and results sections.',
    status: 'ASSIGNED',
    priority: 'MEDIUM',
    due: 9,
    assignees: ['intern'],
    creator: 'devManager',
    estimate: 600,
    dependsOn: ['nav'],
  },
  {
    key: 'footer',
    project: 'website',
    milestone: 'website-build',
    title: 'Build site footer and newsletter signup',
    status: 'CHANGES_REQUESTED',
    priority: 'MEDIUM',
    due: 4,
    assignees: ['intern'],
    creator: 'devManager',
    estimate: 240,
    versions: [
      {
        status: 'CHANGES_REQUESTED',
        message: 'Footer with sitemap links, social icons and a newsletter form (preview link in the PR).',
        daysAgo: 1,
        reviewer: 'devMentor',
        review: 'The signup form needs an error state and a success message. Social icons also need accessible names.',
      },
    ],
  },
  {
    key: 'audit',
    project: 'website',
    milestone: 'website-design',
    title: 'Accessibility audit of current site',
    status: 'COMPLETED',
    priority: 'MEDIUM',
    due: -8,
    assignees: ['neel'],
    creator: 'devManager',
    estimate: 240,
    completedDaysAgo: 9,
    versions: [
      {
        status: 'APPROVED',
        message: 'Audit spreadsheet with 42 issues ranked by severity.',
        daysAgo: 10,
        reviewer: 'devManager',
        review: 'Thorough work — this becomes our backlog.',
      },
    ],
  },
  {
    key: 'perf',
    project: 'website',
    milestone: 'website-build',
    title: 'Improve Lighthouse performance score',
    description: 'Lazy-load images, preload the display font and remove unused CSS. Target 90+ on mobile.',
    status: 'IN_REVIEW',
    priority: 'HIGH',
    due: 2,
    assignees: ['neel'],
    creator: 'devManager',
    estimate: 360,
    versions: [
      {
        status: 'SUBMITTED',
        message: 'Mobile score up from 61 to 92. Before/after reports attached in the PR.',
        daysAgo: 0,
      },
    ],
  },
  {
    key: 'chatbot',
    project: 'website',
    title: 'Prototype FAQ assistant for contact page',
    status: 'BLOCKED',
    priority: 'MEDIUM',
    due: 12,
    assignees: ['neel'],
    creator: 'devManager',
    estimate: 720,
    blocked: 'Waiting for the client to approve the FAQ content.',
  },
  {
    key: 'contact-form',
    project: 'website',
    milestone: 'website-build',
    title: 'Contact form with validation',
    status: 'ASSIGNED',
    priority: 'HIGH',
    due: -2,
    assignees: ['neel'],
    creator: 'devManager',
    estimate: 240,
  },
  {
    key: 'qa-mobile',
    project: 'website',
    milestone: 'website-testing',
    title: 'Mobile QA across devices',
    status: 'BACKLOG',
    priority: 'MEDIUM',
    due: 30,
    assignees: [],
    creator: 'devManager',
    estimate: 480,
    checklist: [
      ['iPhone Safari', false],
      ['Android Chrome', false],
      ['Tablet landscape', false],
    ],
  },
  {
    key: 'launch-checklist',
    project: 'website',
    milestone: 'website-launch',
    title: 'Launch checklist and redirects',
    status: 'BACKLOG',
    priority: 'LOW',
    due: 38,
    assignees: [],
    creator: 'devManager',
  },
  {
    key: 'analytics',
    project: 'website',
    title: 'Set up third-party analytics',
    status: 'CANCELLED',
    priority: 'LOW',
    due: null,
    assignees: [],
    creator: 'devManager',
  },

  // ── Social ───────────────────────────────────────────────────────────────
  {
    key: 'reels',
    project: 'social',
    milestone: 'social-mid',
    title: 'Plan October reels calendar',
    status: 'IN_PROGRESS',
    priority: 'URGENT',
    due: 0,
    assignees: ['ishaan'],
    creator: 'manager',
    estimate: 180,
    comments: [
      {
        by: 'manager',
        body: '@[Ishaan Verma](ishaan) please include two behind-the-scenes reels.',
        mentions: ['ishaan'],
      },
    ],
    time: [['ishaan', 120]],
  },
  {
    key: 'captions',
    project: 'social',
    title: 'Write captions for client spotlight series',
    status: 'IN_REVIEW',
    priority: 'MEDIUM',
    due: 2,
    assignees: ['tara'],
    creator: 'manager',
    estimate: 150,
    versions: [
      { status: 'SUBMITTED', message: 'Captions for all six spotlight posts, in the shared doc.', daysAgo: 1 },
    ],
  },
  {
    key: 'report',
    project: 'social',
    milestone: 'social-mid',
    title: 'Compile weekly engagement report',
    status: 'CHANGES_REQUESTED',
    priority: 'HIGH',
    due: -1,
    assignees: ['ishaan'],
    creator: 'manager',
    estimate: 90,
    versions: [
      {
        status: 'CHANGES_REQUESTED',
        message: 'Week 6 engagement report.',
        daysAgo: 2,
        reviewer: 'manager',
        review: 'Please add a week-over-week comparison.',
      },
    ],
  },
  {
    key: 'linkedin',
    project: 'social',
    title: 'LinkedIn carousel: agency process',
    status: 'ASSIGNED',
    priority: 'MEDIUM',
    due: 8,
    assignees: ['tara'],
    creator: 'manager',
    estimate: 240,
  },
  {
    key: 'hashtags',
    project: 'social',
    milestone: 'social-q-plan',
    title: 'Hashtag and competitor research',
    status: 'COMPLETED',
    priority: 'LOW',
    due: -22,
    assignees: ['ishaan'],
    creator: 'manager',
    estimate: 120,
    completedDaysAgo: 23,
  },
  {
    key: 'content-calendar',
    project: 'social',
    milestone: 'social-q-plan',
    title: 'Quarterly content calendar',
    status: 'COMPLETED',
    priority: 'HIGH',
    due: -21,
    assignees: ['tara'],
    creator: 'manager',
    completedDaysAgo: 19,
    versions: [
      {
        status: 'APPROVED',
        message: 'Calendar for October–December.',
        daysAgo: 20,
        reviewer: 'manager',
        review: 'Approved — good mix of formats.',
      },
    ],
  },
  {
    key: 'influencers',
    project: 'social',
    title: 'Shortlist micro-influencer partners',
    status: 'BACKLOG',
    priority: 'LOW',
    due: null,
    assignees: [],
    creator: 'manager',
  },

  // ── Brand ────────────────────────────────────────────────────────────────
  {
    key: 'templates',
    project: 'brand',
    milestone: 'brand-discovery',
    title: 'Moodboard for the identity refresh',
    status: 'IN_REVIEW',
    priority: 'MEDIUM',
    due: -2,
    assignees: ['zara'],
    creator: 'manager',
    estimate: 200,
    versions: [
      {
        status: 'SUBMITTED',
        message: 'Moodboard with three directions: editorial, playful, architectural.',
        daysAgo: 1,
      },
    ],
  },
  {
    key: 'logo-explorations',
    project: 'brand',
    milestone: 'brand-identity',
    title: 'Logo refinement explorations',
    status: 'IN_PROGRESS',
    priority: 'HIGH',
    due: 4,
    assignees: ['zara'],
    creator: 'mentor',
    estimate: 480,
    checklist: [
      ['Wordmark spacing', true],
      ['Monogram options', false],
      ['Small-size tests', false],
    ],
    time: [['zara', 240]],
  },
  {
    key: 'type-scale',
    project: 'brand',
    milestone: 'brand-identity',
    title: 'Define typography scale for templates',
    status: 'ASSIGNED',
    priority: 'MEDIUM',
    due: -3,
    assignees: ['zara'],
    creator: 'manager',
    estimate: 180,
  },
  {
    key: 'palette',
    project: 'brand',
    milestone: 'brand-identity',
    title: 'Colour palette and accessibility pairs',
    status: 'BLOCKED',
    priority: 'MEDIUM',
    due: 10,
    assignees: ['zara'],
    creator: 'manager',
    blocked: 'Waiting for client feedback on the moodboard.',
    dependsOn: ['templates'],
  },

  // ── SEO (on hold) ────────────────────────────────────────────────────────
  {
    key: 'keyword-research',
    project: 'seo',
    milestone: 'seo-audit',
    title: 'Keyword research for studio services',
    status: 'IN_PROGRESS',
    priority: 'MEDIUM',
    due: -6,
    assignees: ['tara'],
    creator: 'manager',
    estimate: 300,
  },
  {
    key: 'meta-audit',
    project: 'seo',
    milestone: 'seo-audit',
    title: 'Audit page titles and meta descriptions',
    status: 'ASSIGNED',
    priority: 'LOW',
    due: 14,
    assignees: ['ishaan'],
    creator: 'manager',
  },

  // ── Onboarding system (planning) ─────────────────────────────────────────
  {
    key: 'onboarding-map',
    project: 'onboarding',
    milestone: 'onboarding-req',
    title: 'Map the current onboarding steps',
    status: 'ASSIGNED',
    priority: 'MEDIUM',
    due: 12,
    assignees: ['neel'],
    creator: 'devManager',
    estimate: 240,
  },
  {
    key: 'onboarding-wireframes',
    project: 'onboarding',
    milestone: 'onboarding-req',
    title: 'Wireframe the intern checklist views',
    status: 'BACKLOG',
    priority: 'MEDIUM',
    due: 20,
    assignees: [],
    creator: 'devManager',
  },
]

export async function seedWork(prisma: PrismaClient, orgId: string, userIds: Record<string, string>, now = new Date()) {
  const projectIds: Record<string, string> = {}
  const taskIds: Record<string, string> = {}

  for (const seed of PROJECTS) {
    const id = seedId(`project:${seed.key}`)
    const data = {
      organization_id: orgId,
      name: seed.name,
      slug: seed.slug,
      description: seed.description,
      status: seed.status,
      priority: seed.priority,
      start_date: dateFrom(now, seed.start),
      target_end_date: dateFrom(now, seed.end),
      owner_id: userIds[seed.owner],
      manager_id: userIds[seed.manager],
      created_by: userIds[seed.owner],
      deleted_at: null,
    }
    await prisma.project.upsert({ where: { id }, update: data, create: { id, ...data } })
    projectIds[seed.key] = id
    await prisma.projectMember.deleteMany({ where: { project_id: id } })
    const members = new Map<string, ProjectMemberRole>([[userIds[seed.owner], 'OWNER']])
    if (seed.manager !== seed.owner) members.set(userIds[seed.manager], 'MANAGER')
    for (const [key, role] of seed.members) if (!members.has(userIds[key])) members.set(userIds[key], role)
    await prisma.projectMember.createMany({
      data: [...members].map(([user_id, role]) => ({ project_id: id, user_id, role, added_by: userIds[seed.owner] })),
    })
  }

  const milestoneIds: Record<string, string> = {}
  for (const [index, seed] of MILESTONES.entries()) {
    const id = seedId(`milestone:${seed.key}`)
    const data = {
      project_id: projectIds[seed.project],
      name: seed.name,
      status: seed.status,
      start_date: seed.start === undefined ? null : dateFrom(now, seed.start),
      due_date: dateFrom(now, seed.due),
      position: index,
      completed_at: seed.status === 'COMPLETED' ? daysFrom(now, seed.due) : null,
    }
    await prisma.milestone.upsert({ where: { id }, update: data, create: { id, ...data } })
    milestoneIds[seed.key] = id
  }
  // Milestones from older seeds that are no longer used.
  await prisma.milestone.deleteMany({
    where: { project_id: { in: Object.values(projectIds) }, id: { notIn: Object.values(milestoneIds) } },
  })

  // Rebuild child rows of seeded tasks so re-seeding gives a known state.
  const ids = TASKS.map((t) => seedId(`task:${t.key}`))
  await prisma.taskDependency.deleteMany({
    where: { OR: [{ task_id: { in: ids } }, { depends_on_task_id: { in: ids } }] },
  })
  await prisma.taskAttachment.deleteMany({ where: { task_id: { in: ids } } })
  await prisma.taskSubmission.deleteMany({ where: { task_id: { in: ids } } })
  await prisma.taskComment.deleteMany({ where: { task_id: { in: ids } } })
  await prisma.taskChecklistItem.deleteMany({ where: { task_id: { in: ids } } })
  await prisma.taskTimeEntry.deleteMany({ where: { task_id: { in: ids } } })
  await prisma.taskAssignee.deleteMany({ where: { task_id: { in: ids } } })

  // Parents before subtasks.
  const ordered = [...TASKS.filter((t) => !t.parent), ...TASKS.filter((t) => t.parent)]
  for (const [position, seed] of ordered.entries()) {
    const id = seedId(`task:${seed.key}`)
    const completedAt = seed.status === 'COMPLETED' ? daysFrom(now, -(seed.completedDaysAgo ?? 1)) : null
    const started = ['IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'CHANGES_REQUESTED', 'COMPLETED'].includes(seed.status)
    const data = {
      organization_id: orgId,
      project_id: projectIds[seed.project],
      milestone_id: seed.milestone ? milestoneIds[seed.milestone] : null,
      parent_task_id: seed.parent ? taskIds[seed.parent] : null,
      title: seed.title,
      description: seed.description ?? null,
      status: seed.status,
      previous_status: null,
      priority: seed.priority,
      created_by: userIds[seed.creator],
      updated_by: userIds[seed.creator],
      start_date: seed.start === undefined ? null : dateFrom(now, seed.start),
      due_date: seed.due === null ? null : dateFrom(now, seed.due),
      estimated_minutes: seed.estimate ?? null,
      actual_minutes: seed.time ? seed.time.reduce((sum, [, minutes]) => sum + minutes, 0) : null,
      blocked_reason: seed.blocked ?? null,
      started_at: started ? daysFrom(now, (seed.due ?? 0) - 5) : null,
      completed_at: completedAt,
      position,
      deleted_at: null,
    }
    await prisma.task.upsert({ where: { id }, update: data, create: { id, ...data } })
    taskIds[seed.key] = id
  }

  for (const seed of TASKS) {
    const taskId = taskIds[seed.key]
    if (seed.assignees.length) {
      await prisma.taskAssignee.createMany({
        data: seed.assignees.map((key) => ({
          task_id: taskId,
          user_id: userIds[key],
          assigned_by: userIds[seed.creator],
        })),
      })
    }
    if (seed.checklist) {
      await prisma.taskChecklistItem.createMany({
        data: seed.checklist.map(([title, done], position) => ({
          task_id: taskId,
          title,
          position,
          is_completed: done,
          completed_at: done ? daysFrom(now, -1) : null,
          completed_by: done ? userIds[seed.assignees[0] ?? seed.creator] : null,
        })),
      })
    }
    for (const dep of seed.dependsOn ?? []) {
      await prisma.taskDependency.create({
        data: { task_id: taskId, depends_on_task_id: taskIds[dep], created_by: userIds[seed.creator] },
      })
    }
    for (const [key, minutes] of seed.time ?? []) {
      await prisma.taskTimeEntry.create({
        data: {
          task_id: taskId,
          user_id: userIds[key],
          duration_minutes: minutes,
          description: 'Focused work session',
          created_at: daysFrom(now, -1),
        },
      })
    }
    if (seed.versions?.length) {
      const submitter = userIds[seed.assignees[0]]
      const last = seed.versions[seed.versions.length - 1]
      // The latest state: a resubmission of a task that ended up approved.
      const finalStatus: SubmissionStatus =
        seed.status === 'COMPLETED' && last.status !== 'APPROVED' ? 'APPROVED' : last.status
      const lastReviewer = last.reviewer ?? (seed.status === 'COMPLETED' ? 'devManager' : undefined)
      const submission = await prisma.taskSubmission.create({
        data: {
          task_id: taskId,
          submitted_by: submitter,
          status: finalStatus,
          description: last.message,
          submitted_at: daysFrom(now, -seed.versions[0].daysAgo),
          reviewed_at: lastReviewer ? daysFrom(now, -Math.max(0, last.daysAgo - 1)) : null,
          reviewed_by: lastReviewer ? userIds[lastReviewer] : null,
          review_comment:
            finalStatus === 'APPROVED' && !last.review ? 'Approved — great iteration.' : (last.review ?? null),
        },
      })
      for (const [index, version] of seed.versions.entries()) {
        const isLast = index === seed.versions.length - 1
        const status: SubmissionStatus = isLast ? finalStatus : version.status
        const reviewer = isLast ? lastReviewer : version.reviewer
        await prisma.submissionVersion.create({
          data: {
            submission_id: submission.id,
            version_number: index + 1,
            description: version.message,
            status,
            submitted_at: daysFrom(now, -version.daysAgo),
            created_by: submitter,
            reviewed_by: reviewer && status !== 'SUBMITTED' && status !== 'RESUBMITTED' ? userIds[reviewer] : null,
            reviewed_at:
              reviewer && status !== 'SUBMITTED' && status !== 'RESUBMITTED'
                ? daysFrom(now, -Math.max(0, version.daysAgo - 1))
                : null,
            review_comment:
              status === 'APPROVED' && !version.review
                ? 'Approved — great iteration.'
                : status === 'SUBMITTED' || status === 'RESUBMITTED'
                  ? null
                  : (version.review ?? null),
          },
        })
      }
    }
    const created: string[] = []
    for (const comment of seed.comments ?? []) {
      // Mention markup uses real user ids.
      const body = comment.body.replace(/\]\(([a-zA-Z]+)\)/g, (_, key: string) => `](${userIds[key]})`)
      const row = await prisma.taskComment.create({
        data: {
          task_id: taskId,
          user_id: userIds[comment.by],
          parent_id: comment.replyTo !== undefined ? created[comment.replyTo] : null,
          body,
          created_at: daysFrom(now, -1, 9 + created.length),
          mentions: { create: (comment.mentions ?? []).map((key) => ({ user_id: userIds[key] })) },
        },
      })
      created.push(row.id)
    }
  }

  // Cached project progress (completed ÷ non-cancelled top-level tasks).
  for (const [key, projectId] of Object.entries(projectIds)) {
    const tasks = TASKS.filter((t) => t.project === key && !t.parent && t.status !== 'CANCELLED')
    const completed = tasks.filter((t) => t.status === 'COMPLETED').length
    await prisma.project.update({
      where: { id: projectId },
      data: { progress_percentage: tasks.length ? Math.round((completed / tasks.length) * 100) : 0 },
    })
  }

  // Project activity (audit entries tagged with projectId), marked as seed-generated.
  const activity: {
    key: string
    actor: Key
    action: string
    project: Key
    type: string
    task?: Key
    hoursAgo: number
    meta?: Record<string, unknown>
  }[] = [
    ...PROJECTS.map((p) => ({
      key: `created:${p.key}`,
      actor: p.owner,
      action: 'project.created',
      project: p.key,
      type: 'project',
      hoursAgo: -p.start * 24,
    })),
    {
      key: 'milestone:research',
      actor: 'devManager',
      action: 'milestone.completed',
      project: 'website',
      type: 'milestone',
      hoursAgo: 600,
      meta: { name: 'Research' },
    },
    {
      key: 'hero:v1',
      actor: 'intern',
      action: 'task.submitted',
      project: 'website',
      type: 'task',
      task: 'hero',
      hoursAgo: 144,
      meta: { version: 1 },
    },
    {
      key: 'hero:cr',
      actor: 'devMentor',
      action: 'task.reviewed',
      project: 'website',
      type: 'task',
      task: 'hero',
      hoursAgo: 120,
      meta: { version: 1, decision: 'CHANGES_REQUESTED' },
    },
    {
      key: 'hero:v2',
      actor: 'intern',
      action: 'task.submitted',
      project: 'website',
      type: 'task',
      task: 'hero',
      hoursAgo: 72,
      meta: { version: 2 },
    },
    {
      key: 'hero:ok',
      actor: 'devManager',
      action: 'task.reviewed',
      project: 'website',
      type: 'task',
      task: 'hero',
      hoursAgo: 48,
      meta: { version: 2, decision: 'APPROVED' },
    },
    {
      key: 'chatbot:blocked',
      actor: 'neel',
      action: 'task.status_changed',
      project: 'website',
      type: 'task',
      task: 'chatbot',
      hoursAgo: 30,
      meta: { from: 'IN_PROGRESS', to: 'BLOCKED', reason: 'Waiting for the client to approve the FAQ content.' },
    },
    {
      key: 'perf:v1',
      actor: 'neel',
      action: 'task.submitted',
      project: 'website',
      type: 'task',
      task: 'perf',
      hoursAgo: 3,
      meta: { version: 1 },
    },
    {
      key: 'report:cr',
      actor: 'manager',
      action: 'task.reviewed',
      project: 'social',
      type: 'task',
      task: 'report',
      hoursAgo: 40,
      meta: { version: 1, decision: 'CHANGES_REQUESTED' },
    },
    {
      key: 'captions:v1',
      actor: 'tara',
      action: 'task.submitted',
      project: 'social',
      type: 'task',
      task: 'captions',
      hoursAgo: 20,
      meta: { version: 1 },
    },
    {
      key: 'seo:hold',
      actor: 'manager',
      action: 'project.status_changed',
      project: 'seo',
      type: 'project',
      hoursAgo: 96,
      meta: { from: 'ACTIVE', to: 'ON_HOLD', reason: 'Waiting for the client’s budget approval.' },
    },
    {
      key: 'moodboard:v1',
      actor: 'zara',
      action: 'task.submitted',
      project: 'brand',
      type: 'task',
      task: 'templates',
      hoursAgo: 22,
      meta: { version: 1 },
    },
  ]
  for (const entry of activity) {
    const id = seedId(`audit:work:${entry.key}`)
    const task = entry.task ? TASKS.find((t) => t.key === entry.task) : undefined
    const data = {
      organization_id: orgId,
      actor_user_id: userIds[entry.actor],
      action: entry.action,
      resource_type: entry.type,
      resource_id: entry.task ? taskIds[entry.task] : projectIds[entry.project],
      metadata: {
        source: 'seed',
        projectId: projectIds[entry.project],
        ...(task ? { title: task.title } : {}),
        ...(entry.meta ?? {}),
      },
      created_at: new Date(now.getTime() - entry.hoursAgo * 60 * 60 * 1000),
    }
    await prisma.auditLog.upsert({ where: { id }, update: data, create: { id, ...data } })
  }

  // A few in-app notifications so the bell isn't empty in development.
  const notifications: {
    key: string
    user: Key
    type: string
    title: string
    task?: Key
    project?: Key
    hoursAgo: number
    read?: boolean
  }[] = [
    {
      key: 'intern:footer',
      user: 'intern',
      type: 'TASK_CHANGES_REQUESTED',
      title: 'Changes requested on “Build site footer and newsletter signup”',
      task: 'footer',
      hoursAgo: 20,
    },
    {
      key: 'intern:mention',
      user: 'intern',
      type: 'TASK_COMMENT_MENTION',
      title: 'You were mentioned on “Build responsive navigation component”',
      task: 'nav',
      hoursAgo: 14,
    },
    {
      key: 'intern:hero',
      user: 'intern',
      type: 'TASK_APPROVED',
      title: 'Approved: “Design homepage hero variations”',
      task: 'hero',
      hoursAgo: 48,
      read: true,
    },
    {
      key: 'manager:captions',
      user: 'manager',
      type: 'TASK_SUBMITTED',
      title: 'Submitted for review: “Write captions for client spotlight series”',
      task: 'captions',
      hoursAgo: 20,
    },
    {
      key: 'mentor:moodboard',
      user: 'mentor',
      type: 'TASK_SUBMITTED',
      title: 'Submitted for review: “Moodboard for the identity refresh”',
      task: 'templates',
      hoursAgo: 22,
    },
  ]
  for (const n of notifications) {
    const id = seedId(`notification:${n.key}`)
    const data = {
      organization_id: orgId,
      user_id: userIds[n.user],
      type: n.type,
      title: n.title,
      related_entity_type: n.task ? 'task' : 'project',
      related_entity_id: n.task ? taskIds[n.task] : projectIds[n.project!],
      read_at: n.read ? new Date(now.getTime() - (n.hoursAgo - 1) * 60 * 60 * 1000) : null,
      created_at: new Date(now.getTime() - n.hoursAgo * 60 * 60 * 1000),
    }
    await prisma.notification.upsert({ where: { id }, update: data, create: { id, ...data } })
  }

  return { projectIds, taskIds }
}

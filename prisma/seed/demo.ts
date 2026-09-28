import type {
  InternStatus,
  PrismaClient,
  ProjectStatus,
  SubmissionStatus,
  TaskPriority,
  TaskStatus,
} from '@prisma/client'
import { internshipStatusFor } from '../../src/lib/interns/lifecycle'
import type { SystemRoleSlug } from '../../src/lib/permissions/catalog'
import { dateFrom, daysFrom, seedId } from './ids'
import { seedOnboarding } from './onboarding'
import type { ReferenceData } from './reference'

/**
 * DEVELOPMENT / DEMO DATA — never run in production.
 *
 * Fictional people, projects, tasks and courses so every screen has realistic
 * content during development. Records use deterministic ids; each run refreshes
 * them (including relative dates such as deadlines) without duplicating rows.
 */

interface PersonSeed {
  key: string
  email: string
  first: string
  last: string
  role: SystemRoleSlug
}

export const DEV_ACCOUNTS: PersonSeed[] = [
  { key: 'admin', email: 'admin@ayavacreatives.com', first: 'Meera', last: 'Iyer', role: 'super_admin' },
  { key: 'hr', email: 'hr@ayavacreatives.com', first: 'Kavya', last: 'Nair', role: 'hr' },
  { key: 'manager', email: 'manager@ayavacreatives.com', first: 'Arjun', last: 'Mehta', role: 'manager' },
  { key: 'mentor', email: 'mentor@ayavacreatives.com', first: 'Rohan', last: 'Das', role: 'mentor' },
  { key: 'intern', email: 'intern@ayavacreatives.com', first: 'Aanya', last: 'Sharma', role: 'intern' },
  // Phase 03: a manager and a mentor for other departments, so manager/mentor scope is visible.
  { key: 'marketingManager', email: 'marketing.manager@ayavacreatives.com', first: 'Priya', last: 'Kapoor', role: 'manager' },
  { key: 'designMentor', email: 'design.mentor@ayavacreatives.com', first: 'Sana', last: 'Qureshi', role: 'mentor' },
]

const DEMO_INTERNS: PersonSeed[] = [
  { key: 'ishaan', email: 'ishaan.verma@demo.ayavacreatives.com', first: 'Ishaan', last: 'Verma', role: 'intern' },
  { key: 'zara', email: 'zara.khan@demo.ayavacreatives.com', first: 'Zara', last: 'Khan', role: 'intern' },
  { key: 'neel', email: 'neel.joshi@demo.ayavacreatives.com', first: 'Neel', last: 'Joshi', role: 'intern' },
  { key: 'tara', email: 'tara.menon@demo.ayavacreatives.com', first: 'Tara', last: 'Menon', role: 'intern' },
  { key: 'diya', email: 'diya.patel@demo.ayavacreatives.com', first: 'Diya', last: 'Patel', role: 'intern' },
  { key: 'kabir', email: 'kabir.singh@demo.ayavacreatives.com', first: 'Kabir', last: 'Singh', role: 'intern' },
  { key: 'rhea', email: 'rhea.kulkarni@demo.ayavacreatives.com', first: 'Rhea', last: 'Kulkarni', role: 'intern' },
]

export async function seedDemo(prisma: PrismaClient, ref: ReferenceData, now = new Date()) {
  const orgId = ref.organizationId
  const userIds: Record<string, string> = {}

  // ── People ────────────────────────────────────────────────────────────────
  for (const person of [...DEV_ACCOUNTS, ...DEMO_INTERNS]) {
    const user = await prisma.user.upsert({
      where: { organization_id_email: { organization_id: orgId, email: person.email } },
      update: { first_name: person.first, last_name: person.last, status: 'ACTIVE', deleted_at: null },
      create: {
        id: seedId(`user:${person.key}`),
        organization_id: orgId,
        email: person.email,
        first_name: person.first,
        last_name: person.last,
        status: 'ACTIVE',
        timezone: 'Asia/Kolkata',
      },
    })
    userIds[person.key] = user.id
    await prisma.userRole.upsert({
      where: { user_id_role_id: { user_id: user.id, role_id: ref.roleIds[person.role] } },
      update: {},
      create: { user_id: user.id, role_id: ref.roleIds[person.role] },
    })
  }

  // ── Structure: department heads and teams ─────────────────────────────────
  await prisma.department.update({
    where: { id: ref.departmentIds.development },
    data: { head_user_id: userIds.manager },
  })
  await prisma.department.update({ where: { id: ref.departmentIds.hr }, data: { head_user_id: userIds.hr } })

  const teamSeeds = [
    {
      key: 'web',
      slug: 'web-squad',
      name: 'Web Squad',
      department: 'development',
      lead: 'manager',
      description: 'Builds and maintains client and in-house websites.',
    },
    {
      key: 'social',
      slug: 'social-studio',
      name: 'Social Studio',
      department: 'marketing',
      lead: 'marketingManager',
      description: 'Plans, creates and reports on social content.',
    },
    {
      key: 'brand',
      slug: 'brand-design',
      name: 'Brand Design',
      department: 'design',
      lead: 'designMentor',
      description: 'Identity systems, campaign visuals and templates.',
    },
  ]
  const teamIds: Record<string, string> = {}
  for (const team of teamSeeds) {
    const record = await prisma.team.upsert({
      where: { organization_id_slug: { organization_id: orgId, slug: team.slug } },
      update: { team_lead_id: userIds[team.lead] },
      create: {
        organization_id: orgId,
        slug: team.slug,
        name: team.name,
        description: team.description,
        department_id: ref.departmentIds[team.department],
        team_lead_id: userIds[team.lead],
      },
    })
    teamIds[team.key] = record.id
  }

  // ── Interns and internships ───────────────────────────────────────────────
  // Managers and mentors follow the department, so scoping is realistic:
  // Arjun manages Development and Design, Priya manages Marketing; Rohan mentors
  // Development and Marketing, Sana mentors Design.
  const internSeeds: {
    key: string
    code: string
    status: InternStatus
    joinedDaysAgo: number
    weeks: number
    position: string
    department: string
    team: string
    manager: string
    mentor: string
  }[] = [
    { key: 'intern', code: 'AYV-INT-0001', status: 'ACTIVE', joinedDaysAgo: 30, weeks: 12, position: 'web-development-intern', department: 'development', team: 'web', manager: 'manager', mentor: 'mentor' },
    { key: 'ishaan', code: 'AYV-INT-0002', status: 'ACTIVE', joinedDaysAgo: 45, weeks: 12, position: 'social-media-intern', department: 'marketing', team: 'social', manager: 'marketingManager', mentor: 'mentor' },
    { key: 'zara', code: 'AYV-INT-0003', status: 'ACTIVE', joinedDaysAgo: 20, weeks: 12, position: 'graphic-design-intern', department: 'design', team: 'brand', manager: 'manager', mentor: 'designMentor' },
    { key: 'neel', code: 'AYV-INT-0004', status: 'ONBOARDING', joinedDaysAgo: 2, weeks: 16, position: 'ai-ml-intern', department: 'development', team: 'web', manager: 'manager', mentor: 'mentor' },
    { key: 'tara', code: 'AYV-INT-0005', status: 'ENDING_SOON', joinedDaysAgo: 78, weeks: 12, position: 'content-writing-intern', department: 'marketing', team: 'social', manager: 'marketingManager', mentor: 'mentor' },
    { key: 'diya', code: 'AYV-INT-0006', status: 'ACTIVE', joinedDaysAgo: 15, weeks: 12, position: 'ui-ux-intern', department: 'design', team: 'brand', manager: 'manager', mentor: 'designMentor' },
    { key: 'kabir', code: 'AYV-INT-0007', status: 'SELECTED', joinedDaysAgo: -10, weeks: 12, position: 'digital-marketing-intern', department: 'marketing', team: 'social', manager: 'marketingManager', mentor: 'mentor' },
    { key: 'rhea', code: 'AYV-INT-0008', status: 'COMPLETED', joinedDaysAgo: 100, weeks: 12, position: 'graphic-design-intern', department: 'design', team: 'brand', manager: 'manager', mentor: 'designMentor' },
  ]

  const internIds: Record<string, string> = {}
  const internshipIds: Record<string, string> = {}
  for (const seed of internSeeds) {
    const joining = dateFrom(now, -seed.joinedDaysAgo)
    const expectedEnd = dateFrom(joining, seed.weeks * 7 - 1)
    const finished = seed.status === 'COMPLETED' || seed.status === 'ALUMNI'
    const data = {
      organization_id: orgId,
      user_id: userIds[seed.key],
      employee_code: seed.code,
      status: seed.status,
      joining_date: joining,
      expected_end_date: expectedEnd,
      department_id: ref.departmentIds[seed.department],
      team_id: teamIds[seed.team],
      position_id: ref.positionIds[seed.position],
      manager_id: userIds[seed.manager],
      mentor_id: userIds[seed.mentor],
      actual_end_date: finished ? expectedEnd : null,
    }
    const intern = await prisma.intern.upsert({
      where: { user_id: userIds[seed.key] },
      update: data,
      create: { id: seedId(`intern:${seed.key}`), ...data },
    })
    internIds[seed.key] = intern.id

    const internshipId = seedId(`internship:${seed.key}`)
    const internshipData = {
      organization_id: orgId,
      intern_id: intern.id,
      title: `${seed.weeks}-week internship`,
      department_id: ref.departmentIds[seed.department],
      position_id: ref.positionIds[seed.position],
      start_date: joining,
      expected_end_date: expectedEnd,
      status: internshipStatusFor(seed.status),
      actual_end_date: finished ? expectedEnd : null,
      work_mode: seed.key === 'zara' ? ('ONSITE' as const) : ('HYBRID' as const),
      location: 'Bengaluru',
      manager_id: userIds[seed.manager],
      mentor_id: userIds[seed.mentor],
    }
    await prisma.internship.upsert({
      where: { id: internshipId },
      update: internshipData,
      create: { id: internshipId, ...internshipData },
    })
    internshipIds[seed.key] = internshipId
  }

  await prisma.internProfile.upsert({
    where: { intern_id: internIds.intern },
    update: {},
    create: {
      intern_id: internIds.intern,
      city: 'Bengaluru',
      state: 'Karnataka',
      country: 'India',
      education_level: 'Undergraduate',
      institution: 'Demo Institute of Technology',
      field_of_study: 'Computer Science',
      graduation_year: now.getUTCFullYear() + 1,
      bio: 'Front-end developer interested in design systems and accessibility.',
    },
  })

  await prisma.emergencyContact.upsert({
    where: { id: seedId('emergency:intern') },
    update: {},
    create: {
      id: seedId('emergency:intern'),
      intern_id: internIds.intern,
      name: 'Rakesh Sharma',
      relationship: 'Parent',
      phone: '+91 98450 00000',
    },
  })

  // Onboarding templates, policies, per-intern checklists and lifecycle history.
  await seedOnboarding(prisma, {
    organizationId: orgId,
    departmentIds: ref.departmentIds,
    userIds,
    interns: internSeeds.map((seed) => ({
      key: seed.key,
      status: seed.status,
      department: seed.department,
      internId: internIds[seed.key],
      internshipId: internshipIds[seed.key],
      joiningDate: dateFrom(now, -seed.joinedDaysAgo),
      managerKey: seed.manager,
      mentorKey: seed.mentor,
    })),
    now,
  })

  // ── Projects, milestones, tasks ───────────────────────────────────────────
  const projectSeeds: {
    key: string
    slug: string
    name: string
    description: string
    status: ProjectStatus
    start: number
    end: number
    owner: string
    members: string[]
  }[] = [
    {
      key: 'website',
      slug: 'ayava-website-revamp',
      name: 'Ayava Website Revamp',
      description: 'Redesign and rebuild ayavacreatives.com with a new case-study system.',
      status: 'ACTIVE',
      start: -28,
      end: 35,
      owner: 'manager',
      members: ['intern', 'diya', 'neel', 'mentor'],
    },
    {
      key: 'social',
      slug: 'social-media-growth-campaign',
      name: 'Social Media Growth Campaign',
      description: 'Quarter-long Instagram and LinkedIn growth push with weekly reporting.',
      status: 'ACTIVE',
      start: -40,
      end: 50,
      owner: 'manager',
      members: ['ishaan', 'tara', 'kabir'],
    },
    {
      key: 'brand',
      slug: 'brand-content-system',
      name: 'Brand Content System',
      description: 'Reusable templates and guidelines for campaign and social content.',
      status: 'PLANNED',
      start: 7,
      end: 60,
      owner: 'mentor',
      members: ['zara', 'diya'],
    },
  ]
  const projectIds: Record<string, string> = {}
  for (const seed of projectSeeds) {
    const data = {
      organization_id: orgId,
      name: seed.name,
      description: seed.description,
      status: seed.status,
      start_date: dateFrom(now, seed.start),
      target_end_date: dateFrom(now, seed.end),
      owner_id: userIds[seed.owner],
      deleted_at: null,
    }
    const project = await prisma.project.upsert({
      where: { organization_id_slug: { organization_id: orgId, slug: seed.slug } },
      update: data,
      create: { id: seedId(`project:${seed.key}`), slug: seed.slug, ...data },
    })
    projectIds[seed.key] = project.id
    await prisma.projectMember.createMany({
      data: [
        { project_id: project.id, user_id: userIds[seed.owner], role: 'OWNER' as const },
        ...seed.members.map((member) => ({
          project_id: project.id,
          user_id: userIds[member],
          role: 'MEMBER' as const,
        })),
      ],
      skipDuplicates: true,
    })
  }

  const milestoneSeeds = [
    { key: 'website-design', project: 'website', name: 'Design sign-off', due: 5, status: 'IN_PROGRESS' },
    { key: 'website-build', project: 'website', name: 'Build and content migration', due: 28, status: 'PLANNED' },
    { key: 'social-q-plan', project: 'social', name: 'Quarterly content plan', due: -10, status: 'COMPLETED' },
    { key: 'social-mid', project: 'social', name: 'Mid-campaign report', due: 9, status: 'PLANNED' },
  ] as const
  const milestoneIds: Record<string, string> = {}
  for (const seed of milestoneSeeds) {
    const id = seedId(`milestone:${seed.key}`)
    const data = {
      project_id: projectIds[seed.project],
      name: seed.name,
      due_date: dateFrom(now, seed.due),
      status: seed.status,
    }
    await prisma.milestone.upsert({ where: { id }, update: data, create: { id, ...data } })
    milestoneIds[seed.key] = id
  }

  const taskSeeds: {
    key: string
    project: string
    milestone?: string
    title: string
    status: TaskStatus
    priority: TaskPriority
    due: number | null
    assignees: string[]
    estimate?: number
    submission?: SubmissionStatus
  }[] = [
    {
      key: 'hero',
      project: 'website',
      milestone: 'website-design',
      title: 'Design homepage hero variations',
      status: 'IN_REVIEW',
      priority: 'HIGH',
      due: 1,
      assignees: ['diya'],
      estimate: 360,
      submission: 'SUBMITTED',
    },
    {
      key: 'nav',
      project: 'website',
      milestone: 'website-design',
      title: 'Build responsive navigation component',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      due: 3,
      assignees: ['intern'],
      estimate: 480,
    },
    {
      key: 'case-study',
      project: 'website',
      milestone: 'website-build',
      title: 'Case study page template',
      status: 'ASSIGNED',
      priority: 'MEDIUM',
      due: 6,
      assignees: ['intern', 'diya'],
      estimate: 600,
    },
    {
      key: 'audit',
      project: 'website',
      milestone: 'website-design',
      title: 'Accessibility audit of current site',
      status: 'COMPLETED',
      priority: 'MEDIUM',
      due: -5,
      assignees: ['intern'],
      estimate: 240,
      submission: 'APPROVED',
    },
    {
      key: 'analytics',
      project: 'website',
      milestone: 'website-build',
      title: 'Set up privacy-friendly analytics',
      status: 'BACKLOG',
      priority: 'LOW',
      due: null,
      assignees: [],
    },
    {
      key: 'chatbot',
      project: 'website',
      title: 'Prototype FAQ assistant for contact page',
      status: 'BLOCKED',
      priority: 'MEDIUM',
      due: 12,
      assignees: ['neel'],
      estimate: 720,
    },
    {
      key: 'reels',
      project: 'social',
      milestone: 'social-mid',
      title: 'Plan October reels calendar',
      status: 'IN_PROGRESS',
      priority: 'URGENT',
      due: 0,
      assignees: ['ishaan'],
      estimate: 180,
    },
    {
      key: 'captions',
      project: 'social',
      title: 'Write captions for client spotlight series',
      status: 'IN_REVIEW',
      priority: 'MEDIUM',
      due: 2,
      assignees: ['tara'],
      estimate: 150,
      submission: 'UNDER_REVIEW',
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
      estimate: 90,
      submission: 'CHANGES_REQUESTED',
    },
    {
      key: 'linkedin',
      project: 'social',
      title: 'LinkedIn carousel: agency process',
      status: 'ASSIGNED',
      priority: 'MEDIUM',
      due: 8,
      assignees: ['tara', 'kabir'],
      estimate: 240,
    },
    {
      key: 'hashtags',
      project: 'social',
      milestone: 'social-q-plan',
      title: 'Hashtag and competitor research',
      status: 'COMPLETED',
      priority: 'LOW',
      due: -12,
      assignees: ['ishaan'],
      estimate: 120,
    },
    {
      key: 'templates',
      project: 'brand',
      title: 'Moodboard for brand template refresh',
      status: 'IN_REVIEW',
      priority: 'MEDIUM',
      due: 4,
      assignees: ['zara'],
      estimate: 200,
      submission: 'SUBMITTED',
    },
    {
      key: 'type-scale',
      project: 'brand',
      title: 'Define typography scale for templates',
      status: 'BACKLOG',
      priority: 'LOW',
      due: 20,
      assignees: [],
    },
  ]
  for (const seed of taskSeeds) {
    const id = seedId(`task:${seed.key}`)
    const due = seed.due === null ? null : daysFrom(now, seed.due)
    const data = {
      organization_id: orgId,
      project_id: projectIds[seed.project],
      milestone_id: seed.milestone ? milestoneIds[seed.milestone] : null,
      title: seed.title,
      status: seed.status,
      priority: seed.priority,
      created_by: userIds.manager,
      due_date: due,
      estimated_minutes: seed.estimate ?? null,
      completed_at: seed.status === 'COMPLETED' && due ? due : null,
      deleted_at: null,
    }
    await prisma.task.upsert({ where: { id }, update: data, create: { id, ...data } })
    await prisma.taskAssignee.createMany({
      data: seed.assignees.map((assignee) => ({
        task_id: id,
        user_id: userIds[assignee],
        assigned_by: userIds.manager,
      })),
      skipDuplicates: true,
    })

    if (seed.submission && seed.assignees[0]) {
      const submissionId = seedId(`submission:${seed.key}`)
      const reviewed = ['APPROVED', 'CHANGES_REQUESTED', 'REJECTED'].includes(seed.submission)
      const submissionData = {
        task_id: id,
        submitted_by: userIds[seed.assignees[0]],
        status: seed.submission,
        description: 'Submitted for review.',
        submitted_at: daysFrom(now, (seed.due ?? 0) - 2),
        reviewed_at: reviewed ? daysFrom(now, (seed.due ?? 0) - 1) : null,
        reviewed_by: reviewed ? userIds.manager : null,
        review_comment: seed.submission === 'CHANGES_REQUESTED' ? 'Please add week-over-week comparison.' : null,
      }
      await prisma.taskSubmission.upsert({
        where: { id: submissionId },
        update: submissionData,
        create: { id: submissionId, ...submissionData },
      })
      await prisma.submissionVersion.upsert({
        where: { submission_id_version_number: { submission_id: submissionId, version_number: 1 } },
        update: {},
        create: {
          submission_id: submissionId,
          version_number: 1,
          description: 'Initial submission',
          created_by: submissionData.submitted_by,
        },
      })
    }
  }

  // ── Learning ──────────────────────────────────────────────────────────────
  const courseSeeds = [
    {
      key: 'orientation',
      slug: 'ayava-orientation',
      title: 'Ayava Orientation',
      description: 'How Ayava works: people, tools, rituals and expectations.',
      lessons: [
        ['Welcome to Ayava Creatives', 15],
        ['How we plan and review work', 20],
        ['Tools and workspace etiquette', 15],
      ],
    },
    {
      key: 'dm-fundamentals',
      slug: 'digital-marketing-fundamentals',
      title: 'Digital Marketing Fundamentals',
      description: 'Channels, audiences, content strategy and measurement basics.',
      lessons: [
        ['The marketing funnel', 25],
        ['Content that performs on social', 30],
        ['Reading engagement metrics', 25],
      ],
    },
    {
      key: 'agency-workflow',
      slug: 'creative-agency-workflow',
      title: 'Creative Agency Workflow',
      description: 'From brief to delivery: briefs, feedback rounds and handoff.',
      lessons: [
        ['Understanding a client brief', 20],
        ['Giving and receiving creative feedback', 20],
        ['Preparing files for handoff', 15],
      ],
    },
  ] as const
  for (const course of courseSeeds) {
    const record = await prisma.course.upsert({
      where: { organization_id_slug: { organization_id: orgId, slug: course.slug } },
      update: { status: 'PUBLISHED' },
      create: {
        id: seedId(`course:${course.key}`),
        organization_id: orgId,
        slug: course.slug,
        title: course.title,
        description: course.description,
        status: 'PUBLISHED',
        created_by: userIds.hr,
      },
    })
    for (const [index, [title, minutes]] of course.lessons.entries()) {
      const id = seedId(`lesson:${course.key}:${index}`)
      const data = { course_id: record.id, title, sort_order: index, estimated_minutes: minutes }
      await prisma.lesson.upsert({ where: { id }, update: data, create: { id, ...data } })
    }
  }
  const quizId = seedId('quiz:orientation:0')
  await prisma.quiz.upsert({
    where: { id: quizId },
    update: {},
    create: {
      id: quizId,
      lesson_id: seedId('lesson:orientation:1'),
      title: 'Planning and review check',
      passing_score: 70,
    },
  })

  // ── Communication ─────────────────────────────────────────────────────────
  const announcementId = seedId('announcement:welcome')
  const announcementData = {
    organization_id: orgId,
    title: 'Welcome to AYAVA INTERN OS',
    body: 'This workspace is running on development demo data. People, projects and tasks shown here are fictional.',
    priority: 'NORMAL' as const,
    published_by: userIds.hr,
    published_at: daysFrom(now, -1),
    expires_at: null,
  }
  await prisma.announcement.upsert({
    where: { id: announcementId },
    update: announcementData,
    create: { id: announcementId, ...announcementData },
  })

  await prisma.channel.upsert({
    where: { organization_id_slug: { organization_id: orgId, slug: 'general' } },
    update: {},
    create: {
      organization_id: orgId,
      slug: 'general',
      name: 'general',
      description: 'Company-wide conversation',
      channel_type: 'GENERAL',
      created_by: userIds.admin,
    },
  })

  // ── Audit trail for the records above (marked as seed-generated) ──────────
  const auditSeeds = [
    {
      key: 'website',
      actor: 'manager',
      action: 'project.created',
      type: 'project',
      id: projectIds.website,
      hoursAgo: 72,
    },
    { key: 'neel', actor: 'hr', action: 'intern.onboarding_started', type: 'intern', id: internIds.neel, hoursAgo: 48 },
    { key: 'hero', actor: 'diya', action: 'task.submitted', type: 'task', id: seedId('task:hero'), hoursAgo: 20 },
    {
      key: 'report',
      actor: 'manager',
      action: 'task.changes_requested',
      type: 'task',
      id: seedId('task:report'),
      hoursAgo: 6,
    },
    {
      key: 'welcome',
      actor: 'hr',
      action: 'announcement.published',
      type: 'announcement',
      id: announcementId,
      hoursAgo: 24,
    },
  ]
  for (const entry of auditSeeds) {
    const id = seedId(`audit:${entry.key}`)
    const data = {
      organization_id: orgId,
      actor_user_id: userIds[entry.actor],
      action: entry.action,
      resource_type: entry.type,
      resource_id: entry.id,
      metadata: { source: 'seed' },
      created_at: new Date(now.getTime() - entry.hoursAgo * 60 * 60 * 1000),
    }
    await prisma.auditLog.upsert({ where: { id }, update: data, create: { id, ...data } })
  }

  return { userIds, accounts: DEV_ACCOUNTS }
}

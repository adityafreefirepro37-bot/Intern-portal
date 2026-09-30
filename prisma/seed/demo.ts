import type { InternStatus, PrismaClient } from '@prisma/client'
import type { SystemRoleSlug } from '../../src/lib/permissions/catalog'
import { dateFrom, daysFrom, seedId } from './ids'
import type { ReferenceData } from './reference'
import { seedHr } from './hr'
import { seedWork } from './work'

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
]

/** Additional staff (profiles only — no sign-in): the development manager and mentor. */
const DEMO_STAFF: PersonSeed[] = [
  { key: 'devManager', email: 'vikram.rao@demo.ayavacreatives.com', first: 'Vikram', last: 'Rao', role: 'manager' },
  {
    key: 'devMentor',
    email: 'priya.kulkarni@demo.ayavacreatives.com',
    first: 'Priya',
    last: 'Kulkarni',
    role: 'mentor',
  },
]

const DEMO_INTERNS: PersonSeed[] = [
  { key: 'ishaan', email: 'ishaan.verma@demo.ayavacreatives.com', first: 'Ishaan', last: 'Verma', role: 'intern' },
  { key: 'zara', email: 'zara.khan@demo.ayavacreatives.com', first: 'Zara', last: 'Khan', role: 'intern' },
  { key: 'neel', email: 'neel.joshi@demo.ayavacreatives.com', first: 'Neel', last: 'Joshi', role: 'intern' },
  { key: 'tara', email: 'tara.menon@demo.ayavacreatives.com', first: 'Tara', last: 'Menon', role: 'intern' },
  { key: 'diya', email: 'diya.patel@demo.ayavacreatives.com', first: 'Diya', last: 'Patel', role: 'intern' },
  { key: 'kabir', email: 'kabir.singh@demo.ayavacreatives.com', first: 'Kabir', last: 'Singh', role: 'intern' },
]

export async function seedDemo(prisma: PrismaClient, ref: ReferenceData, now = new Date()) {
  const orgId = ref.organizationId
  const userIds: Record<string, string> = {}

  // ── People ────────────────────────────────────────────────────────────────
  for (const person of [...DEV_ACCOUNTS, ...DEMO_STAFF, ...DEMO_INTERNS]) {
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
  // Arjun (manager@) runs Marketing; Vikram runs Development; Kavya (hr@) runs HR.
  await prisma.department.update({
    where: { id: ref.departmentIds.marketing },
    data: { head_user_id: userIds.manager },
  })
  await prisma.department.update({
    where: { id: ref.departmentIds.development },
    data: { head_user_id: userIds.devManager },
  })
  await prisma.department.update({ where: { id: ref.departmentIds.hr }, data: { head_user_id: userIds.hr } })

  const teamSeeds = [
    {
      key: 'web',
      slug: 'web-squad',
      name: 'Web Squad',
      department: 'development',
      lead: 'devManager',
      description: 'Builds and maintains client and in-house websites.',
    },
    {
      key: 'social',
      slug: 'social-studio',
      name: 'Social Studio',
      department: 'marketing',
      lead: 'manager',
      description: 'Plans, creates and reports on social content.',
    },
    {
      key: 'brand',
      slug: 'brand-design',
      name: 'Brand Design',
      department: 'design',
      lead: 'mentor',
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
  // One intern per lifecycle state. Onboarding checklists are generated from
  // the templates exactly as the app does it (snapshot copy, due = start + offset).
  const internSeeds: {
    key: string
    code: string
    status: InternStatus
    joinedDaysAgo: number
    weeks: number
    position: string
    department: string
    team: string
    manager: string | null
    mentor: string | null
    template: string | null
    /** Indexes of template items already done (null = all). */
    done: number[] | null
  }[] = [
    {
      key: 'intern',
      code: 'AYV-INT-0001',
      status: 'ONBOARDING',
      joinedDaysAgo: 2,
      weeks: 12,
      position: 'web-development-intern',
      department: 'development',
      team: 'web',
      manager: 'devManager',
      mentor: 'devMentor',
      template: 'Development Intern Onboarding',
      done: [3, 5, 6],
    },
    {
      key: 'ishaan',
      code: 'AYV-INT-0002',
      status: 'ACTIVE',
      joinedDaysAgo: 45,
      weeks: 12,
      position: 'social-media-intern',
      department: 'marketing',
      team: 'social',
      manager: 'manager',
      mentor: 'mentor',
      template: 'Marketing Intern Onboarding',
      done: null,
    },
    {
      key: 'zara',
      code: 'AYV-INT-0003',
      status: 'ACTIVE',
      joinedDaysAgo: 20,
      weeks: 12,
      position: 'graphic-design-intern',
      department: 'design',
      team: 'brand',
      manager: 'manager',
      mentor: 'mentor',
      template: 'Design Intern Onboarding',
      done: null,
    },
    {
      key: 'neel',
      code: 'AYV-INT-0004',
      status: 'ACTIVE',
      joinedDaysAgo: 12,
      weeks: 16,
      position: 'ai-ml-intern',
      department: 'development',
      team: 'web',
      manager: 'devManager',
      mentor: 'devMentor',
      template: 'Development Intern Onboarding',
      done: null,
    },
    {
      key: 'tara',
      code: 'AYV-INT-0005',
      status: 'ENDING_SOON',
      joinedDaysAgo: 78,
      weeks: 12,
      position: 'content-writing-intern',
      department: 'marketing',
      team: 'social',
      manager: 'manager',
      mentor: 'mentor',
      template: 'Marketing Intern Onboarding',
      done: null,
    },
    {
      key: 'diya',
      code: 'AYV-INT-0006',
      status: 'COMPLETED',
      joinedDaysAgo: 100,
      weeks: 12,
      position: 'ui-ux-intern',
      department: 'design',
      team: 'brand',
      manager: 'manager',
      mentor: 'mentor',
      template: 'Design Intern Onboarding',
      done: null,
    },
    {
      key: 'kabir',
      code: 'AYV-INT-0007',
      status: 'SELECTED',
      joinedDaysAgo: -10,
      weeks: 12,
      position: 'digital-marketing-intern',
      department: 'marketing',
      team: 'social',
      manager: 'manager',
      mentor: null,
      template: null,
      done: null,
    },
  ]

  const internIds: Record<string, string> = {}
  const internshipIds: Record<string, string> = {}
  for (const seed of internSeeds) {
    const joining = dateFrom(now, -seed.joinedDaysAgo)
    const expectedEnd = dateFrom(joining, seed.weeks * 7)
    const ended = seed.status === 'COMPLETED' ? expectedEnd : null
    const managerId = seed.manager ? userIds[seed.manager] : null
    const mentorId = seed.mentor ? userIds[seed.mentor] : null
    const data = {
      organization_id: orgId,
      user_id: userIds[seed.key],
      employee_code: seed.code,
      status: seed.status,
      joining_date: joining,
      expected_end_date: expectedEnd,
      actual_end_date: ended,
      department_id: ref.departmentIds[seed.department],
      team_id: teamIds[seed.team],
      position_id: ref.positionIds[seed.position],
      manager_id: managerId,
      mentor_id: mentorId,
      deleted_at: null,
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
      actual_end_date: ended,
      status:
        seed.status === 'SELECTED' || seed.status === 'ONBOARDING'
          ? ('PLANNED' as const)
          : seed.status === 'COMPLETED'
            ? ('COMPLETED' as const)
            : ('ACTIVE' as const),
      work_mode: seed.key === 'zara' ? ('ONSITE' as const) : ('HYBRID' as const),
      location: 'Bengaluru',
      manager_id: managerId,
      mentor_id: mentorId,
    }
    await prisma.internship.upsert({
      where: { id: internshipId },
      update: internshipData,
      create: { id: internshipId, ...internshipData },
    })
    internshipIds[seed.key] = internshipId

    // Onboarding: regenerate each run so relative due dates stay realistic.
    await prisma.onboardingItem.deleteMany({ where: { internship_id: internshipId } })
    await prisma.onboarding.deleteMany({ where: { internship_id: internshipId } })
    await prisma.documentAcknowledgement.deleteMany({ where: { user_id: userIds[seed.key] } })
    if (seed.template) {
      const templateId = ref.templateIds[seed.template]
      const template = await prisma.onboardingTemplate.findUniqueOrThrow({
        where: { id: templateId },
        select: { name: true, items: { orderBy: { sort_order: 'asc' } } },
      })
      const complete = seed.done === null
      const onboarding = await prisma.onboarding.create({
        data: {
          id: seedId(`onboarding:${seed.key}`),
          organization_id: orgId,
          internship_id: internshipId,
          template_id: templateId,
          template_name: template.name,
          started_at: daysFrom(joining, -3),
          completed_at: complete ? daysFrom(joining, 6) : null,
          created_by: userIds.hr,
        },
      })
      const assigneeFor = (role: string, fixed: string | null) =>
        role === 'INTERN' ? userIds[seed.key] : role === 'MANAGER' ? managerId : role === 'MENTOR' ? mentorId : fixed
      for (const [index, item] of template.items.entries()) {
        const done = seed.done === null || seed.done.includes(index)
        const assignee = assigneeFor(item.assigned_role, item.assigned_user_id)
        const due = dateFrom(joining, item.due_days_after_start)
        await prisma.onboardingItem.create({
          data: {
            id: seedId(`onboarding-item:${seed.key}:${index}`),
            organization_id: orgId,
            internship_id: internshipId,
            onboarding_id: onboarding.id,
            template_item_id: item.id,
            title: item.title,
            description: item.description,
            item_type: item.category,
            required: item.required,
            due_date: due,
            assigned_role: item.assigned_role,
            assigned_to: assignee,
            required_document_type: item.required_document_type,
            policy_id: item.policy_id,
            status: done ? 'COMPLETED' : 'PENDING',
            completed_at: done ? daysFrom(due, 0) : null,
            completed_by: done ? assignee : null,
            sort_order: index,
          },
        })
        if (done && item.policy_id) {
          const policy = await prisma.policy.findUniqueOrThrow({
            where: { id: item.policy_id },
            select: { version: true },
          })
          await prisma.documentAcknowledgement.create({
            data: {
              organization_id: orgId,
              user_id: userIds[seed.key],
              policy_id: item.policy_id,
              policy_version: policy.version,
              acknowledged_at: daysFrom(due, 0),
            },
          })
        }
      }
    }

    // Lifecycle timeline (deterministic keys, refreshed each run).
    const events: {
      type: 'CREATED' | 'ONBOARDING_STARTED' | 'ONBOARDING_COMPLETED' | 'STATUS_CHANGED'
      at: Date
      text: string
      meta?: object
    }[] = [{ type: 'CREATED', at: daysFrom(joining, -10), text: 'Intern created' }]
    if (seed.template)
      events.push({
        type: 'ONBOARDING_STARTED',
        at: daysFrom(joining, -3),
        text: `Onboarding started (${seed.template})`,
      })
    if (seed.template && seed.done === null) {
      events.push({
        type: 'ONBOARDING_COMPLETED',
        at: daysFrom(joining, 6),
        text: 'All required onboarding items are complete',
      })
      events.push({
        type: 'STATUS_CHANGED',
        at: daysFrom(joining, 7),
        text: 'Onboarding → Active',
        meta: { from: 'ONBOARDING', to: 'ACTIVE' },
      })
    }
    if (seed.status === 'ENDING_SOON') {
      events.push({
        type: 'STATUS_CHANGED',
        at: daysFrom(expectedEnd, -14),
        text: 'Active → Ending soon',
        meta: { from: 'ACTIVE', to: 'ENDING_SOON', automated: true },
      })
    }
    if (seed.status === 'COMPLETED') {
      events.push({
        type: 'STATUS_CHANGED',
        at: daysFrom(expectedEnd, 0),
        text: 'Active → Completed',
        meta: { from: 'ACTIVE', to: 'COMPLETED' },
      })
    }
    await prisma.internLifecycleEvent.deleteMany({
      where: { intern_id: intern.id, idempotency_key: { startsWith: 'seed:' } },
    })
    for (const [index, event] of events.entries()) {
      await prisma.internLifecycleEvent.create({
        data: {
          organization_id: orgId,
          intern_id: intern.id,
          event_type: event.type,
          description: event.text,
          actor_user_id:
            event.type === 'STATUS_CHANGED' && (event.meta as { automated?: boolean })?.automated ? null : userIds.hr,
          metadata: { source: 'seed', ...(event.meta ?? {}) },
          idempotency_key: `seed:${seed.key}:${index}`,
          created_at: event.at,
        },
      })
    }
  }

  // Next generated code continues after the highest existing one (AYV-INT-0008 on a fresh database).
  // Never move the counter backwards: re-seeding a database that already has created interns must not
  // hand out codes that are taken.
  const codes = await prisma.intern.findMany({
    where: { organization_id: orgId, employee_code: { startsWith: 'AYV-INT-' } },
    select: { employee_code: true },
  })
  const highest = codes.reduce((max, row) => Math.max(max, Number(row.employee_code.slice(8)) || 0), 0)
  await prisma.$executeRaw`
    INSERT INTO "code_counters" ("organization_id", "key", "value", "updated_at")
    VALUES (${orgId}::uuid, 'intern.employee_code', ${highest}, now())
    ON CONFLICT ("organization_id", "key")
    DO UPDATE SET "value" = GREATEST("code_counters"."value", EXCLUDED."value"), "updated_at" = now()`

  const profileSeeds: Record<string, { institution: string; field: string; bio: string }> = {
    intern: {
      institution: 'Demo Institute of Technology',
      field: 'Computer Science',
      bio: 'Front-end developer interested in design systems and accessibility.',
    },
    ishaan: {
      institution: 'Demo College of Commerce',
      field: 'Marketing',
      bio: 'Loves short-form video and community building.',
    },
    zara: {
      institution: 'Demo School of Design',
      field: 'Communication Design',
      bio: 'Illustrator and brand identity enthusiast.',
    },
    neel: { institution: 'Demo Institute of Technology', field: 'Data Science', bio: 'Exploring applied NLP.' },
  }
  for (const [key, profile] of Object.entries(profileSeeds)) {
    await prisma.internProfile.upsert({
      where: { intern_id: internIds[key] },
      update: {},
      create: {
        intern_id: internIds[key],
        city: 'Bengaluru',
        state: 'Karnataka',
        country: 'India',
        education_level: 'Undergraduate',
        institution: profile.institution,
        field_of_study: profile.field,
        graduation_year: now.getUTCFullYear() + 1,
        bio: profile.bio,
      },
    })
  }
  const contactId = seedId('emergency:intern')
  await prisma.emergencyContact.upsert({
    where: { id: contactId },
    update: {},
    create: {
      id: contactId,
      intern_id: internIds.intern,
      name: 'Ravi Sharma',
      relationship: 'Parent',
      phone: '+91 90000 00001',
    },
  })

  // ── Projects, milestones, tasks, submissions (prisma/seed/work.ts) ────────
  const { projectIds } = await seedWork(prisma, orgId, userIds, now)

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
    // Phase 06: lessons live in modules; the demo courses keep one module each.
    const moduleId = seedId(`module:${course.key}:0`)
    const moduleData = { course_id: record.id, title: 'Module 1', position: 0 }
    const existingModule = await prisma.courseModule.findFirst({ where: { course_id: record.id }, orderBy: { position: 'asc' } })
    const module = existingModule ?? (await prisma.courseModule.create({ data: { id: moduleId, ...moduleData } }))
    for (const [index, [title, minutes]] of course.lessons.entries()) {
      const id = seedId(`lesson:${course.key}:${index}`)
      const data = { course_id: record.id, module_id: module.id, title, sort_order: index, estimated_minutes: minutes }
      await prisma.lesson.upsert({ where: { id }, update: data, create: { id, ...data } })
    }
  }
  const quizId = seedId('quiz:orientation:0')
  await prisma.quiz.upsert({
    where: { id: quizId },
    update: {},
    create: {
      id: quizId,
      course_id: seedId('course:orientation'),
      lesson_id: seedId('lesson:orientation:1'),
      title: 'Planning and review check',
      passing_score: 70,
    },
  })

  // ── Communication ─────────────────────────────────────────────────────────
  const announcementId = seedId('announcement:welcome')

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
    { key: 'neel', actor: 'hr', action: 'intern.status_changed', type: 'intern', id: internIds.intern, hoursAgo: 48 },
    {
      key: 'welcome',
      actor: 'hr',
      action: 'announcement.published',
      type: 'announcement',
      id: announcementId,
      hoursAgo: 24,
    },
  ]
  // Phase 01 entries replaced by project activity in prisma/seed/work.ts.
  await prisma.auditLog.deleteMany({ where: { id: { in: [seedId('audit:hero'), seedId('audit:report')] } } })
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

  // ── HR operations (prisma/seed/hr.ts) — also seeds the announcements ─────
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { timezone: true } })
  const hr = await seedHr(prisma, {
    organizationId: orgId,
    timeZone: org.timezone,
    userIds,
    internIds,
    internshipIds,
    departmentIds: ref.departmentIds,
    leaveTypeIds: ref.leaveTypeIds,
    now,
  })

  return { userIds, accounts: DEV_ACCOUNTS, hr }
}

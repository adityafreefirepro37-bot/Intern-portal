import type {
  DocumentType,
  InternStatus,
  LifecycleEventType,
  OnboardingAssigneeRole,
  OnboardingItemStatus,
  OnboardingItemType,
  PrismaClient,
} from '@prisma/client'
import { dateFrom, daysFrom, seedId } from './ids'

/**
 * DEVELOPMENT / DEMO DATA — onboarding templates, policies, per-intern
 * checklists and lifecycle history. Never run in production (organizations
 * write their own handbook and templates).
 *
 * Checklists are generated the same way onboardingService.generateOnboarding
 * does it (a snapshot of the template, due dates from the start date), then
 * given a realistic state for each demo intern.
 */

interface PolicySeed {
  key: string
  slug: string
  title: string
  body: string
}

const POLICIES: PolicySeed[] = [
  {
    key: 'handbook',
    slug: 'intern-handbook',
    title: 'Ayava Creatives Intern Handbook',
    body: [
      'Welcome to Ayava Creatives. This handbook explains how we work together during your internship.',
      'Working hours: our core hours are 10:00–17:00 IST, Monday to Friday. Tell your manager in advance if you need to be away.',
      'Communication: use the team channels for work conversations and keep client information inside company tools.',
      'Feedback: you will have a weekly check-in with your mentor and a mid-internship review with your manager.',
      'Conduct: treat colleagues and clients with respect. Report any concern to HR — reports are handled confidentially.',
    ].join('\n\n'),
  },
  {
    key: 'nda',
    slug: 'confidentiality-agreement',
    title: 'Confidentiality and Non-Disclosure Agreement',
    body: [
      'During and after your internship you will keep confidential all non-public information about Ayava Creatives, its clients and their projects.',
      'You will not share client work, credentials, designs, code or data outside the company without written permission.',
      'Work you create during the internship belongs to Ayava Creatives or its clients, as agreed in the relevant contract.',
    ].join('\n\n'),
  },
  {
    key: 'security',
    slug: 'information-security',
    title: 'Information Security Essentials',
    body: [
      'Use a password manager and enable two-factor authentication on every work account.',
      'Lock your screen when you step away. Never share passwords, even with colleagues.',
      'Report lost devices, suspicious emails and possible data leaks to your manager immediately.',
    ].join('\n\n'),
  },
]

interface ItemSeed {
  title: string
  description?: string
  category: OnboardingItemType
  required?: boolean
  due: number
  role?: OnboardingAssigneeRole
  document?: DocumentType
  policy?: string
}

/** Items every template starts with. */
const CORE_ITEMS: ItemSeed[] = [
  {
    title: 'Upload your résumé',
    category: 'DOCUMENT',
    document: 'RESUME',
    due: 0,
    description: 'PDF or Word, up to 10 MB.',
  },
  {
    title: 'Upload a government-issued ID',
    category: 'DOCUMENT',
    document: 'ID_DOCUMENT',
    due: 2,
    description: 'Visible to HR only.',
  },
  { title: 'Accept the confidentiality agreement (NDA)', category: 'ACKNOWLEDGEMENT', policy: 'nda', due: 0 },
  { title: 'Read the Intern Handbook', category: 'ACKNOWLEDGEMENT', policy: 'handbook', due: 1 },
  { title: 'Complete the security orientation', category: 'ACKNOWLEDGEMENT', policy: 'security', due: 2 },
  {
    title: 'Meet your manager',
    category: 'MEETING',
    role: 'MANAGER',
    due: 1,
    description: 'Agree goals and working rhythm for the internship.',
  },
  {
    title: 'Meet your mentor',
    category: 'MEETING',
    role: 'MENTOR',
    due: 2,
    description: 'Set up your weekly check-in.',
  },
  {
    title: 'Attend company orientation',
    category: 'MEETING',
    role: 'HR',
    due: 3,
    description: 'HR walks new interns through the company, tools and policies.',
  },
  { title: 'Complete your first learning module', category: 'TRAINING', due: 5 },
  { title: 'Complete your first task', category: 'TASK', due: 7 },
  { title: 'Add a short bio to your profile', category: 'FORM', required: false, due: 5 },
]

interface TemplateSeed {
  key: string
  name: string
  description: string
  department: string | null
  isDefault?: boolean
  extra: ItemSeed[]
}

const TEMPLATES: TemplateSeed[] = [
  {
    key: 'general',
    name: 'General Intern Onboarding',
    description: 'The standard first week for every intern.',
    department: null,
    isDefault: true,
    extra: [],
  },
  {
    key: 'marketing',
    name: 'Marketing Intern Onboarding',
    description: 'Standard onboarding plus brand voice and social tooling.',
    department: 'marketing',
    extra: [
      { title: 'Get access to the social scheduling tools', category: 'CHECKLIST', role: 'MANAGER', due: 1 },
      { title: 'Study the Ayava brand voice guide', category: 'TRAINING', due: 4 },
      { title: 'Draft a one-week content calendar', category: 'TASK', required: false, due: 10 },
    ],
  },
  {
    key: 'design',
    name: 'Design Intern Onboarding',
    description: 'Standard onboarding plus design tools and the design system.',
    department: 'design',
    extra: [
      { title: 'Install design tools and brand fonts', category: 'CHECKLIST', due: 1 },
      { title: 'Review the Ayava design system', category: 'TRAINING', due: 4 },
      { title: 'Portfolio walkthrough with your mentor', category: 'MEETING', role: 'MENTOR', required: false, due: 6 },
    ],
  },
  {
    key: 'development',
    name: 'Development Intern Onboarding',
    description: 'Standard onboarding plus development environment and code review.',
    department: 'development',
    extra: [
      {
        title: 'Set up your development environment',
        category: 'CHECKLIST',
        due: 1,
        description: 'Repository access, editor, Node.js and the local database.',
      },
      { title: 'Read the engineering handbook', category: 'TRAINING', due: 3 },
      { title: 'Open your first pull request', category: 'TASK', due: 7 },
    ],
  },
]

export interface OnboardingSeedIntern {
  key: string
  status: InternStatus
  department: string
  internId: string
  internshipId: string
  joiningDate: Date
  managerKey: string
  mentorKey: string
}

type ItemState = { status: OnboardingItemStatus; blockedReason?: string }

/**
 * Checklist state per demo intern:
 *  - neel (ONBOARDING): part-way — policies accepted, résumé overdue, one item blocked.
 *  - kabir (SELECTED): no onboarding yet (HR starts it).
 *  - everyone else: onboarding finished (optional items may be left open).
 */
function stateFor(intern: OnboardingSeedIntern, item: ItemSeed): ItemState {
  if (intern.key !== 'neel') {
    return { status: item.required === false && intern.key === 'diya' ? 'PENDING' : 'COMPLETED' }
  }
  if (item.category === 'ACKNOWLEDGEMENT' && item.policy !== 'security') return { status: 'COMPLETED' }
  if (item.role === 'MANAGER' && item.category === 'MEETING') return { status: 'COMPLETED' }
  if (item.category === 'CHECKLIST') return { status: 'BLOCKED', blockedReason: 'Waiting for the laptop to arrive' }
  if (item.category === 'TRAINING' && item.due <= 3) return { status: 'IN_PROGRESS' }
  return { status: 'PENDING' }
}

export async function seedOnboarding(
  prisma: PrismaClient,
  input: {
    organizationId: string
    departmentIds: Record<string, string>
    userIds: Record<string, string>
    interns: OnboardingSeedIntern[]
    now: Date
  },
) {
  const { organizationId: orgId, userIds, now } = input

  // ── Policies (versioned; acknowledgements reference a version) ──
  const policyIds: Record<string, { id: string; version: number }> = {}
  for (const policy of POLICIES) {
    const record = await prisma.policy.upsert({
      where: { organization_id_slug_version: { organization_id: orgId, slug: policy.slug, version: 1 } },
      update: { title: policy.title, body: policy.body, is_active: true },
      create: {
        id: seedId(`policy:${policy.key}`),
        organization_id: orgId,
        slug: policy.slug,
        title: policy.title,
        version: 1,
        body: policy.body,
        created_by: userIds.hr,
      },
      select: { id: true, version: true },
    })
    policyIds[policy.key] = record
  }

  // ── Templates and their items ──
  const templates: Record<string, { id: string; name: string; items: (ItemSeed & { id: string })[] }> = {}
  for (const template of TEMPLATES) {
    const record = await prisma.onboardingTemplate.upsert({
      where: { organization_id_name: { organization_id: orgId, name: template.name } },
      update: {
        description: template.description,
        is_active: true,
        is_default: Boolean(template.isDefault),
        deleted_at: null,
      },
      create: {
        id: seedId(`template:${template.key}`),
        organization_id: orgId,
        name: template.name,
        description: template.description,
        department_id: template.department ? input.departmentIds[template.department] : null,
        is_default: Boolean(template.isDefault),
        created_by: userIds.hr,
      },
      select: { id: true, name: true },
    })
    const items = [...CORE_ITEMS, ...template.extra].map((item, index) => ({
      ...item,
      id: seedId(`template-item:${template.key}:${index}`),
    }))
    await prisma.onboardingTemplateItem.deleteMany({
      where: { template_id: record.id, id: { notIn: items.map((i) => i.id) } },
    })
    for (const [index, item] of items.entries()) {
      const data = {
        template_id: record.id,
        title: item.title,
        description: item.description ?? null,
        category: item.category,
        required: item.required ?? true,
        due_days_after_start: item.due,
        assigned_role: item.role ?? 'INTERN',
        assigned_user_id: item.role === 'HR' ? userIds.hr : null,
        required_document_type: item.document ?? null,
        policy_id: item.policy ? policyIds[item.policy].id : null,
        sort_order: index,
      }
      await prisma.onboardingTemplateItem.upsert({
        where: { id: item.id },
        update: data,
        create: { id: item.id, ...data },
      })
    }
    templates[template.key] = { id: record.id, name: record.name, items }
  }

  // ── Per-intern checklists (regenerated on every seed run) ──
  for (const intern of input.interns) {
    await prisma.onboarding.deleteMany({ where: { internship_id: intern.internshipId } })
    // Loose items from the Phase 01 seed (before onboardings existed).
    await prisma.onboardingItem.deleteMany({ where: { internship_id: intern.internshipId, onboarding_id: null } })
    if (intern.status === 'SELECTED') continue

    const template = templates[intern.department] ?? templates.general
    const internUserId = userIds[intern.key]
    const states = template.items.map((item) => stateFor(intern, item))
    const allRequiredDone = template.items.every(
      (item, i) => item.required === false || states[i].status === 'COMPLETED',
    )
    const startedAt = daysFrom(intern.joiningDate, -3, 9)
    const onboarding = await prisma.onboarding.create({
      data: {
        id: seedId(`onboarding:${intern.key}`),
        organization_id: orgId,
        internship_id: intern.internshipId,
        template_id: template.id,
        template_name: template.name,
        started_at: startedAt,
        completed_at: allRequiredDone ? daysFrom(intern.joiningDate, 7) : null,
        created_by: userIds.hr,
      },
      select: { id: true },
    })

    for (const [index, item] of template.items.entries()) {
      const role = item.role ?? 'INTERN'
      const assignee =
        role === 'INTERN'
          ? internUserId
          : role === 'MANAGER'
            ? userIds[intern.managerKey]
            : role === 'MENTOR'
              ? userIds[intern.mentorKey]
              : userIds.hr
      const state = states[index]
      const completed = state.status === 'COMPLETED'
      const dueDate = dateFrom(intern.joiningDate, item.due)
      await prisma.onboardingItem.create({
        data: {
          id: seedId(`onboarding-item:${intern.key}:${index}`),
          organization_id: orgId,
          internship_id: intern.internshipId,
          onboarding_id: onboarding.id,
          template_item_id: item.id,
          title: item.title,
          description: item.description ?? null,
          item_type: item.category,
          required: item.required ?? true,
          status: state.status,
          blocked_reason: state.blockedReason ?? null,
          due_date: dueDate,
          assigned_role: role,
          assigned_to: assignee,
          required_document_type: item.document ?? null,
          policy_id: item.policy ? policyIds[item.policy].id : null,
          completed_at: completed ? daysFrom(dueDate, 0, 11) : null,
          completed_by: completed ? assignee : null,
          sort_order: index,
        },
      })
      if (completed && item.policy) {
        const policy = policyIds[item.policy]
        await prisma.documentAcknowledgement.upsert({
          where: {
            user_id_policy_id_policy_version: {
              user_id: internUserId,
              policy_id: policy.id,
              policy_version: policy.version,
            },
          },
          update: {},
          create: {
            organization_id: orgId,
            user_id: internUserId,
            policy_id: policy.id,
            policy_version: policy.version,
            acknowledged_at: daysFrom(dueDate, 0, 11),
          },
        })
      }
    }
  }

  // ── Lifecycle history (idempotent: keyed per intern and step) ──
  const events: {
    key: string
    internId: string
    type: LifecycleEventType
    description: string
    at: Date
    metadata?: Record<string, string>
  }[] = []
  for (const intern of input.interns) {
    const add = (
      step: string,
      type: LifecycleEventType,
      description: string,
      at: Date,
      metadata?: Record<string, string>,
    ) => events.push({ key: `seed:${intern.key}:${step}`, internId: intern.internId, type, description, at, metadata })
    add('created', 'CREATED', 'Intern created', daysFrom(intern.joiningDate, -14, 6))
    add('manager', 'MANAGER_ASSIGNED', 'Manager assigned', daysFrom(intern.joiningDate, -14, 7))
    add('mentor', 'MENTOR_ASSIGNED', 'Mentor assigned', daysFrom(intern.joiningDate, -14, 7))
    add('invited', 'INVITATION_SENT', 'Invitation to Intern OS created', daysFrom(intern.joiningDate, -14, 8))
    if (intern.status === 'SELECTED') continue
    add('invite-accepted', 'INVITATION_ACCEPTED', 'Invitation accepted', daysFrom(intern.joiningDate, -12, 10))
    add('onboarding', 'ONBOARDING_STARTED', 'Onboarding started', daysFrom(intern.joiningDate, -3, 9))
    add('status-onboarding', 'STATUS_CHANGED', 'Selected → Onboarding', daysFrom(intern.joiningDate, -3, 9), {
      from: 'SELECTED',
      to: 'ONBOARDING',
    })
    if (intern.status === 'ONBOARDING') continue
    add(
      'onboarding-done',
      'ONBOARDING_COMPLETED',
      'All required onboarding items are complete',
      daysFrom(intern.joiningDate, 7),
    )
    add('status-active', 'STATUS_CHANGED', 'Onboarding → Active', daysFrom(intern.joiningDate, 7, 13), {
      from: 'ONBOARDING',
      to: 'ACTIVE',
    })
    if (intern.status === 'ENDING_SOON') {
      add('status-ending', 'STATUS_CHANGED', 'Active → Ending soon', daysFrom(now, -9, 1), {
        from: 'ACTIVE',
        to: 'ENDING_SOON',
      })
    }
    if (intern.status === 'COMPLETED') {
      add('status-completed', 'STATUS_CHANGED', 'Active → Completed', daysFrom(now, -17, 12), {
        from: 'ACTIVE',
        to: 'COMPLETED',
      })
    }
  }
  await prisma.internLifecycleEvent.createMany({
    data: events.map((event) => ({
      id: seedId(`lifecycle:${event.key}`),
      organization_id: orgId,
      intern_id: event.internId,
      event_type: event.type,
      description: event.description,
      actor_user_id: userIds.hr,
      metadata: event.metadata,
      idempotency_key: event.key,
      created_at: event.at,
    })),
    skipDuplicates: true,
  })
}

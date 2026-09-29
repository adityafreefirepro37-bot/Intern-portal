import type { DocumentType, OnboardingAssigneeRole, OnboardingItemType, PrismaClient } from '@prisma/client'

/**
 * Onboarding reference data: policies and the four standard templates.
 * Runs in every environment. Existing templates are never overwritten, so
 * HR's edits survive re-seeding; missing ones are created.
 */

const HANDBOOK = `Welcome to Ayava Creatives.

1. Working hours. Core hours are 10:00–17:00 IST, Monday to Friday. Tell your manager in advance if you can't make it.
2. Communication. Use the Intern OS for tasks, leave and announcements. Reply to your manager and mentor within one working day.
3. Work quality. Submit work through tasks so it can be reviewed. Ask early when you're blocked.
4. Confidentiality. Client work, briefs and unreleased material stay inside Ayava. See the NDA for details.
5. Respect. We expect courtesy, inclusion and professional conduct from everyone, online and offline.
6. Tools and accounts. Your accounts are personal; never share passwords. Report lost devices or suspicious messages to HR immediately.
7. Leave and attendance. Request leave in the Intern OS before taking it, except in emergencies.
8. Completion. Certificates and experience letters are issued after your internship is marked complete.`

const NDA = `Non-disclosure agreement (summary for interns)

By acknowledging, you agree that:
- Information about Ayava Creatives, its clients and their projects that is not public is confidential.
- You will use confidential information only to perform your internship work.
- You will not share, publish or copy confidential information outside Ayava without written permission, during or after your internship.
- Work you create during the internship for Ayava or its clients belongs to Ayava or the client, as agreed in your offer letter.
- On completion you will return or delete confidential material in your possession.

The signed NDA document uploaded during onboarding is the binding version.`

export const POLICY_SEEDS = [
  { slug: 'intern-handbook', title: 'Intern Handbook', version: 1, body: HANDBOOK },
  { slug: 'nda', title: 'Non-Disclosure Agreement', version: 1, body: NDA },
] as const

interface ItemSeed {
  title: string
  description?: string
  category: OnboardingItemType
  required?: boolean
  due: number
  role?: OnboardingAssigneeRole
  document?: DocumentType
  policy?: (typeof POLICY_SEEDS)[number]['slug']
}

const GENERAL_ITEMS: ItemSeed[] = [
  { title: 'Upload your signed offer letter', category: 'DOCUMENT', due: -2, document: 'OFFER_LETTER' },
  { title: 'Upload your signed NDA', category: 'DOCUMENT', due: -1, document: 'NDA' },
  {
    title: 'Upload a government ID',
    description: 'Visible to HR only.',
    category: 'DOCUMENT',
    due: 0,
    document: 'ID_DOCUMENT',
  },
  { title: 'Read and acknowledge the Intern Handbook', category: 'ACKNOWLEDGEMENT', due: 0, policy: 'intern-handbook' },
  { title: 'Acknowledge the NDA', category: 'ACKNOWLEDGEMENT', due: 0, policy: 'nda' },
  { title: 'Fill in your profile and emergency contact', category: 'FORM', due: 1 },
  { title: 'Set up workspace accounts (email, chat, drive)', category: 'ACCOUNT_SETUP', due: 1 },
  { title: 'Welcome meeting with your manager', category: 'MEETING', due: 1, role: 'MANAGER' },
  { title: 'Intro call with your mentor', category: 'MEETING', due: 2, role: 'MENTOR' },
  { title: 'Complete the Ayava Orientation course', category: 'TRAINING', due: 5 },
  { title: 'Upload your résumé', category: 'DOCUMENT', required: false, due: 3, document: 'RESUME' },
]

const TEMPLATE_SEEDS: {
  name: string
  description: string
  isDefault?: boolean
  department?: string
  extra: ItemSeed[]
}[] = [
  {
    name: 'General Intern Onboarding',
    description: 'The standard checklist for every new intern.',
    isDefault: true,
    extra: [{ title: 'Complete your first starter task', category: 'TASK', due: 7 }],
  },
  {
    name: 'Marketing Intern Onboarding',
    description: 'General onboarding plus marketing tools and brand voice.',
    department: 'marketing',
    extra: [
      {
        title: 'Get access to social scheduling and analytics tools',
        category: 'ACCOUNT_SETUP',
        due: 2,
        role: 'MANAGER',
      },
      { title: 'Review the Ayava brand voice guide', category: 'TRAINING', due: 3 },
      { title: 'Complete Digital Marketing Fundamentals', category: 'TRAINING', required: false, due: 10 },
      { title: 'Draft your first week of posts', category: 'TASK', due: 7 },
    ],
  },
  {
    name: 'Design Intern Onboarding',
    description: 'General onboarding plus design tools, files and critique rituals.',
    department: 'design',
    extra: [
      { title: 'Get access to design tools and shared libraries', category: 'ACCOUNT_SETUP', due: 2, role: 'MENTOR' },
      { title: 'Walk through the brand design system with your mentor', category: 'MEETING', due: 3, role: 'MENTOR' },
      { title: 'Share a portfolio link', category: 'FORM', required: false, due: 3 },
      { title: 'Complete a design warm-up exercise', category: 'TASK', due: 7 },
    ],
  },
  {
    name: 'Development Intern Onboarding',
    description: 'General onboarding plus repository access and engineering practices.',
    department: 'development',
    extra: [
      { title: 'Get repository and deployment access', category: 'ACCOUNT_SETUP', due: 1, role: 'MANAGER' },
      { title: 'Set up the local development environment', category: 'CHECKLIST', due: 2 },
      { title: 'Code review walkthrough with your mentor', category: 'MEETING', due: 3, role: 'MENTOR' },
      { title: 'Ship your first starter pull request', category: 'TASK', due: 7 },
    ],
  },
]

export async function seedOnboardingReference(
  prisma: PrismaClient,
  ref: { organizationId: string; departmentIds: Record<string, string> },
) {
  const orgId = ref.organizationId
  const policyIds: Record<string, string> = {}
  for (const policy of POLICY_SEEDS) {
    const record = await prisma.policy.upsert({
      where: { organization_id_slug_version: { organization_id: orgId, slug: policy.slug, version: policy.version } },
      update: {},
      create: { organization_id: orgId, ...policy },
    })
    policyIds[policy.slug] = record.id
  }

  const templateIds: Record<string, string> = {}
  for (const template of TEMPLATE_SEEDS) {
    const existing = await prisma.onboardingTemplate.findUnique({
      where: { organization_id_name: { organization_id: orgId, name: template.name } },
      select: { id: true },
    })
    if (existing) {
      templateIds[template.name] = existing.id
      continue
    }
    const items = [...GENERAL_ITEMS, ...template.extra]
    const created = await prisma.onboardingTemplate.create({
      data: {
        organization_id: orgId,
        name: template.name,
        description: template.description,
        is_default: template.isDefault ?? false,
        department_id: template.department ? ref.departmentIds[template.department] : null,
        items: {
          create: items.map((item, index) => ({
            title: item.title,
            description: item.description ?? null,
            category: item.category,
            required: item.required ?? true,
            due_days_after_start: item.due,
            assigned_role: item.role ?? 'INTERN',
            required_document_type: item.document ?? null,
            policy_id: item.policy ? policyIds[item.policy] : null,
            sort_order: index,
          })),
        },
      },
      select: { id: true },
    })
    templateIds[template.name] = created.id
  }
  return { policyIds, templateIds }
}

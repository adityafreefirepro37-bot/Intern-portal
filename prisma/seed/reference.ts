import type { PrismaClient } from '@prisma/client'
import {
  DEFAULT_ROLE_GRANTS,
  PERMISSION_DEFINITIONS,
  SYSTEM_ROLES,
  type PermissionScope,
  type SystemRoleSlug,
} from '../../src/lib/permissions/catalog'
import { seedOnboardingReference } from './onboarding'
import { AYAVA_ORGANIZATION_ID } from './ids'

/**
 * Reference data required in every environment: the organization, the
 * permission catalog, system roles and their grants, departments, positions,
 * leave types and default settings. Idempotent.
 */
export async function seedReference(prisma: PrismaClient) {
  const organization = await prisma.organization.upsert({
    where: { slug: 'ayava-creatives' },
    update: {},
    create: {
      id: AYAVA_ORGANIZATION_ID,
      name: 'Ayava Creatives',
      slug: 'ayava-creatives',
      website_url: 'https://ayavacreatives.com',
      description: 'Creative agency for brand, design, marketing and digital products.',
      timezone: 'Asia/Kolkata',
    },
  })
  const orgId = organization.id

  // Permission catalog (global). Permissions no longer in the catalog are
  // removed (their grants cascade), so renamed permissions don't linger.
  for (const definition of PERMISSION_DEFINITIONS) {
    await prisma.permission.upsert({
      where: { resource_action: { resource: definition.resource, action: definition.action } },
      update: { description: definition.description },
      create: { resource: definition.resource, action: definition.action, description: definition.description },
    })
  }
  const catalogKeys = new Set<string>(PERMISSION_DEFINITIONS.map((definition) => definition.key))
  const existing = await prisma.permission.findMany({ select: { id: true, resource: true, action: true } })
  const stale = existing.filter((p) => !catalogKeys.has(`${p.resource}.${p.action}`)).map((p) => p.id)
  if (stale.length) await prisma.permission.deleteMany({ where: { id: { in: stale } } })
  const permissions = existing.filter((p) => !stale.includes(p.id))
  const permissionIdByKey = new Map(permissions.map((p) => [`${p.resource}.${p.action}`, p.id]))

  // System roles, ranks and their default grants (with scopes). Grants are
  // synced so the catalog stays the source of truth for system roles.
  const roleIds = {} as Record<SystemRoleSlug, string>
  for (const [slug, role] of Object.entries(SYSTEM_ROLES) as [
    SystemRoleSlug,
    (typeof SYSTEM_ROLES)[SystemRoleSlug],
  ][]) {
    const record = await prisma.role.upsert({
      where: { organization_id_slug: { organization_id: orgId, slug } },
      update: { name: role.name, description: role.description, rank: role.rank, is_system_role: true },
      create: {
        organization_id: orgId,
        slug,
        name: role.name,
        description: role.description,
        rank: role.rank,
        is_system_role: true,
      },
    })
    roleIds[slug] = record.id

    const grants = Object.entries(DEFAULT_ROLE_GRANTS[slug]) as [string, PermissionScope][]
    const wanted = grants.map(([key, scope]) => {
      const id = permissionIdByKey.get(key)
      if (!id) throw new Error(`Permission ${key} missing from catalog`)
      return { permission_id: id, scope }
    })
    await prisma.rolePermission.deleteMany({
      where: { role_id: record.id, permission_id: { notIn: wanted.map((grant) => grant.permission_id) } },
    })
    for (const grant of wanted) {
      await prisma.rolePermission.upsert({
        where: { role_id_permission_id: { role_id: record.id, permission_id: grant.permission_id } },
        update: { scope: grant.scope },
        create: { role_id: record.id, permission_id: grant.permission_id, scope: grant.scope },
      })
    }
  }

  const departmentSeeds = [
    { slug: 'marketing', name: 'Marketing', description: 'Campaigns, social media and growth.' },
    { slug: 'design', name: 'Design', description: 'Brand identity, visual and product design.' },
    { slug: 'development', name: 'Development', description: 'Websites, applications and AI/ML.' },
    { slug: 'hr', name: 'HR', description: 'People operations and the internship programme.' },
    { slug: 'operations', name: 'Operations', description: 'Delivery, finance and administration.' },
  ]
  const departmentIds: Record<string, string> = {}
  for (const department of departmentSeeds) {
    const record = await prisma.department.upsert({
      where: { organization_id_slug: { organization_id: orgId, slug: department.slug } },
      update: {},
      create: { organization_id: orgId, ...department },
    })
    departmentIds[department.slug] = record.id
  }

  const positionSeeds = [
    { slug: 'digital-marketing-intern', title: 'Digital Marketing Intern', department: 'marketing' },
    { slug: 'social-media-intern', title: 'Social Media Intern', department: 'marketing' },
    { slug: 'content-writing-intern', title: 'Content Writing Intern', department: 'marketing' },
    { slug: 'graphic-design-intern', title: 'Graphic Design Intern', department: 'design' },
    { slug: 'ui-ux-intern', title: 'UI/UX Intern', department: 'design' },
    { slug: 'web-development-intern', title: 'Web Development Intern', department: 'development' },
    { slug: 'ai-ml-intern', title: 'AI/ML Intern', department: 'development' },
  ]
  const positionIds: Record<string, string> = {}
  for (const position of positionSeeds) {
    const record = await prisma.position.upsert({
      where: { organization_id_slug: { organization_id: orgId, slug: position.slug } },
      update: {},
      create: {
        organization_id: orgId,
        slug: position.slug,
        title: position.title,
        department_id: departmentIds[position.department],
      },
    })
    positionIds[position.slug] = record.id
  }

  // quota_days: allowance per internship (null = unlimited, tracked only). Only applied
  // when a type is first created; HR edits in /hr/settings are never overwritten.
  const leaveTypeSeeds = [
    {
      slug: 'casual',
      name: 'Casual leave',
      description: 'Personal time off.',
      requires_approval: true,
      quota_days: 6,
      sort_order: 1,
    },
    {
      slug: 'sick',
      name: 'Sick leave',
      description: 'Illness or medical appointments.',
      requires_approval: true,
      quota_days: 6,
      sort_order: 2,
    },
    {
      slug: 'academic',
      name: 'Academic leave',
      description: 'Exams and mandatory college work.',
      requires_approval: true,
      requires_attachment: false,
      quota_days: null,
      sort_order: 3,
    },
    {
      slug: 'unpaid',
      name: 'Unpaid leave',
      description: 'Extended time off without stipend.',
      requires_approval: true,
      quota_days: null,
      sort_order: 4,
    },
  ]
  const leaveTypeIds: Record<string, string> = {}
  for (const leaveType of leaveTypeSeeds) {
    const record = await prisma.leaveType.upsert({
      where: { organization_id_slug: { organization_id: orgId, slug: leaveType.slug } },
      update: {},
      create: { organization_id: orgId, ...leaveType },
    })
    leaveTypeIds[leaveType.slug] = record.id
  }

  // Configurable document requirements (HR can change these in /hr/settings).
  const documentTypeSeeds = [
    {
      slug: 'offer-letter',
      name: 'Signed offer letter',
      legacy_type: 'OFFER_LETTER',
      is_required: true,
      default_visibility: 'INTERN',
    },
    { slug: 'nda', name: 'Signed NDA', legacy_type: 'NDA', is_required: true, default_visibility: 'INTERN' },
    {
      slug: 'id-proof',
      name: 'Government ID proof',
      legacy_type: 'ID_DOCUMENT',
      is_required: true,
      is_sensitive: true,
      has_expiry: true,
      default_visibility: 'HR',
    },
    { slug: 'resume', name: 'Résumé / CV', legacy_type: 'RESUME', default_visibility: 'INTERN' },
    {
      slug: 'college-noc',
      name: 'College NOC / letter',
      legacy_type: 'OTHER',
      description: 'No-objection certificate or internship letter from the college.',
      default_visibility: 'HR',
    },
    {
      slug: 'experience-letter',
      name: 'Experience letter',
      legacy_type: 'EXPERIENCE_LETTER',
      default_visibility: 'INTERN',
    },
  ] as const
  for (const [index, type] of documentTypeSeeds.entries()) {
    await prisma.hrDocumentType.upsert({
      where: { organization_id_slug: { organization_id: orgId, slug: type.slug } },
      update: {},
      create: { organization_id: orgId, sort_order: index + 1, ...type },
    })
  }

  // Superseded by attendance.rules (Phase 05).
  await prisma.setting.deleteMany({
    where: { organization_id: orgId, key: { in: ['work_week', 'attendance.late_after'] } },
  })
  const settingSeeds = [
    {
      key: 'attendance.rules',
      value: {
        workStart: '10:00',
        graceMinutes: 15,
        fullDayMinutes: 420,
        halfDayMinutes: 210,
        workingDays: [1, 2, 3, 4, 5],
      },
    },
    { key: 'internship.default_duration_weeks', value: { weeks: 12 } },
    { key: 'internship.ending_soon_days', value: { days: 14 } },
    { key: 'intern.employee_code_prefix', value: { prefix: 'AYV-INT-' } },
  ]
  for (const setting of settingSeeds) {
    await prisma.setting.upsert({
      where: { organization_id_key: { organization_id: orgId, key: setting.key } },
      update: {},
      create: { organization_id: orgId, key: setting.key, value: setting.value },
    })
  }

  const onboarding = await seedOnboardingReference(prisma, { organizationId: orgId, departmentIds })

  return {
    organizationId: orgId,
    policyIds: onboarding.policyIds,
    templateIds: onboarding.templateIds,
    roleIds,
    departmentIds,
    positionIds,
    leaveTypeIds,
    permissionCount: permissions.length,
  }
}

export type ReferenceData = Awaited<ReturnType<typeof seedReference>>

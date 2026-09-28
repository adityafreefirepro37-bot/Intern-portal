import type { DocumentType, OnboardingAssigneeRole, OnboardingItemType } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/db/client'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors'
import { parseInput } from '@/lib/validation'
import type { RequestContext } from '../context'
import { policyRepository } from '../repositories/document.repository'
import { templateRepository } from '../repositories/template.repository'
import { AUDIT_ACTIONS } from './audit-actions'
import { auditService } from './audit.service'
import { authorizationService } from './authorization.service'

export const ONBOARDING_ITEM_TYPES: readonly OnboardingItemType[] = [
  'DOCUMENT',
  'ACKNOWLEDGEMENT',
  'MEETING',
  'TRAINING',
  'FORM',
  'TASK',
  'CHECKLIST',
  'ACCOUNT_SETUP',
  'OTHER',
]
export const ITEM_TYPE_LABELS: Record<OnboardingItemType, string> = {
  DOCUMENT: 'Document',
  ACKNOWLEDGEMENT: 'Policy acknowledgement',
  MEETING: 'Meeting',
  TRAINING: 'Training',
  FORM: 'Form',
  TASK: 'Task',
  CHECKLIST: 'Checklist',
  ACCOUNT_SETUP: 'Account setup',
  OTHER: 'Other',
}
export const ASSIGNEE_ROLES: readonly OnboardingAssigneeRole[] = ['INTERN', 'MANAGER', 'MENTOR', 'HR']

const optionalId = z
  .string()
  .optional()
  .transform((value) => value || undefined)
  .pipe(z.uuid().optional())
const checkbox = z.preprocess((value) => value === true || value === 'on' || value === 'true', z.boolean())

const templateSchema = z.strictObject({
  name: z.string().trim().min(2, 'Enter a name').max(120),
  description: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((value) => value || undefined),
  departmentId: optionalId,
  positionId: optionalId,
  isActive: checkbox.default(true),
  isDefault: checkbox.default(false),
})

const itemSchema = z
  .strictObject({
    title: z.string().trim().min(2, 'Enter a title').max(160),
    description: z
      .string()
      .trim()
      .max(2000)
      .optional()
      .transform((value) => value || undefined),
    category: z.enum(ONBOARDING_ITEM_TYPES as [OnboardingItemType, ...OnboardingItemType[]]),
    required: checkbox.default(false),
    dueDaysAfterStart: z.coerce.number().int().min(-365).max(365).default(0),
    assignedRole: z.enum(ASSIGNEE_ROLES as [OnboardingAssigneeRole, ...OnboardingAssigneeRole[]]).default('INTERN'),
    assignedUserId: optionalId,
    requiredDocumentType: z
      .string()
      .optional()
      .transform((value) => (value || undefined) as DocumentType | undefined)
      .pipe(z.enum(['RESUME', 'OFFER_LETTER', 'NDA', 'ID_DOCUMENT', 'CERTIFICATE', 'EXPERIENCE_LETTER', 'OTHER']).optional()),
    policyId: optionalId,
  })
  .refine((item) => item.category !== 'ACKNOWLEDGEMENT' || item.policyId, {
    message: 'Choose the policy to acknowledge',
    path: ['policyId'],
  })
  .refine((item) => item.assignedRole !== 'HR' || item.assignedUserId, {
    message: 'Choose the HR person responsible',
    path: ['assignedUserId'],
  })

async function assertRefs(ctx: RequestContext, data: { departmentId?: string; positionId?: string }) {
  const org = ctx.organization.id
  if (data.departmentId && !(await prisma.department.findFirst({ where: { id: data.departmentId, organization_id: org }, select: { id: true } }))) {
    throw new ValidationError('Choose a valid department', { departmentId: 'Not found' })
  }
  if (data.positionId && !(await prisma.position.findFirst({ where: { id: data.positionId, organization_id: org }, select: { id: true } }))) {
    throw new ValidationError('Choose a valid position', { positionId: 'Not found' })
  }
}

async function assertItemRefs(ctx: RequestContext, item: z.infer<typeof itemSchema>) {
  const org = ctx.organization.id
  if (item.policyId && !(await policyRepository.findActive(org, item.policyId))) {
    throw new ValidationError('Choose an active policy', { policyId: 'Not found' })
  }
  if (item.assignedUserId) {
    const user = await prisma.user.findFirst({
      where: { id: item.assignedUserId, organization_id: org, status: 'ACTIVE', deleted_at: null, intern: { is: null } },
      select: { id: true },
    })
    if (!user) throw new ValidationError('Choose an active staff member', { assignedUserId: 'Not found' })
  }
}

async function loadTemplate(ctx: RequestContext, templateId: string) {
  const template = await templateRepository.find(ctx.organization.id, parseInput(z.uuid(), templateId))
  if (!template) throw new NotFoundError('Onboarding template')
  return template
}

function itemData(item: z.infer<typeof itemSchema>) {
  return {
    title: item.title,
    description: item.description ?? null,
    category: item.category,
    required: item.required,
    due_days_after_start: item.dueDaysAfterStart,
    assigned_role: item.assignedRole,
    assigned_user_id: item.assignedRole === 'HR' ? (item.assignedUserId ?? null) : null,
    required_document_type: item.category === 'DOCUMENT' ? (item.requiredDocumentType ?? null) : null,
    policy_id: item.category === 'ACKNOWLEDGEMENT' ? (item.policyId ?? null) : null,
  }
}

/**
 * Onboarding templates (onboarding.manage). Templates are blueprints only:
 * each intern gets an independent snapshot, so editing here never changes
 * checklists already generated.
 */
export const onboardingTemplateService = {
  async list(ctx: RequestContext) {
    authorizationService.require(ctx, 'onboarding.read')
    return templateRepository.list(ctx.organization.id)
  },

  async get(ctx: RequestContext, templateId: string) {
    authorizationService.require(ctx, 'onboarding.read')
    return loadTemplate(ctx, templateId)
  },

  async options(ctx: RequestContext) {
    authorizationService.require(ctx, 'onboarding.manage')
    const org = ctx.organization.id
    const [departments, positions, policies, hrStaff] = await Promise.all([
      prisma.department.findMany({ where: { organization_id: org, is_active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      prisma.position.findMany({ where: { organization_id: org, is_active: true }, orderBy: { title: 'asc' }, select: { id: true, title: true } }),
      policyRepository.listActive(org),
      prisma.user.findMany({
        where: {
          organization_id: org,
          status: 'ACTIVE',
          deleted_at: null,
          user_roles: { some: { role: { slug: { in: ['hr', 'admin', 'super_admin'] } } } },
        },
        orderBy: { first_name: 'asc' },
        select: { id: true, first_name: true, last_name: true, display_name: true },
      }),
    ])
    return { departments, positions, policies, hrStaff }
  },

  async create(ctx: RequestContext, input: unknown) {
    authorizationService.require(ctx, 'onboarding.manage')
    const data = parseInput(templateSchema, input)
    await assertRefs(ctx, data)
    const exists = await prisma.onboardingTemplate.findFirst({
      where: { organization_id: ctx.organization.id, name: data.name },
      select: { id: true },
    })
    if (exists) throw new ConflictError('A template with this name already exists')
    const created = await prisma.$transaction(async (tx) => {
      if (data.isDefault) {
        await tx.onboardingTemplate.updateMany({ where: { organization_id: ctx.organization.id }, data: { is_default: false } })
      }
      return tx.onboardingTemplate.create({
        data: {
          organization_id: ctx.organization.id,
          name: data.name,
          description: data.description ?? null,
          department_id: data.departmentId ?? null,
          position_id: data.positionId ?? null,
          is_active: data.isActive,
          is_default: data.isDefault,
          created_by: ctx.actor.userId,
        },
        select: { id: true },
      })
    })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.TEMPLATE_CREATED,
      resourceType: 'onboarding_template',
      resourceId: created.id,
      metadata: { name: data.name },
    })
    return created
  },

  async update(ctx: RequestContext, templateId: string, input: unknown) {
    authorizationService.require(ctx, 'onboarding.manage')
    const template = await loadTemplate(ctx, templateId)
    const data = parseInput(templateSchema, input)
    await assertRefs(ctx, data)
    const clash = await prisma.onboardingTemplate.findFirst({
      where: { organization_id: ctx.organization.id, name: data.name, id: { not: template.id } },
      select: { id: true },
    })
    if (clash) throw new ConflictError('A template with this name already exists')
    await prisma.$transaction(async (tx) => {
      if (data.isDefault) {
        await tx.onboardingTemplate.updateMany({
          where: { organization_id: ctx.organization.id, id: { not: template.id } },
          data: { is_default: false },
        })
      }
      await tx.onboardingTemplate.update({
        where: { id: template.id },
        data: {
          name: data.name,
          description: data.description ?? null,
          department_id: data.departmentId ?? null,
          position_id: data.positionId ?? null,
          is_active: data.isActive,
          is_default: data.isDefault,
        },
      })
    })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.TEMPLATE_UPDATED,
      resourceType: 'onboarding_template',
      resourceId: template.id,
      metadata: { fields: Object.keys(data) },
    })
  },

  async addItem(ctx: RequestContext, templateId: string, input: unknown) {
    authorizationService.require(ctx, 'onboarding.manage')
    const template = await loadTemplate(ctx, templateId)
    const data = parseInput(itemSchema, input)
    await assertItemRefs(ctx, data)
    const last = template.items.at(-1)?.sort_order ?? -1
    const item = await templateRepository.createItem({ template_id: template.id, sort_order: last + 1, ...itemData(data) })
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.TEMPLATE_UPDATED,
      resourceType: 'onboarding_template',
      resourceId: template.id,
      metadata: { itemAdded: item.id, title: data.title },
    })
    return item
  },

  async updateItem(ctx: RequestContext, itemId: string, input: unknown) {
    authorizationService.require(ctx, 'onboarding.manage')
    const existing = await templateRepository.findItem(ctx.organization.id, parseInput(z.uuid(), itemId))
    if (!existing) throw new NotFoundError('Template item')
    const data = parseInput(itemSchema, input)
    await assertItemRefs(ctx, data)
    await templateRepository.updateItem(existing.id, itemData(data))
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.TEMPLATE_UPDATED,
      resourceType: 'onboarding_template',
      resourceId: existing.template_id,
      metadata: { itemUpdated: existing.id },
    })
  },

  async removeItem(ctx: RequestContext, itemId: string) {
    authorizationService.require(ctx, 'onboarding.manage')
    const existing = await templateRepository.findItem(ctx.organization.id, parseInput(z.uuid(), itemId))
    if (!existing) throw new NotFoundError('Template item')
    // Generated checklist items keep their snapshot; the FK is nulled on delete.
    await templateRepository.deleteItem(existing.id)
    await auditService.logForContext(ctx, {
      action: AUDIT_ACTIONS.TEMPLATE_UPDATED,
      resourceType: 'onboarding_template',
      resourceId: existing.template_id,
      metadata: { itemRemoved: existing.id },
    })
  },

  /** Moves an item one place up or down. */
  async moveItem(ctx: RequestContext, itemId: string, direction: 'up' | 'down') {
    authorizationService.require(ctx, 'onboarding.manage')
    const existing = await templateRepository.findItem(ctx.organization.id, parseInput(z.uuid(), itemId))
    if (!existing) throw new NotFoundError('Template item')
    const items = await templateRepository.itemsInOrder(existing.template_id)
    const index = items.findIndex((item) => item.id === existing.id)
    const swapWith = direction === 'up' ? index - 1 : index + 1
    if (swapWith < 0 || swapWith >= items.length) return
    const reordered = [...items]
    ;[reordered[index], reordered[swapWith]] = [reordered[swapWith], reordered[index]]
    await prisma.$transaction(
      reordered.map((item, order) => prisma.onboardingTemplateItem.update({ where: { id: item.id }, data: { sort_order: order } })),
    )
  },
}

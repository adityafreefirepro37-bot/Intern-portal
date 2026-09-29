import 'server-only'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/client'

const itemSelect = {
  id: true,
  title: true,
  description: true,
  category: true,
  required: true,
  due_days_after_start: true,
  assigned_role: true,
  assigned_user_id: true,
  required_document_type: true,
  policy_id: true,
  sort_order: true,
  assigned_user: { select: { first_name: true, last_name: true, display_name: true } },
  policy: { select: { title: true, version: true } },
} as const

export const templateRepository = {
  list(organizationId: string) {
    return prisma.onboardingTemplate.findMany({
      where: { organization_id: organizationId, deleted_at: null },
      orderBy: [{ is_default: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        description: true,
        is_active: true,
        is_default: true,
        department: { select: { id: true, name: true } },
        position: { select: { id: true, title: true } },
        _count: { select: { items: true, onboardings: true } },
      },
    })
  },

  find(organizationId: string, id: string) {
    return prisma.onboardingTemplate.findFirst({
      where: { id, organization_id: organizationId, deleted_at: null },
      select: {
        id: true,
        name: true,
        description: true,
        is_active: true,
        is_default: true,
        department_id: true,
        position_id: true,
        items: { orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }], select: itemSelect },
      },
    })
  },

  /**
   * Most specific active template for a placement: position match, then
   * department match, then the organization default.
   */
  async pickFor(organizationId: string, placement: { departmentId?: string | null; positionId?: string | null }) {
    const active = { organization_id: organizationId, is_active: true, deleted_at: null }
    if (placement.positionId) {
      const byPosition = await prisma.onboardingTemplate.findFirst({
        where: { ...active, position_id: placement.positionId },
        select: { id: true },
      })
      if (byPosition) return byPosition.id
    }
    if (placement.departmentId) {
      const byDepartment = await prisma.onboardingTemplate.findFirst({
        where: { ...active, department_id: placement.departmentId, position_id: null },
        select: { id: true },
      })
      if (byDepartment) return byDepartment.id
    }
    const fallback = await prisma.onboardingTemplate.findFirst({
      where: { ...active, is_default: true },
      select: { id: true },
    })
    return fallback?.id ?? null
  },

  create(data: Prisma.OnboardingTemplateUncheckedCreateInput) {
    return prisma.onboardingTemplate.create({ data, select: { id: true } })
  },

  update(id: string, data: Prisma.OnboardingTemplateUncheckedUpdateInput) {
    return prisma.onboardingTemplate.update({ where: { id }, data, select: { id: true } })
  },

  createItem(data: Prisma.OnboardingTemplateItemUncheckedCreateInput) {
    return prisma.onboardingTemplateItem.create({ data, select: { id: true } })
  },

  findItem(organizationId: string, itemId: string) {
    return prisma.onboardingTemplateItem.findFirst({
      where: { id: itemId, template: { organization_id: organizationId, deleted_at: null } },
      select: { id: true, template_id: true, sort_order: true },
    })
  },

  updateItem(id: string, data: Prisma.OnboardingTemplateItemUncheckedUpdateInput) {
    return prisma.onboardingTemplateItem.update({ where: { id }, data, select: { id: true } })
  },

  deleteItem(id: string) {
    return prisma.onboardingTemplateItem.delete({ where: { id }, select: { id: true } })
  },

  itemsInOrder(templateId: string) {
    return prisma.onboardingTemplateItem.findMany({
      where: { template_id: templateId },
      orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
      select: { id: true, sort_order: true },
    })
  },
}

export type TemplateDetail = NonNullable<Awaited<ReturnType<typeof templateRepository.find>>>

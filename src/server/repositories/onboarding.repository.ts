import 'server-only'
import type { OnboardingItemStatus, Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/client'

const itemSelect = {
  id: true,
  title: true,
  description: true,
  item_type: true,
  required: true,
  status: true,
  due_date: true,
  sort_order: true,
  assigned_role: true,
  assigned_to: true,
  completed_at: true,
  blocked_reason: true,
  required_document_type: true,
  document_id: true,
  policy_id: true,
  assignee: { select: { id: true, first_name: true, last_name: true, display_name: true } },
  completer: { select: { first_name: true, last_name: true, display_name: true } },
  policy: { select: { id: true, title: true, version: true, body: true } },
  document: { select: { id: true, file_name: true, deleted_at: true } },
} as const

export const onboardingRepository = {
  itemsForInternship(internshipId: string) {
    return prisma.onboardingItem.findMany({
      where: { internship_id: internshipId },
      orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
      select: itemSelect,
    })
  },

  /** An item with everything needed to authorize an action on it. */
  findItemWithContext(organizationId: string, itemId: string) {
    return prisma.onboardingItem.findFirst({
      where: { id: itemId, organization_id: organizationId },
      select: {
        ...itemSelect,
        organization_id: true,
        internship_id: true,
        onboarding_id: true,
        internship: {
          select: {
            id: true,
            intern: {
              select: {
                id: true,
                user_id: true,
                organization_id: true,
                manager_id: true,
                mentor_id: true,
                team_id: true,
                department_id: true,
                deleted_at: true,
              },
            },
          },
        },
      },
    })
  },

  updateItem(id: string, data: Prisma.OnboardingItemUncheckedUpdateInput) {
    return prisma.onboardingItem.update({ where: { id }, data, select: { id: true, status: true } })
  },

  findOnboarding(internshipId: string) {
    return prisma.onboarding.findUnique({ where: { internship_id: internshipId } })
  },

  /** Marks the onboarding complete exactly once. */
  async markComplete(onboardingId: string, at: Date): Promise<boolean> {
    const result = await prisma.onboarding.updateMany({
      where: { id: onboardingId, completed_at: null },
      data: { completed_at: at },
    })
    return result.count === 1
  },

  async reopen(onboardingId: string) {
    await prisma.onboarding.updateMany({ where: { id: onboardingId }, data: { completed_at: null } })
  },

  /** Onboarding instances in an organization with item status for dashboards. */
  listInstances(where: Prisma.OnboardingWhereInput, take = 200) {
    return prisma.onboarding.findMany({
      where,
      orderBy: { started_at: 'desc' },
      take,
      select: {
        id: true,
        started_at: true,
        completed_at: true,
        template_name: true,
        internship: {
          select: {
            id: true,
            start_date: true,
            intern: {
              select: {
                id: true,
                status: true,
                employee_code: true,
                user: { select: { id: true, first_name: true, last_name: true, display_name: true, avatar_url: true } },
              },
            },
          },
        },
        items: { select: { required: true, status: true, due_date: true } },
      },
    })
  },

  /** Open items past their due date (for the overdue job). */
  listOverdueItems(organizationId: string, today: Date, statuses: OnboardingItemStatus[]) {
    return prisma.onboardingItem.findMany({
      where: { organization_id: organizationId, due_date: { lt: today }, status: { in: statuses } },
      select: {
        id: true,
        due_date: true,
        assigned_to: true,
        internship: { select: { intern: { select: { id: true, deleted_at: true } } } },
      },
      take: 1000,
    })
  },
}

export type OnboardingItemRecord = Awaited<ReturnType<typeof onboardingRepository.itemsForInternship>>[number]

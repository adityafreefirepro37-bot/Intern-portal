import 'server-only'
import type { AuditStatus, Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/client'

export interface AuditFilter {
  search?: string
  action?: string
  actorUserId?: string
  status?: AuditStatus
  from?: Date
  to?: Date
}

function whereFor(organizationId: string, filter: AuditFilter): Prisma.AuditLogWhereInput {
  const search = filter.search?.trim()
  return {
    organization_id: organizationId,
    ...(filter.action ? { action: filter.action } : {}),
    ...(filter.actorUserId ? { actor_user_id: filter.actorUserId } : {}),
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.from || filter.to
      ? { created_at: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lt: filter.to } : {}) } }
      : {}),
    ...(search
      ? {
          OR: [
            { action: { contains: search, mode: 'insensitive' } },
            { resource_type: { contains: search, mode: 'insensitive' } },
            { resource_id: { contains: search, mode: 'insensitive' } },
            { ip_address: { contains: search } },
            { actor: { email: { contains: search, mode: 'insensitive' } } },
            { actor: { first_name: { contains: search, mode: 'insensitive' } } },
            { actor: { last_name: { contains: search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  }
}

export const auditRepository = {
  create(data: Prisma.AuditLogUncheckedCreateInput) {
    return prisma.auditLog.create({ data, select: { id: true } })
  },

  listRecent(organizationId: string, take: number) {
    return prisma.auditLog.findMany({
      where: { organization_id: organizationId },
      orderBy: { created_at: 'desc' },
      take,
      select: {
        id: true,
        action: true,
        resource_type: true,
        resource_id: true,
        metadata: true,
        created_at: true,
        actor: { select: { first_name: true, last_name: true, display_name: true, avatar_url: true } },
      },
    })
  },

  listPage(organizationId: string, filter: AuditFilter, skip: number, take: number) {
    const where = whereFor(organizationId, filter)
    return prisma.$transaction([
      prisma.auditLog.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take,
        select: {
          id: true,
          action: true,
          resource_type: true,
          resource_id: true,
          status: true,
          ip_address: true,
          created_at: true,
          actor: { select: { first_name: true, last_name: true, display_name: true, email: true } },
        },
      }),
      prisma.auditLog.count({ where }),
    ])
  },

  async listActors(organizationId: string) {
    const rows = await prisma.auditLog.findMany({
      where: { organization_id: organizationId, actor_user_id: { not: null } },
      distinct: ['actor_user_id'],
      select: { actor: { select: { id: true, first_name: true, last_name: true, display_name: true } } },
      take: 200,
    })
    return rows.flatMap((row) => (row.actor ? [row.actor] : []))
  },
}

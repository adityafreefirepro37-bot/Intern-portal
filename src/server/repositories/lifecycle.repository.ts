import 'server-only'
import { Prisma, type LifecycleEventType } from '@prisma/client'
import { prisma } from '@/lib/db/client'

type Db = Prisma.TransactionClient | typeof prisma

export interface LifecycleEventInput {
  organizationId: string
  internId: string
  type: LifecycleEventType
  description: string
  actorUserId?: string | null
  metadata?: Record<string, unknown>
  /** Set for automated/repeatable events so they are recorded at most once. */
  idempotencyKey?: string
  createdAt?: Date
}

export const lifecycleRepository = {
  /** Records an event; returns false when an event with the same idempotency key already exists. */
  async record(db: Db, event: LifecycleEventInput): Promise<boolean> {
    try {
      await db.internLifecycleEvent.create({
        data: {
          organization_id: event.organizationId,
          intern_id: event.internId,
          event_type: event.type,
          description: event.description,
          actor_user_id: event.actorUserId ?? null,
          metadata: event.metadata as Prisma.InputJsonValue | undefined,
          idempotency_key: event.idempotencyKey ?? null,
          ...(event.createdAt ? { created_at: event.createdAt } : {}),
        },
      })
      return true
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return false
      throw error
    }
  },

  listForIntern(internId: string, take = 100) {
    return prisma.internLifecycleEvent.findMany({
      where: { intern_id: internId },
      orderBy: { created_at: 'desc' },
      take,
      select: {
        id: true,
        event_type: true,
        description: true,
        created_at: true,
        metadata: true,
        actor: { select: { first_name: true, last_name: true, display_name: true } },
      },
    })
  },
}

export const counterRepository = {
  /**
   * Atomically returns the next value of a per-organization counter. The
   * first call seeds the counter with `initial`; later calls increment under
   * a row lock, so concurrent callers always receive distinct values.
   */
  async next(db: Db, organizationId: string, key: string, initial: number): Promise<number> {
    const rows = await db.$queryRaw<{ value: number }[]>`
      INSERT INTO "code_counters" ("organization_id", "key", "value", "updated_at")
      VALUES (${organizationId}::uuid, ${key}, ${initial}, now())
      ON CONFLICT ("organization_id", "key")
      DO UPDATE SET "value" = "code_counters"."value" + 1, "updated_at" = now()
      RETURNING "value"`
    return Number(rows[0].value)
  },
}

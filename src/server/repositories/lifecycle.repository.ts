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
   * Atomically returns the next value of a per-organization counter, never
   * less than `floor`. The first call seeds the counter with `floor`; later
   * calls increment under a row lock, so concurrent callers always receive
   * distinct values. The floor lets the counter skip past codes that were
   * created some other way (imports, a changed prefix).
   */
  async next(db: Db, organizationId: string, key: string, floor: number): Promise<number> {
    const rows = await db.$queryRaw<{ value: number }[]>`
      INSERT INTO "code_counters" ("organization_id", "key", "value", "updated_at")
      VALUES (${organizationId}::uuid, ${key}, ${floor}, now())
      ON CONFLICT ("organization_id", "key")
      DO UPDATE SET "value" = GREATEST("code_counters"."value" + 1, ${floor}), "updated_at" = now()
      RETURNING "value"`
    return Number(rows[0].value)
  },

  /** Highest numeric suffix among the organization's employee codes with this prefix (0 if none). */
  async highestEmployeeCode(db: Db, organizationId: string, prefix: string): Promise<number> {
    const start = prefix.length + 1
    const rows = await db.$queryRaw<{ highest: number | null }[]>`
      SELECT MAX(CAST(substr("employee_code", ${start}::int) AS integer)) AS "highest"
      FROM "interns"
      WHERE "organization_id" = ${organizationId}::uuid
        AND starts_with("employee_code", ${prefix}::text)
        AND substr("employee_code", ${start}::int) ~ '^[0-9]{1,9}$'`
    return Number(rows[0]?.highest ?? 0)
  },
}

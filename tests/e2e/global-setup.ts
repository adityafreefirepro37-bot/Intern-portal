import { loadEnvConfig } from '@next/env'
import { PrismaClient } from '@prisma/client'

/** Items of the seeded intern's checklist that start completed (see prisma/seed/demo.ts). */
const SEEDED_DONE = [3, 5, 6]

/**
 * E2E housekeeping (never in production):
 *  - clears rate-limit counters so repeated runs don't trip the sign-in limits;
 *  - soft-deletes interns created by earlier e2e runs (emails e2e.*@test.ayava.dev);
 *  - restores the seeded intern's onboarding checklist to its seed state so the
 *    "intern completes onboarding" flow always starts from the same place.
 */
export default async function globalSetup() {
  loadEnvConfig(process.cwd())
  if (process.env.NODE_ENV === 'production' || process.env.E2E_BASE_URL?.startsWith('https://')) return
  const prisma = new PrismaClient()
  try {
    await prisma.rateLimitBucket.deleteMany({})

    const now = new Date()
    await prisma.intern.updateMany({
      where: { user: { email: { startsWith: 'e2e.', endsWith: '@test.ayava.dev' } }, deleted_at: null },
      data: { deleted_at: now },
    })
    await prisma.user.updateMany({
      where: { email: { startsWith: 'e2e.', endsWith: '@test.ayava.dev' }, deleted_at: null },
      data: { deleted_at: now, status: 'INACTIVE' },
    })

    // Projects created by the work flows (names start with "E2E ").
    await prisma.task.updateMany({
      where: { project: { name: { startsWith: 'E2E ' } }, deleted_at: null },
      data: { deleted_at: now },
    })
    await prisma.project.updateMany({
      where: { name: { startsWith: 'E2E ' }, deleted_at: null },
      data: { deleted_at: now },
    })

    const aanya = await prisma.intern.findFirst({
      where: { user: { email: 'intern@ayavacreatives.com' } },
      select: { id: true, user_id: true, internships: { select: { id: true, onboarding: { select: { id: true } } } } },
    })
    const internship = aanya?.internships[0]
    if (aanya && internship?.onboarding) {
      const items = await prisma.onboardingItem.findMany({
        where: { internship_id: internship.id },
        orderBy: { sort_order: 'asc' },
        select: { id: true, sort_order: true, policy_id: true },
      })
      for (const item of items) {
        const done = SEEDED_DONE.includes(item.sort_order)
        await prisma.onboardingItem.update({
          where: { id: item.id },
          data: done
            ? { status: 'COMPLETED', document_id: null, blocked_reason: null }
            : { status: 'PENDING', completed_at: null, completed_by: null, document_id: null, blocked_reason: null },
        })
      }
      const keepPolicies = items
        .filter((item) => SEEDED_DONE.includes(item.sort_order) && item.policy_id)
        .map((item) => item.policy_id!)
      await prisma.documentAcknowledgement.deleteMany({
        where: { user_id: aanya.user_id, policy_id: { notIn: keepPolicies } },
      })
      await prisma.onboarding.update({ where: { id: internship.onboarding.id }, data: { completed_at: null } })
      await prisma.internshipDocument.updateMany({
        where: { intern_id: aanya.id, deleted_at: null },
        data: { deleted_at: now },
      })
      await prisma.intern.update({ where: { id: aanya.id }, data: { status: 'ONBOARDING' } })
    }
  } finally {
    await prisma.$disconnect()
  }
}

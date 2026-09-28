import { loadEnvConfig } from '@next/env'
import { PrismaClient } from '@prisma/client'

/**
 * E2E housekeeping: clears rate-limit counters so repeated local runs don't
 * trip the (intentionally strict) limits on sign-in and password reset.
 * Refuses to touch anything in production.
 */
export default async function globalSetup() {
  loadEnvConfig(process.cwd())
  if (process.env.NODE_ENV === 'production' || process.env.E2E_BASE_URL?.startsWith('https://')) return
  const prisma = new PrismaClient()
  try {
    await prisma.rateLimitBucket.deleteMany({})
  } finally {
    await prisma.$disconnect()
  }
}

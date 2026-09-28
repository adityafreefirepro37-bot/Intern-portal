import 'server-only'
import { PrismaClient } from '@prisma/client'

/**
 * Single Prisma client per server process. In development the instance is
 * cached on globalThis so hot reloads don't exhaust database connections.
 *
 * Only repositories and services import this module — never UI components.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export type DbClient = PrismaClient

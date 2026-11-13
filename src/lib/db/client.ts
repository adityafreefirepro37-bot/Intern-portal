import 'server-only'
import type { PrismaClient } from '@prisma/client'
import { createPrismaClient } from './pool'

/**
 * Single Prisma client per server process. In development the instance is
 * cached on globalThis so hot reloads don't exhaust database connections.
 * Queries go through node-postgres: one round trip each (see ./pool.ts).
 *
 * Only repositories and services import this module — never UI components.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export type DbClient = PrismaClient

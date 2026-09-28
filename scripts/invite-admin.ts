/**
 * Bootstrap: invite a Super Admin (for a fresh production database, where the
 * seed creates no users). Prints a one-time invitation link to this terminal
 * only — it is not logged or stored in plain text.
 *
 *   npm run admin:invite -- --email you@company.com --first Meera --last Iyer
 *
 * Uses the same invitation tables and rules as the app: the token is stored as
 * a SHA-256 hash, expires after INVITATION_TTL_HOURS, and works once.
 */
import { loadEnvConfig } from '@next/env'
import { PrismaClient } from '@prisma/client'
import { parseArgs } from 'node:util'
import { generateSecureToken, hashToken } from '../src/lib/security/tokens'

loadEnvConfig(process.cwd())

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    first: { type: 'string' },
    last: { type: 'string' },
    organization: { type: 'string', default: process.env.DEFAULT_ORGANIZATION_SLUG ?? 'ayava-creatives' },
  },
})

async function main() {
  const email = values.email?.trim().toLowerCase()
  const first = values.first?.trim()
  const last = values.last?.trim()
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !first || !last) {
    throw new Error('Usage: npm run admin:invite -- --email you@company.com --first Name --last Surname')
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const ttlHours = Number(process.env.INVITATION_TTL_HOURS ?? 168)

  const prisma = new PrismaClient()
  try {
    const organization = await prisma.organization.findUniqueOrThrow({ where: { slug: values.organization! } })
    const role = await prisma.role.findUniqueOrThrow({
      where: { organization_id_slug: { organization_id: organization.id, slug: 'super_admin' } },
    })
    const existing = await prisma.user.findUnique({
      where: { organization_id_email: { organization_id: organization.id, email } },
    })
    if (existing && (existing.status === 'ACTIVE' || existing.status === 'SUSPENDED')) {
      throw new Error(`${email} already has an account (${existing.status}).`)
    }

    const token = generateSecureToken(32)
    await prisma.$transaction(async (tx) => {
      const user = existing
        ? await tx.user.update({
            where: { id: existing.id },
            data: { first_name: first, last_name: last, status: 'INVITED', deleted_at: null },
          })
        : await tx.user.create({
            data: { organization_id: organization.id, email, first_name: first, last_name: last, status: 'INVITED' },
          })
      await tx.userRole.deleteMany({ where: { user_id: user.id } })
      await tx.userRole.create({ data: { user_id: user.id, role_id: role.id } })
      await tx.userInvitation.updateMany({
        where: { user_id: user.id, accepted_at: null, revoked_at: null },
        data: { revoked_at: new Date() },
      })
      const invitation = await tx.userInvitation.create({
        data: {
          organization_id: organization.id,
          user_id: user.id,
          email,
          role_id: role.id,
          token_hash: hashToken(token),
          expires_at: new Date(Date.now() + ttlHours * 60 * 60 * 1000),
        },
      })
      await tx.auditLog.create({
        data: {
          organization_id: organization.id,
          action: 'invitation.created',
          resource_type: 'invitation',
          resource_id: invitation.id,
          metadata: { via: 'cli', role: 'super_admin' },
        },
      })
    })

    process.stdout.write(
      `\nSuper Admin invitation for ${email} (expires in ${ttlHours} hours, single use):\n\n  ${appUrl}/invite/${token}\n\nShare it only with that person.\n\n`,
    )
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})

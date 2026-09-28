/**
 * Database seed.
 *
 *   npm run db:seed
 *
 * 1. Reference data (organization, permissions, roles, departments, positions,
 *    leave types, settings) — runs in every environment, idempotent.
 * 2. Demo data (fictional people, projects, tasks, courses) — development and
 *    test only; skipped when NODE_ENV=production.
 * 3. Optional: when SEED_DEV_PASSWORD and Supabase admin credentials are set,
 *    creates matching Supabase Auth users for the development accounts and
 *    links them via users.auth_user_id. Passwords are never stored in this
 *    database.
 */
import { loadEnvConfig } from '@next/env'
import { PrismaClient } from '@prisma/client'
import { createClient } from '@supabase/supabase-js'
import { DEV_ACCOUNTS, seedDemo } from './seed/demo'
import { seedReference } from './seed/reference'

// Load .env the same way Next.js does, whichever way the seed is launched.
loadEnvConfig(process.cwd())

const prisma = new PrismaClient()
const isProduction = process.env.NODE_ENV === 'production'

async function linkSupabaseAuthUsers(userIds: Record<string, string>) {
  const url = process.env.SUPABASE_URL?.trim()
  const serviceRoleKey = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim()
  const password = process.env.SEED_DEV_PASSWORD?.trim()
  if (!password || !url || !serviceRoleKey) {
    console.log('ℹ Supabase Auth users not created (set SEED_DEV_PASSWORD and Supabase keys to enable).')
    return
  }
  if (password.length < 12) throw new Error('SEED_DEV_PASSWORD must be at least 12 characters.')

  const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: existing, error: listError } = await supabase.auth.admin.listUsers({ perPage: 1000 })
  if (listError) throw listError

  for (const account of DEV_ACCOUNTS) {
    let authUserId = existing.users.find((user) => user.email?.toLowerCase() === account.email)?.id
    if (authUserId) {
      // Development accounts always use SEED_DEV_PASSWORD, so re-seeding restores a known state.
      const { error } = await supabase.auth.admin.updateUserById(authUserId, {
        password,
        email_confirm: true,
        ban_duration: 'none',
      })
      if (error) throw error
    } else {
      const { data, error } = await supabase.auth.admin.createUser({
        email: account.email,
        password,
        email_confirm: true,
      })
      if (error) throw error
      authUserId = data.user.id
    }
    await prisma.user.update({
      where: { id: userIds[account.key] },
      data: { auth_user_id: authUserId, email_verified_at: new Date() },
    })
  }
  console.log(`✔ Linked ${DEV_ACCOUNTS.length} development accounts to Supabase Auth.`)
}

async function main() {
  console.log('Seeding reference data…')
  const reference = await seedReference(prisma)
  console.log(
    `✔ Organization, ${reference.permissionCount} permissions, ${Object.keys(reference.roleIds).length} system roles, ` +
      `${Object.keys(reference.departmentIds).length} departments, ${Object.keys(reference.positionIds).length} positions`,
  )

  if (isProduction) {
    console.log('NODE_ENV=production: demo data and development accounts skipped.')
    return
  }

  console.log('Seeding development demo data…')
  const demo = await seedDemo(prisma, reference)
  console.log('✔ Demo people, interns, projects, tasks, courses and announcements')
  console.log('  Development accounts (profiles only unless linked to Supabase Auth):')
  for (const account of DEV_ACCOUNTS) console.log(`   - ${account.email} (${account.role})`)

  await linkSupabaseAuthUsers(demo.userIds)
}

main()
  .catch((error) => {
    console.error('Seed failed:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

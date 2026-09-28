import { mkdir, writeFile } from 'node:fs/promises'
import { test as setup } from '@playwright/test'
import { AUTH_CONFIGURED, signIn } from './support'

/** Signs in once as the super admin and stores the session for signed-in projects. */
setup('sign in as admin', async ({ page }) => {
  await mkdir('playwright/.auth', { recursive: true })
  if (!AUTH_CONFIGURED) {
    // Leave an empty state so dependent projects can start (their tests skip).
    await writeFile('playwright/.auth/admin.json', JSON.stringify({ cookies: [], origins: [] }))
    setup.skip(true, 'Supabase Auth is not configured')
    return
  }
  await signIn(page, 'admin')
  await page.context().storageState({ path: 'playwright/.auth/admin.json' })
})

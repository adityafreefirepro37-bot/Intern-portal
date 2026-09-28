<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AYAVA INTERN OS - Development Notes

## Project Status

Phase 01 Foundation - COMPLETE
Phase 02 Authentication, RBAC & security - COMPLETE (next: Prompt 03 — intern management). See README.md and docs/.

## Quick Start Commands

```bash
npm install
cp .env.example .env
npm run db:local        # local PostgreSQL on :5433 (keep running)
npm run db:migrate
npm run db:seed
npm run dev

npm run typecheck && npm run lint && npm test
npm run test:integration   # real PostgreSQL (TEST_DATABASE_URL, reset each run)
npm run test:e2e           # Playwright (PLAYWRIGHT_CHANNEL=msedge to use installed Edge)
npm run build
```

## Important Notes

- Multi-tenant: every query is scoped to the organization from the server request context (src/server/context.ts)
- Layering: pages/components → services (src/server/services) → repositories → Prisma; UI never imports the db client
- Permissions are data (roles → role_permissions (with scope) → permissions); check permissions, never role names
- Services call authorizationService.require() and use the scope filters in src/server/repositories/scope.ts
- Auth is Supabase Auth, server-only; resolve the user with requirePageContext()/requireApiContext(); never trust client ids
- Validate all server input with Zod (src/lib/validation); return the standard envelope (src/lib/http/response.ts)
- Use auditService for important state changes; use the redacting logger (src/lib/logging)
- Never hard-code data in components — it comes from the database via services
- UI uses design-system tokens (src/app/globals.css) and shared components (src/components)
- Unbuilt features show a "Phase NN" placeholder or disabled control — no fake functionality
- `_archive/` holds files from the earlier partial attempt; not compiled — safe to delete once reviewed

## Development Accounts

The seed creates these profiles (development only; skipped in production):
- admin@ayavacreatives.com (Super Admin)
- hr@ayavacreatives.com (HR)
- manager@ayavacreatives.com (Manager)
- mentor@ayavacreatives.com (Mentor)
- intern@ayavacreatives.com (Intern)

No passwords are stored in this database. With Supabase keys + SEED_DEV_PASSWORD in .env, `npm run db:seed` creates
matching Supabase users with that password (development only). Production bootstrap: `npm run admin:invite`.

⚠️ NEVER set SEED_DEV_PASSWORD in production, and use a separate Supabase project for production!

# Development guide

## Setup

```bash
npm install
cp .env.example .env
npm run db:local        # keep running in its own terminal (PostgreSQL on :5433)
npm run db:migrate
npm run db:seed
npm run dev
```

Using your own PostgreSQL or Supabase: edit `DATABASE_URL`, `DIRECT_URL` and `TEST_DATABASE_URL` in `.env` and skip
`db:local`. Next.js 16 here differs from older versions (e.g. `middleware` is now `proxy`, request APIs are async,
`error.tsx` receives `retry`); read `node_modules/next/dist/docs/` before using an unfamiliar API.

### Signing in as different roles

Configure Supabase ([authentication.md](authentication.md#supabase-setup-one-time)), set `SEED_DEV_PASSWORD` in `.env`
and run `npm run db:seed`. Then sign in as any development account (admin, hr, manager, mentor, intern,
marketing.manager, design.mentor `@ayavacreatives.com`) with that password. Arjun (`manager@`) manages the
Development and Design interns and Priya (`marketing.manager@`) the Marketing ones; Rohan (`mentor@`) mentors
Development and Marketing and Sana (`design.mentor@`) Design — useful for checking manager/mentor scope. Navigation, dashboard sections and page access follow each role's
permissions and scopes from the database.

### End-to-end tests without Supabase

`npm run test:e2e:local [playwright args]` starts a mock of the Supabase Auth API (`tests/e2e/mock-auth`, test-only),
rebuilds a separate database (`DATABASE_URL` + `_e2e`, or `E2E_DATABASE_URL`) with migrations and the seed, links the
development accounts to the mock and runs Playwright against a dev server on port 3100. The application code is the
same; only `SUPABASE_URL` points at the mock. Use it where no Supabase project is available (CI containers); keep
`npm run test:e2e` against real Supabase for release checks.

## Everyday commands

```bash
npm run typecheck       # route types + tsc
npm run lint            # ESLint (no `any`, no @ts-ignore, no unused vars)
npm run format          # Prettier
npm test                # unit tests
npm run test:integration
npm run test:e2e        # PLAYWRIGHT_CHANNEL=msedge to use installed Edge
npm run test:e2e:local  # every E2E suite without Supabase (mock Auth + separate <db>_e2e database)
npm run jobs:daily      # ending-soon + overdue-onboarding jobs (what the daily cron runs)
npm run build
```

Before committing: `npm run typecheck && npm run lint && npm test`.

## Conventions

- **Files:** kebab-case (`stat-card.tsx`, `task.service.ts`, `task.repository.ts`). Components are PascalCase exports.
- **Layers:** pages/components → services (`src/server/services`) → repositories (`src/server/repositories`) → Prisma.
  Components never import `@/lib/db/client`. Modules that must stay on the server import `'server-only'`.
- **Services** take `ctx: RequestContext` first, check a permission, and scope by `ctx.organization.id`.
- **Permissions:** add to `src/lib/permissions/catalog.ts`, grant in `DEFAULT_ROLE_GRANTS`, re-run `npm run db:seed`.
- **Validation:** build feature schemas from `src/lib/validation`; parse with `parseInput()`.
- **Mutations:** wrap with `defineAction({ schema, permission, handler })`; call `auditService` for important changes.
- **Styling:** use tokens (`bg-card`, `text-muted-foreground`, `text-h2`), never raw colours. Check new components in the
  gallery at `/dev/components` (development only).
- **Unbuilt features:** show `PhasePlaceholder` or a disabled control with `PhaseBadge` — never a button that does
  nothing.
- **Tests:** unit tests in `tests/unit`, database tests in `tests/integration`, browser tests in `tests/e2e`.

## Adding a feature (example: creating a task in Prompt 04)

1. Schema already exists; if a change is needed, edit `prisma/schema.prisma` and run
   `npm run db:migrate -- --name task_something`.
2. `src/features/tasks/schemas.ts`: `createTaskSchema` built from shared schemas.
3. `taskRepository.create()`; `taskService.create(ctx, input)` → `require(ctx, 'task.create')`, validate project belongs
   to `ctx.organization.id`, create, `auditService.logForContext(ctx, { action: 'task.created', … })`.
4. `src/server/actions/tasks.ts` (`'use server'`): `export const createTask = defineAction({ … })`.
5. UI in `src/features/tasks/components`, using `FormField`, `Dialog`, `useToast`.
6. Unit-test the rules; integration-test permission, isolation and audit behaviour; extend the e2e flow.

## Troubleshooting

| Symptom | Fix |
| ------- | --- |
| Login says sign-in isn't configured | Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `.env` and restart `npm run dev` |
| Correct password but “profile isn't set up” | The Supabase user isn't linked: set `SEED_DEV_PASSWORD` + service-role key and run `npm run db:seed` |
| “Too many attempts” while testing | Rate limits are working; wait, or clear `rate_limit_buckets` in the local database |
| `Can't reach database server` | Start `npm run db:local` or fix `DATABASE_URL` |
| Stale route types in `tsc` | Run `npm run typecheck` (regenerates types) |
| Integration tests refuse to run | `TEST_DATABASE_URL` must be set, differ from `DATABASE_URL`, and name a database containing `test` |
| Playwright can't find a browser | `npx playwright install chromium`, `PLAYWRIGHT_CHANNEL=msedge`, or `PLAYWRIGHT_EXECUTABLE_PATH=/path/to/chrome` |
| Signed-in E2E tests are skipped | Configure Supabase + `SEED_DEV_PASSWORD`, or use `npm run test:e2e:local` |
| `test:e2e:local` times out starting the app | Another `next dev` for this folder is still running; stop it and retry |

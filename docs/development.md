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
`db:local`.

Developing with `.env` pointing at a hosted database (e.g. Supabase) is slow: every query is a network round trip, and
pages run dozens. Keep `db:local` running and use it instead; sign-in still goes through Supabase:

```bash
npm run db:local:setup  # once: migrate + seed the local database, link the dev accounts to Supabase Auth
npm run dev:local       # next dev with DATABASE_URL/DIRECT_URL → local, STORAGE_PROVIDER=local
```

`scripts/with-local-db.mjs` overrides these for its own process only (`.env` is never written; set
`LOCAL_DATABASE_URL` to use another local database). `npm run dev:pooled` stays on the hosted database but uses the
session pooler with five connections, for checking against real data.

Next.js 16 here differs from older versions (e.g. `middleware` is now `proxy`, request APIs are async,
`error.tsx` receives `retry`); read `node_modules/next/dist/docs/` before using an unfamiliar API.

### Signing in as different roles

Configure Supabase ([authentication.md](authentication.md#supabase-setup-one-time)), set `SEED_DEV_PASSWORD` in `.env`
and run `npm run db:seed`. Then sign in as any development account (admin, hr, manager, mentor, intern
`@ayavacreatives.com`) with that password. Navigation, dashboard sections and page access follow each role's
permissions and scopes from the database.

## Everyday commands

```bash
npm run typecheck       # route types + tsc
npm run lint            # ESLint (no `any`, no @ts-ignore, no unused vars)
npm run format          # Prettier
npm test                # unit tests
npm run test:integration
npm run test:e2e        # PLAYWRIGHT_CHANNEL=msedge to use installed Edge
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
| Playwright can't find a browser | `npx playwright install chromium` or set `PLAYWRIGHT_CHANNEL=msedge` |

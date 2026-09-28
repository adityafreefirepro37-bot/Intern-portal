# AYAVA INTERN OS

The intern management and work operating system for **Ayava Creatives** — interns, onboarding, projects, tasks,
attendance, leave, documents, learning, performance, AI assistance, certificates and analytics in one place.

Implemented so far: **Phase 01 — Foundation** (architecture, database, design system, shell, read-only views of real data)
**Phase 02 — Authentication, RBAC & security** (Supabase sign-in, sessions, scoped permissions, user management,
invitations, audit log) and **Phase 03 — Intern management, HR directory & onboarding** (intern directory and
profiles, internship lifecycle, manager/mentor scope, onboarding templates and checklists, policy acknowledgements,
private intern documents, HR and role-aware dashboards — see [docs/intern-management.md](docs/intern-management.md)
and [docs/onboarding.md](docs/onboarding.md)). Features are delivered in later phases (see
[Roadmap](#roadmap)); pages for unbuilt features say so plainly instead of pretending to work.

## Tech stack

| Layer         | Choice                                                                        |
| ------------- | ----------------------------------------------------------------------------- |
| Framework     | Next.js 16 (App Router, Turbopack), React 19, TypeScript (strict)             |
| Styling / UI  | Tailwind CSS 4 with semantic design tokens, shadcn-style components on Radix  |
| Icons         | Lucide                                                                        |
| Database      | PostgreSQL (Supabase-compatible), Prisma 5 ORM, SQL migrations                |
| Validation    | Zod 4                                                                         |
| Auth          | Supabase Auth via server-only `@supabase/ssr` (httpOnly cookies); no passwords stored in our database |
| Storage       | Storage abstraction with local and Supabase providers                         |
| Testing       | Jest (unit + integration against real PostgreSQL), Playwright (end-to-end)    |
| Quality       | ESLint 9, Prettier, `tsc --noEmit`                                            |

## Architecture at a glance

```text
Page / Route Handler / Server Action
        ↓  validate input (Zod)            src/lib/validation
        ↓  resolve request context         src/server/context.ts   (who + org + permissions, from the DB)
        ↓  authorize (permission check)    src/server/services/authorization.service.ts
Service (business rules)                   src/server/services/*
        ↓
Repository (data access, org-scoped)       src/server/repositories/*
        ↓
PostgreSQL (constraints, RLS, indexes)     prisma/schema.prisma + prisma/migrations
```

UI components never touch the database, and permissions are data (`roles` → `role_permissions` → `permissions`), not
role-name checks. Details: [docs/architecture.md](docs/architecture.md).

## Folder structure

```text
prisma/                 schema, migrations (SQL), seed (reference + demo data)
scripts/local-db.mjs    local PostgreSQL for development (no install needed)
src/
  app/
    (auth)/             login, forgot/reset password, verify email, account status, invitations
    (dashboard)/        authenticated app: overview, tasks, projects, interns, …
    api/                route handlers (health, search)
  components/
    ui/                 primitives: button, card, dialog (modal/drawer), dropdown, tabs, …
    layout/             app shell, sidebar, topbar, mobile nav
    navigation/         nav list, breadcrumbs, command menu
    common/             page header, stat card, badges, avatars, empty/loading/error states
    forms/              form field, date picker, file upload, search input
    tables/             data table, pagination, filter bar
    feedback/           toast, confirm dialog
  features/             feature-specific UI (dashboard today; one folder per feature)
  lib/                  config, db client, errors, http envelope, logging, permissions,
                        storage, security helpers, validation, utils
  server/               request context, services, repositories, actions
  config/               navigation and site metadata
  types/                shared type exports
tests/                  unit/, integration/, e2e/
docs/                   architecture, database, security, development
```

## Getting started

Prerequisites: **Node.js 20.9+** and npm. PostgreSQL is optional — the project can run a local one for you.

```bash
npm install
cp .env.example .env
npm run db:local        # terminal 1: starts PostgreSQL on port 5433 (leave running)
npm run db:migrate      # terminal 2: applies migrations
npm run db:seed         # reference data + development demo data
npm run dev             # http://localhost:3000
```

To use your own PostgreSQL or Supabase instead, set `DATABASE_URL` and `DIRECT_URL` in `.env` and skip `db:local`.
You can browse the local database with any client (e.g. pgAdmin): host `localhost`, port `5433`, database
`ayava_intern_os`, user `ayava`, password `ayava-local-dev`.

### Signing in

Sign-in uses Supabase Auth. Create a Supabase project, put its keys in `.env` and configure the redirect URL as
described in [docs/authentication.md](docs/authentication.md#supabase-setup-one-time). Then set `SEED_DEV_PASSWORD` and
run `npm run db:seed` to create and link the development accounts below. Without Supabase keys the app runs, but every
page redirects to a sign-in page that explains sign-in isn't configured.

### Seed accounts (development only)

| Email                        | Role        |
| ---------------------------- | ----------- |
| admin@ayavacreatives.com     | Super Admin |
| hr@ayavacreatives.com        | HR          |
| manager@ayavacreatives.com   | Manager     |
| mentor@ayavacreatives.com    | Mentor      |
| intern@ayavacreatives.com    | Intern      |
| marketing.manager@ayavacreatives.com | Manager (Marketing interns) |
| design.mentor@ayavacreatives.com     | Mentor (Design interns)     |

Plus seven fictional demo interns (`*@demo.ayavacreatives.com`) covering every lifecycle state, four onboarding
templates and sample policies. No passwords exist in this database: with
`SEED_DEV_PASSWORD` and the Supabase service-role key set, the seed creates matching Supabase Auth users with that
password (development only). Demo data and accounts are skipped entirely when `NODE_ENV=production`; production starts
with `npm run admin:invite` (below).

## Commands

| Command                     | Purpose                                                        |
| --------------------------- | -------------------------------------------------------------- |
| `npm run dev`               | Development server                                             |
| `npm run build` / `start`   | Production build / serve                                       |
| `npm run lint`              | ESLint                                                         |
| `npm run typecheck`         | Generate route types and run `tsc --noEmit`                    |
| `npm run format`            | Prettier                                                       |
| `npm test`                  | Unit tests                                                     |
| `npm run test:integration`  | Integration tests (rebuilds the `TEST_DATABASE_URL` database)  |
| `npm run test:e2e`          | Playwright end-to-end tests                                    |
| `npm run db:local`          | Local PostgreSQL (development)                                 |
| `npm run db:migrate`        | Create/apply migrations in development                         |
| `npm run db:migrate:deploy` | Apply migrations in staging/production                         |
| `npm run db:seed`           | Seed reference data (+ demo data outside production)           |
| `npm run db:reset`          | Drop, re-migrate and re-seed the development database          |
| `npm run db:studio`         | Prisma Studio                                                  |
| `npm run admin:invite`      | Print a one-time Super Admin invitation link (bootstrap)       |
| `npm run jobs:daily`        | Ending-soon and overdue-onboarding jobs (also `POST /api/jobs/daily`) |
| `npm run test:e2e:local`    | All E2E suites without Supabase (mock Auth, separate database) |

## Testing

- **Unit** (`tests/unit`): authorization engine and scopes, role matrix, scope-aware navigation, password policy,
  open-redirect protection, CSP, validation, errors, logging redaction, uploads, storage, config.
- **Integration** (`tests/integration`): real PostgreSQL. Global setup drops the test database, applies every migration
  and seeds it. Covers schema, constraints, RLS, isolation, the sign-in/logout/reset/verification flows and account
  states (with an in-memory auth provider), the spec's authorization matrix, privilege escalation, IDOR, invitations,
  sessions, rate limiting and audit. Phase 03 adds intern creation (transactions, concurrent employee codes,
  duplicates), lifecycle rules and jobs, onboarding, documents, manager/mentor/intern scope, IDOR and mass assignment.
  Refuses any database whose name lacks `test`.
- **End-to-end** (`tests/e2e`): public checks always run (route protection, 401s, auth pages, accessibility, CSP and
  headers). Signed-in checks (navigation, roles, logout/back button, multi-tab, profile, security, users) run once
  Supabase keys and `SEED_DEV_PASSWORD` are set; otherwise they are reported as skipped. `npm run test:e2e:local` runs
  them all against a mock Auth server instead (including the Phase 03 intern lifecycle flow).
  Use `npx playwright install chromium` or `PLAYWRIGHT_CHANNEL=msedge`.

## Deployment

1. Provision PostgreSQL (Supabase recommended). Set `DATABASE_URL` (pooled) and `DIRECT_URL` (direct) — see
   `.env.example`.
2. Set `NODE_ENV=production`, `NEXT_PUBLIC_APP_URL`, the Supabase keys (a **separate** Supabase project from
   development) and email delivery (`EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM`). Do **not** set
   `SEED_DEV_PASSWORD`. In Supabase, set the Site URL and add `https://<your-domain>/auth/confirm` as a redirect URL.
3. `npm ci && npm run db:migrate:deploy && npm run db:seed && npm run build && npm start` (the seed only writes
   reference data in production). Works on Vercel, Railway, Render or any Node host.
   Set `CRON_SECRET` and call `POST /api/jobs/daily` once a day (`Authorization: Bearer $CRON_SECRET`) for the
   ending-soon and overdue-onboarding jobs.
4. Create the first Super Admin: `npm run admin:invite -- --email you@company.com --first Name --last Surname`, open
   the printed link, set a password. Invite everyone else from **Users**.

## Security

Secrets live only in environment variables. No passwords in application tables; httpOnly session cookies; every
server entry point authenticates, validates, checks permission **and scope**, and audits; out-of-scope records return
404; rate limits are shared across instances; row-level security blocks Supabase's public API; nonce-based CSP and
hardening headers. See [docs/security.md](docs/security.md), [docs/authentication.md](docs/authentication.md) and
[docs/authorization.md](docs/authorization.md).

## Roadmap

| Prompt | Scope                                                                     |
| ------ | ------------------------------------------------------------------------- |
| 01     | **Foundation** — done                                                     |
| 02     | **Authentication, RBAC & security** — done                                |
| 03     | **Intern management, HR directory & onboarding** — done                   |
| 04     | Projects, tasks, submissions and reviews, calendar                         |
| 05     | HR operations: attendance, leave, documents, learning                     |
| 06     | Communication and performance: announcements, messages, notifications, reviews |
| 07     | AYAVA AI and knowledge base (RAG)                                         |
| 08     | Analytics and certificates                                                |
| 09     | System administration: audit log tools, settings, role editor             |
| 10     | Polish and launch                                                         |

## Documentation

[Architecture](docs/architecture.md) · [Database](docs/database.md) · [Authentication](docs/authentication.md) ·
[Authorization](docs/authorization.md) · [Security](docs/security.md) · [Development](docs/development.md) ·
[Intern management](docs/intern-management.md) · [Onboarding](docs/onboarding.md)

Internal use only — Ayava Creatives.

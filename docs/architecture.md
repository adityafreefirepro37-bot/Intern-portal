# Architecture

## Principles

1. **UI never contains business logic or database access.** Pages call services; services call repositories.
2. **Permissions are data.** Code asks "may this actor do `task.review`?", never "is this user a Manager?".
3. **Every query is tenant-scoped.** The organization comes from the server-resolved request context, never from client
   input.
4. **Validate at every trust boundary** with Zod: form data, JSON bodies, query strings, route params, uploaded files.
5. **No fake functionality.** Unbuilt features render an explicit "Phase NN" placeholder or a disabled control.

## Request flow

```text
Browser
  │
  ▼
Page (Server Component) ─┐        Route Handler (src/app/api)      Server Action (defineAction)
                         └──────────────┬───────────────────────────────────┘
                                        ▼
                         parseInput(schema, raw)            src/lib/validation
                                        ▼
                         getRequestContext()                src/server/context.ts
                           identity (auth provider) → users row → roles → permissions
                                        ▼
                         authorizationService.require()     src/server/services/authorization.service.ts
                                        ▼
                         xxxService.method(ctx, input)      src/server/services
                                        ▼
                         xxxRepository.query(orgId, …)      src/server/repositories
                                        ▼
                         PostgreSQL                          constraints, RLS, indexes
```

Errors thrown anywhere become the standard envelope via `toErrorBody()` (`src/lib/errors`):

```json
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "Invalid input", "fields": { "q": "…" } } }
```

Only `AppError`s with safe messages are shown; anything else becomes `INTERNAL_ERROR` with a generic message and is
logged server-side.

## Request context and authentication

`src/server/context.ts` is the single place that answers *who is acting, in which organization, with which
permissions*:

- The auth provider (`src/lib/auth/provider.ts`, Supabase Auth via server-only `@supabase/ssr`) supplies the session.
- The session's `authUserId` maps to `users.auth_user_id`; account status, roles, grants **and scopes** are loaded from
  our database. Swapping auth providers never touches services.
- `getAuthState()` classifies the request (authenticated, unauthenticated, session expired/revoked, suspended,
  inactive, email unverified, profile incomplete) and records the session; it calls `connection()` so identity-based
  pages are always rendered per request.
- Pages use `requirePageContext()` (redirects); route handlers and actions use `requireApiContext()` (401/403).
- `src/proxy.ts` refreshes sessions, sets the nonce CSP and redirects signed-out visitors — an optimization, not the
  security boundary.

See [authentication.md](authentication.md).

## Authorization layers

1. **Authentication** — the context above.
2. **Organization** — every scope filter pins `organization_id`; ids from other tenants resolve to 404.
3. **Role → permission** — `authorizationService.require(ctx, 'intern.read')` returns the granted scope (403 if absent).
4. **Resource scope** — `src/server/repositories/scope.ts` turns the scope (own / assigned / team / department /
   organization) into query filters used for lists and single records; `src/lib/permissions/engine.ts` is the pure
   equivalent for in-memory decisions.

See [authorization.md](authorization.md).

## Services

| Service                | Responsibility (Phase 01)                                              |
| ---------------------- | ---------------------------------------------------------------------- |
| `authorizationService` | permission checks, organization guard                                  |
| `auditService`         | append-only audit trail (`log`, `logForContext`, `listPage`)           |
| `dashboardService`     | overview figures and lists, shaped to the viewer's permissions         |
| `internService`        | intern list and counts                                                 |
| `projectService`       | project list with task-based progress                                  |
| `taskService`          | task list, counts, upcoming deadlines, status breakdown                |
| `learningService`      | course catalog                                                         |
| `announcementService`  | active announcements                                                   |
| `organizationService`  | departments, teams, positions                                          |
| `searchService`        | global search via per-entity, permission- and scope-gated providers    |
| `authService`          | sign-in/out, password reset/change, verification, email-link exchange  |
| `sessionService`       | the user's own sessions: list, revoke one, revoke others               |
| `userService`          | user admin (roles, status) with escalation guards; self-service profile |
| `invitationService`    | hashed single-use invitations, acceptance                              |
| `rateLimitService`     | PostgreSQL-backed limits for sensitive operations                      |
| `emailService`         | invitation email (Resend)                                              |

Each later phase adds `create / update / delete / workflow` methods to these services (or new services) following the
same pattern, and wraps mutations with `defineAction()` (`src/server/actions/define-action.ts`).

## Global search

`searchService` aggregates `SearchProvider`s (`intern`, `task`, `project`, `course`, `announcement`). Each declares the
permission it needs and only runs for users who hold it. The command menu (Ctrl/⌘+K) calls `GET /api/search?q=` and
also offers page navigation. Documents join in Prompt 05; smarter ranking or full-text search can replace a provider
without changing callers.

## Storage

`StorageService` (`src/lib/storage`) validates uploads (allowlisted MIME per category, extension match, file signature,
size), generates the storage key (`{orgId}/{category}/{year}/{uuid}.{ext}` — never the user's filename) and delegates
bytes to a provider: `LocalStorageProvider` (development) or `SupabaseStorageProvider` (private bucket). Storage paths
are re-validated on read/delete to prevent traversal.

## Logging and audit

- `logger` (`src/lib/logging`) writes one JSON object per line and recursively redacts keys such as `password`, `token`,
  `apiKey`, `authorization`, `cookie`, `date_of_birth`.
- `auditService.log()` records who did what to which resource. It is server-only, redacts metadata, and never breaks
  the calling operation if the write fails. Audit rows survive user deletion (`actor_user_id` → `NULL`).

## UI architecture

- **Server Components by default.** Pages fetch through services and render; lists use URL search params for filters
  and pagination (linkable, work without JavaScript).
- **Client Components only where interaction requires it:** the shell (sidebar collapse, drawer), command menu, toasts,
  dialogs, forms.
- **Shell:** desktop = collapsible sidebar (state in a cookie, so no layout shift) + sticky topbar; mobile = header,
  bottom navigation and a slide-in drawer.
- **Design system:** semantic tokens in `src/app/globals.css` (light + dark), type scale utilities (`text-display`,
  `text-h1` … `text-label`), shared components in `src/components`. See the development-only gallery at
  `/dev/components`.

## Error, loading and empty states

`app/global-error.tsx` (root), `app/(dashboard)/error.tsx` (route errors with retry and a reference digest),
`app/(dashboard)/loading.tsx` (skeleton), `app/not-found.tsx`, plus `EmptyState`, `ErrorState`, `LoadingState` and
`AccessDenied` components.

## Extending the system (checklist for later prompts)

1. Add/adjust models in `prisma/schema.prisma`; run `npm run db:migrate -- --name <change>`; add CHECK constraints in
   the generated SQL if needed.
2. Add permissions to `src/lib/permissions/catalog.ts` and grant them in `DEFAULT_ROLE_GRANTS`; re-run the seed.
3. Repository → service (permission + tenant + record scope) → action/route (`defineAction`, Zod schema) → UI.
4. Call `auditService` for important state changes.
5. Add unit tests for rules and integration tests for service behaviour and isolation.

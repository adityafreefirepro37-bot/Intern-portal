# Security

How the application is protected, and what is still planned. Hiding something in the UI is never treated as
security: every page, route handler and server action checks access on the server.

Details: [authentication.md](authentication.md) (identity, sessions) · [authorization.md](authorization.md)
(roles, permissions, scopes, isolation).

## Authentication and sessions

- Supabase Auth verifies credentials. The application database stores **no passwords, hashes or reset tokens**
  (an integration test asserts no `password` column exists).
- All auth runs on the server; session cookies are `httpOnly`, `SameSite=Lax`, `Secure` in production. No tokens in
  `localStorage`/`sessionStorage`. No Supabase key is exposed to the browser.
- Successful sign-in is not enough: the application account must be active, have a profile and (by default) a verified
  email. Suspension takes effect on the user's next request; sessions are revoked and the user is banned at the
  provider so tokens can't be refreshed.
- Generic sign-in errors (no account enumeration); password-reset requests always get the same answer.
- Open-redirect protection on post-login destinations (`safeNextPath`).

## Authorization

- Permissions and scopes are data (`roles`, `permissions`, `role_permissions`, `user_roles`), resolved per request.
  Code checks permissions, never role names or email addresses.
- Every query is scoped to the actor's organization and to the scope of their grant. Out-of-scope or cross-tenant
  records return 404, so their existence isn't revealed (IDOR protection).
- Privilege-escalation defences: no self role/status changes; role ranks bound what can be assigned and who can be
  managed; the last Super Admin can't be removed; strict schemas reject smuggled `organization_id`, `role_id`,
  `permission_id`, status or manager fields.
- Intern records (Phase 03): one resolver (`intern-access.ts`) decides per-viewer capabilities; profile responses are
  purpose-built DTOs (masked phone and no emergency contacts for managers/mentors, no personal data for mentors);
  intern self-edit is limited to bio/phone/location; status changes go through one guarded service with optimistic
  concurrency; HR overrides require a reason and are audited.
- Work (Phase 04): `work-access.ts` combines RBAC with project membership; nobody reviews their own submission;
  interns can’t assign, approve or open projects they aren’t on; bulk actions authorize each task; mentions only
  notify task participants; comment text is rendered as text.

## CSRF

State changes happen only through Server Actions (POST). Next.js rejects Server Action calls whose `Origin` doesn't
match the host, and session cookies are `SameSite=Lax`. There are no cookie-authenticated mutating route handlers; the
only GET that clears a session (`/auth/signout`) refuses to sign out a valid session. `src/lib/security/csrf.ts`
(origin + double-submit token) is available if a mutating route handler is ever added.

## Rate limiting

PostgreSQL-backed fixed-window counters (`rate_limit_buckets`, atomic upsert), so limits hold across multiple
instances. Keys are hashed — raw IPs and emails aren't stored. Limits (`src/lib/security/rate-limit.ts`): sign-in per
IP 50/15 min and per account 8 failures/15 min; password reset 5/hour per IP and per email; password change 5/15 min;
verification resend 5/hour; invitation create 30/hour per admin; invitation accept 10/15 min per IP.

## Input validation and output safety

- Zod validates every server input: bodies, form data, query strings, route params, IDs (UUIDs), dates, filters.
  Malformed URL filters are ignored rather than trusted.
- Errors are sanitized: users see safe messages; unexpected errors become `INTERNAL_ERROR` (no stack traces, SQL,
  paths or tokens). Codes: 401, 403, 404, 422, 429, 500.
- React escapes all rendered content; `dangerouslySetInnerHTML` is not used anywhere. Emails escape HTML.
- Sensitive fields are selected explicitly and masked or omitted on the server when the viewer isn't authorized
  (e.g. phone numbers for managers).

## HTTP headers

- **Content-Security-Policy** set per request by `src/proxy.ts` with a fresh nonce: scripts only with the nonce
  (`'strict-dynamic'`, no `'unsafe-inline'`; `'unsafe-eval'` in development only), `frame-ancestors 'none'`,
  `object-src 'none'`, `base-uri`/`form-action 'self'`. Styles allow `'unsafe-inline'` (React style attributes).
  Verified in E2E: no CSP violations in development or production builds.
- `Strict-Transport-Security` (production), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`; no
  `X-Powered-By`.

## Database

- Parameterized queries only (Prisma; the one raw query is a tagged template).
- CHECK/UNIQUE/FK constraints enforce integrity; historical records use `RESTRICT`.
- Row-level security enabled on every table with no policies: Supabase's `anon`/`authenticated` REST roles are denied.

## Files

Uploads are validated server-side for type, extension, file signature (magic bytes) and size, stored under generated
keys (never the user's filename), and re-validated on read/delete. Avatars are served only to signed-in members of
the same organization, and only the user's current avatar.

Intern documents (Phase 03) are private: there are no public URLs. `GET /api/documents/:id` checks access to the
intern **and** the document's visibility level (INTERN / MANAGER / HR / ADMIN — ADMIN needs `document.restricted`)
and answers 404 for anything hidden. Responses are `attachment` by default, `private, no-store`, `nosniff`, with a
sandboxing CSP. Interns can't choose visibility (ID documents default to HR-only). Deletes are soft and audited.

Task attachments and project files (Phase 04) follow the same rules: validated uploads, private storage, and
authorized downloads (`/api/tasks/attachments/:id`, `/api/projects/files/:id`) that answer 404 unless the viewer can see
the task or project. Files submitted for review are part of the permanent history and can’t be deleted.

Scheduled jobs (`POST /api/jobs/daily`) require `Authorization: Bearer $CRON_SECRET` (constant-time comparison) and
are disabled (404) when the secret isn't set.

## Audit and logging

- Security events are written server-side to `audit_logs` with actor, organization, action, resource, **status**
  (success/failure/denied), IP and user agent: sign-in success/failure, logout, password reset requested/completed,
  password changed, email verified, invitations, user created/updated/suspended/reactivated/deactivated, role changed,
  session revoked, access denied. Admins filter them at **Audit Logs**.
- Passwords, tokens and invitation links are never logged; emails in security metadata are masked. The logger
  redacts sensitive keys at any depth.

## Secrets

Environment variables only; `.env*` is git-ignored except `.env.example` (placeholders). `server-only` modules fail
the build if imported by client code. The `settings` table never holds secrets. Development accounts and
`SEED_DEV_PASSWORD` are development-only; production uses a separate Supabase project and seeds reference data only.

## Production checklist

- [ ] `NODE_ENV=production`; `SEED_DEV_PASSWORD` unset; separate Supabase project
- [ ] Supabase keys and database URLs from a secret manager; database over TLS
- [ ] `npm run db:migrate:deploy`, then `npm run db:seed` (reference data only)
- [ ] Email delivery configured and tested with `npm run email:test` (required for invitations in production);
      custom SMTP set in Supabase for password-reset emails
- [ ] Supabase Site URL / Redirect URLs set to the production domain
- [ ] HTTPS enforced (HSTS is sent automatically)
- [ ] Create the first Super Admin (see docs/authentication.md) and verify sign-in
- [ ] `npm audit` reviewed

## Planned

MFA (Phase 09), security-event alerting, and automated dependency scanning in CI.

## Reporting a vulnerability

Report privately to the Ayava Creatives engineering team. Do not disclose publicly before a fix is available.

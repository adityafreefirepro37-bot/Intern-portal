# Authentication

**Who are you?** Supabase Auth answers that. Everything that decides *what you may do* (organization, account status,
roles, permissions) lives in our database and is covered in [authorization.md](authorization.md).

## Architecture

```text
Browser ──POST (server action)──▶ authService ──▶ AuthProvider (Supabase Auth)
   ▲                                    │
   │ httpOnly session cookies           ├─ rate limit (PostgreSQL buckets)
   │                                    ├─ application account checks (users table)
   └──────── src/proxy.ts ◀─────────────┴─ audit log, session record
             refreshes the session on every request
```

- **No browser Supabase client.** Every auth call runs on the server (server actions, route handlers, proxy). Session
  cookies are therefore `httpOnly`, `SameSite=Lax` and `Secure` in production — page scripts can never read tokens, and
  nothing is stored in `localStorage`/`sessionStorage`. All three Supabase keys are server-only environment variables.
- **Provider boundary.** Services depend on the `AuthProvider` interface (`src/lib/auth/provider.ts`), implemented by
  `SupabaseAuthProvider`. Tests substitute an in-memory provider; the rest of the app never imports Supabase directly.
- **Identity link.** `users.auth_user_id` = Supabase `auth.users.id`. Passwords never touch our database.

## Resolving the current user

`getAuthState()` / `getCurrentUser()` in `src/server/context.ts`, memoized per request:

1. Read the session from the provider (`getClaims()` verifies the JWT).
2. Load the application user by `auth_user_id`, with roles, grants and scopes.
3. Classify the account and return one of:

| State | Meaning | Where the browser goes |
| ----- | ------- | ---------------------- |
| `AUTHENTICATED` | Valid session, active profile, email verified | The requested page |
| `UNAUTHENTICATED` | No session | `/login?next=…` |
| `SESSION_EXPIRED` | Session revoked by the user/admin, or refresh failed | `/auth/signout` → `/login?reason=session_expired` |
| `EMAIL_UNVERIFIED` | Email not confirmed (when `AUTH_REQUIRE_EMAIL_VERIFICATION=true`) | `/verify-email` |
| `ACCOUNT_SUSPENDED` | `users.status = SUSPENDED` | `/account-status` |
| `ACCOUNT_INACTIVE` | `INACTIVE` or soft-deleted | `/account-status` |
| `PROFILE_INCOMPLETE` | Signed in at the provider but no active profile (or still `INVITED`) | `/account-status` |

`LOADING` is the route `loading.tsx` skeleton; `ERROR` is the route error boundary. Successful authentication at the
provider never implies application access.

- Pages call `requirePageContext()` (redirects); route handlers and server actions call `requireApiContext()`
  (401 `UNAUTHENTICATED` / 403 `FORBIDDEN`). The dashboard layout resolves the user **before** rendering, so private
  content never flashes.
- `src/proxy.ts` refreshes sessions and redirects signed-out visitors (401 JSON for `/api/*`). It is an optimization
  only — every page, handler and action checks again.

## Flows

| Flow | Entry point | Notes |
| ---- | ----------- | ----- |
| Sign in | `/login` → `signInAction` | Rate-limited per IP (50/15 min) and per account (8 failures/15 min). One generic message for wrong password and unknown email. Suspended/inactive/missing-profile accounts are signed out again and told why (only after the password matched). Post-login redirect is restricted to same-site paths (`safeNextPath`). |
| Sign out | Account menu → `signOutAction` (POST) | Ends the provider session, marks the session record revoked, audits `auth.logout`. Protected pages are dynamic and re-check on every request, so Back/refresh/other tabs return to `/login`. |
| Forgot password | `/forgot-password` | Always answers "If an account exists…". Rate-limited per IP and per email (5/hour). The provider emails the link. |
| Reset password | Email link → `/auth/confirm` → `/reset-password` | The link creates a short-lived recovery session. New password is policy-checked; all other sessions are signed out. Expired/invalid links show a clear message. |
| Change password | `/security` | Requires the current password (verified without touching the session); other sessions are signed out. |
| Email verification | Supabase confirmation email → `/auth/confirm` | Marks `users.email_verified_at`. `/verify-email` can resend (rate-limited). |
| Invitation | Admin/HR → `/users` → email or dev link → `/invite/{token}` | See [authorization.md](authorization.md#invitations). |
| Sessions | `/security` | Lists sessions seen by the app (device, IP, first/last seen). Revoke one (rejected on its next request) or all others (also revokes the provider refresh tokens). |

### Password policy

`src/lib/auth/password-policy.ts` (NIST 800-63B style): at least `AUTH_PASSWORD_MIN_LENGTH` characters (default 10),
at most 128, not a common password, not mostly one character, not containing the email name or first name. No
arbitrary symbol rules. The form shows live strength; the server decision is final.

### Session revocation

Supabase doesn't expose per-session revocation for other devices, so the app records every session it sees
(`user_sessions`, keyed by the JWT `session_id`). Revoking marks the row; `getAuthState()` then treats that session as
expired on its next request and the browser is signed out. Suspension/deactivation revokes all rows **and** bans the
user at Supabase (requires the service-role key) so tokens can't be refreshed.

## Supabase setup (one time)

1. Create a project at supabase.com (a separate project for production).
2. **Project Settings → API Keys:** copy the project URL, the publishable key (legacy: `anon`) and the secret key
   (legacy: `service_role`) into `.env` as `SUPABASE_URL`, `SUPABASE_ANON_KEY` (or `SUPABASE_PUBLISHABLE_KEY`) and
   `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SECRET_KEY`). Never commit them.
3. **Authentication → URL Configuration:** Site URL `http://localhost:3000` (your domain in production); add
   `http://localhost:3000/auth/confirm` to Redirect URLs.
4. **Authentication → Providers → Email:** keep "Confirm email" on. Keep sign-ups enabled — invitation acceptance
   creates the account through sign-up. Accounts created outside an invitation have no profile and get no access.
5. *(Recommended)* **Authentication → Email Templates:** make links work across devices by pointing them at our
   confirm route, e.g. Reset password: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password`,
   Confirm signup: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup&next=/`. The default templates
   also work, in the same browser.
6. Run `npm run db:seed` with `SEED_DEV_PASSWORD` set to create and link the development accounts.

## Development accounts

`npm run db:seed` (not in production) creates the five development profiles. With `SEED_DEV_PASSWORD` and the
service-role key set, it also creates matching Supabase users with that password and links them. The password is
generated per developer in `.env`, never committed, and never used in production: production seeding writes reference
data only, and production must use a separate Supabase project.

## First Super Admin in production

Production seeding creates no people. Bootstrap the first administrator from a trusted terminal:

```bash
npm run admin:invite -- --email you@company.com --first Name --last Surname
```

It prints a one-time, expiring invitation link (stored only as a hash) to that terminal. The recipient opens it, sets a
password and confirms their email; everyone else is then invited from **Users**.

## Environment variables

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `AUTH_REQUIRE_EMAIL_VERIFICATION` (default `true`),
`AUTH_PASSWORD_MIN_LENGTH` (default `10`), `INVITATION_TTL_HOURS` (default `168`), `EMAIL_PROVIDER`/`EMAIL_API_KEY`/
`EMAIL_FROM` (invitation email), `SEED_DEV_PASSWORD` (development only).

## Not yet available

Multi-factor authentication (UI marks it as Phase 09), social sign-in, and self-service email change.

# Authorization

**What may you do?** Decided on the server, from data, for every request.

```text
USER → ORGANIZATION → ROLE(S) → PERMISSION + SCOPE → RESOURCE → ACTION
```

## Model

- **Permissions** — global catalog of `resource.action` keys (`src/lib/permissions/catalog.ts`, seeded to
  `permissions`).
- **Roles** — per organization (`roles`), with a **rank** used to prevent privilege escalation. Six system roles are
  seeded and flagged `is_system_role`.
- **Grants** — `role_permissions(role, permission, scope)`. The **scope** says how far the grant reaches:

| Scope | Covers |
| ----- | ------ |
| `OWN` | Records about the actor (their profile, attendance, leave, documents…) |
| `ASSIGNED` | + interns the actor manages or mentors, and work assigned to the actor or those interns |
| `TEAM` | + interns in teams the actor leads |
| `DEPARTMENT` | + interns in departments the actor heads |
| `ORGANIZATION` | Everything in the actor's organization |

A user's effective permissions are the union of their roles' grants, keeping the broadest scope per permission.
Changing a grant in the database changes behaviour on the next request — no deploy.

### Specification name mapping

The catalog uses singular, snake_case resources (enforced by a database CHECK). Spec names map as:
`users.*` → `user.*`, `roles.*` → `role.*`, `permissions.*` → `permission.*`, `intern.profile.*` →
`intern_profile.*`, `attendance.correction.*` → `attendance_correction.*`, `certificate.create` issues certificates.
Additions: `user.invite`, `user.suspend`, `user.assign_role`, `task.comment`, `learning.track`, `leave_type.manage`,
`position.*`, `meeting.*`, `message.*`, `channel.manage`, `certificate.revoke`.

## Default role matrix (least privilege)

| Area | Super Admin | Admin | HR | Manager | Mentor | Intern |
| ---- | ----------- | ----- | -- | ------- | ------ | ------ |
| Roles & permissions (edit) | ✔ | view | view | — | — | — |
| Users (invite, suspend, assign role) | ✔ | ✔ | ✔ (below HR) | — | — | — |
| Interns, profiles, internships, onboarding | org | org | org | assigned (read) | assigned (read) | own profile |
| Attendance, leave (approve), documents | org | org | org | assigned | — | own |
| Projects & tasks | org | org | org (manage/review) | read org; manage/assign/review in projects they lead | create/assign/review where they mentor | own & member projects (work/submit) |
| Feedback, check-ins | org | org | org | assigned | assigned | own |
| Performance reviews | org | org | org (read/sign-off) | assigned (write) | — | own (read) |
| Courses | ✔ | ✔ | ✔ (author) | read | read | read / track own |
| Announcements | ✔ | ✔ | publish | publish | read | read |
| Analytics | ✔ | ✔ | ✔ | — | — | — |
| Audit & security logs | ✔ | ✔ | — | — | — | — |
| Organization settings (edit) | ✔ | ✔ | view | — | — | — |

Work permissions combine the grant with project membership (lead/mentor/member) — see
[work-management.md](work-management.md#authorization).

The exact grants are in `DEFAULT_ROLE_GRANTS` and on **Settings → Roles & permissions** in the app. Managers do not
get organization-wide HR data; mentors don't see performance or documents; interns don't see anyone else's records.

## Enforcement

Every server entry point follows the same steps:

1. **Authenticate** — `requireApiContext()` / `requirePageContext()` (see [authentication.md](authentication.md)).
2. **Validate input** — Zod (`parseInput`), strict schemas where the client could smuggle fields.
3. **Resolve organization** — always from the context, never from input.
4. **Check permission** — `authorizationService.require(ctx, 'intern.read')` returns the granted scope.
5. **Check resource scope** — list and single-record queries use the scope filters in
   `src/server/repositories/scope.ts` (`internScope`, `taskScope`, `projectScope`, `userScope`), which also pin the
   organization. The pure engine `authorize()` / `withinScope()` in `src/lib/permissions/engine.ts` applies the same
   rules to in-memory facts.
6. **Perform the operation.**
7. **Audit** — security-relevant events via `auditService`; denials are recorded as `access.denied`.
8. **Return sanitized data** — explicit selects; sensitive fields filtered or masked server-side.

**Error semantics:** missing permission → `403`; out-of-scope or other-organization record → `404` (existence is not
revealed); malformed input → `422`; not signed in → `401`; rate limited → `429`.

**UI:** navigation, buttons and dashboard sections use the same permissions for UX ("My Tasks" when the scope is
narrower than the organization). This is never the security boundary.

## Privilege-escalation defences

- Nobody changes their own role or status.
- An actor may only assign roles ranked **below** their highest role, and only manage users ranked below them —
  except holders of the owner-level permission (`permission.manage`, Super Admin by default), who may manage peers.
- The organization always keeps at least one active owner-level user.
- `role_id`, `user_id`, `intern_id` and invitation/session ids are looked up inside the actor's organization (and
  scope), so foreign ids resolve to 404. `organization_id`, `permission_id`, status, manager or role fields sent to
  self-service endpoints are rejected by strict schemas.
- System roles can't be edited from the app yet; custom-role editing (Phase 09) will be limited to `role.update`.

## Sensitive data

| Class | Examples | Who receives it |
| ----- | -------- | --------------- |
| Public (in org) | name, avatar, role, department | any signed-in member where relevant |
| Internal | email, placement, manager/mentor | users with the matching read permission in scope |
| Confidential | phone, address, date of birth, emergency contacts | the person; organization-wide `intern_profile.read` (HR/Admin). Others get a **masked** value (`••••••3210`) computed on the server, or nothing |
| Restricted | ID documents, bank details (future) | document/HR permissions only; never sent without authorization |

Masking helpers: `src/lib/security/masking.ts`. Services select only the fields a view needs.

## Invitations

`invitationService` (`/users` → Invite):

- Requires `user.invite`; the role must be assignable by the inviter.
- Creates (or reuses) the profile as `INVITED` with that role, and an invitation holding only the **SHA-256 hash** of a
  32-byte random token. Newer invitations revoke older ones.
- Delivery: email via Resend when configured. In development without email, the link is shown **once** to the
  inviting admin (never logged); production refuses to create invitations without email delivery.
- Acceptance (`/invite/{token}`) is rate-limited, checks the password policy, **atomically claims** the invitation
  (single use, unexpired, unrevoked), creates the Supabase account (confirmation email sent when enabled) and activates
  and links the profile. Audited as `invitation.created` / `invitation.accepted` / `invitation.revoked`.

## Row-level security

RLS is enabled with no policies on every table, so Supabase's `anon`/`authenticated` REST roles can't access data. The
application connects as the table owner and enforces everything above. RLS here is defence in depth, not a substitute
for application authorization.

## Tests

`tests/unit/authorization.test.ts`, `tests/unit/permissions.test.ts` (engine, scopes, matrix, navigation) and
`tests/integration/access-control.test.ts` (the spec's allow/deny matrix, escalation attempts, IDOR, invitations) —
all against the real database.

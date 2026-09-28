# Intern management

Phase 03 covers the intern directory, intern profiles, the internship lifecycle, manager/mentor assignment, the HR
dashboard and intern documents. Onboarding has its own page: [onboarding.md](onboarding.md).

## Routes

| Route                       | Who                                   | What                                                        |
| --------------------------- | ------------------------------------- | ----------------------------------------------------------- |
| `/`                         | everyone                              | Role-aware overview (see [Dashboards](#dashboards))         |
| `/hr`                       | `intern.create`                       | HR dashboard: programme figures, attention lists, actions   |
| `/interns`                  | `intern.read`                         | Directory: search, filters, sorting, pagination (URL state) |
| `/interns/new`              | `intern.create`                       | Add intern                                                  |
| `/interns/[id]`             | in scope (see below)                  | Profile with tabs; `?tab=` selects one                      |
| `/interns/[id]/onboarding`  | in scope                              | Onboarding checklist                                        |
| `/my-interns`, `/my-mentees`| managers / mentors                    | Interns where `manager_id` / `mentor_id` is the viewer      |
| `/my-internship`            | interns                               | Redirects to the viewer's own profile (id from the session) |
| `GET /api/interns/:id`      | in scope                              | Profile view model (404 outside scope)                      |
| `GET /api/documents/:id`    | in scope + visibility                 | Streams a private document (404 if not visible)             |
| `POST /api/jobs/daily`      | `Authorization: Bearer $CRON_SECRET`  | Ending-soon and overdue-onboarding jobs                     |

Mutations are server actions in `src/server/actions/interns.ts`. They pass raw form fields to the services, which
validate, authorize and audit. The browser never decides anything.

## Lifecycle

```text
SELECTED ─▶ ONBOARDING ─▶ ACTIVE ─▶ ENDING_SOON ─▶ COMPLETED ─▶ ALUMNI
                             ▲            │
                             └────────────┘  extension (reason required)
Administrative exit: SELECTED / ONBOARDING / ACTIVE / ENDING_SOON ─▶ TERMINATED (reason required)
ALUMNI and TERMINATED are final.
```

- The table lives in `src/lib/interns/lifecycle.ts` (pure, unit-tested).
- `internLifecycleService.transitionStatus()` is the only place statuses change. It authenticates, checks the
  permission (`internship.update`, or `internship.complete` for COMPLETED/ALUMNI/TERMINATED) in scope, validates the
  transition and reason, updates the intern and internship atomically with an optimistic guard
  (`WHERE status = <from>`, so concurrent changes get a conflict), writes a lifecycle event and an audit entry,
  then emits `intern.status_changed`.
- **ONBOARDING → ACTIVE** requires every required onboarding item to be done. HR (`onboarding.manage`) can override
  with a reason, and the override is recorded in the audit metadata. Finishing onboarding never activates an intern
  automatically.
- **SELECTED → ONBOARDING** generates the checklist if none exists: the chosen template, or the best match (see
  [onboarding.md](onboarding.md#choosing-a-template)).
- COMPLETED and TERMINATED set `actual_end_date` to today in the organization's timezone. The internship record's
  own status follows (`PLANNED`, `ACTIVE`, `COMPLETED`, `CANCELLED`).
- Interns can never change their own status. The UI asks for explicit confirmation for closing transitions.

### Ending soon (scheduled)

`internLifecycleService.markEndingSoon()` moves ACTIVE interns whose expected end date is within the organization's
threshold to ENDING_SOON. The threshold is the `internship.ending_soon_days` setting (default 14). It runs from
`POST /api/jobs/daily` (cron) or `npm run jobs:daily`, **never on page load**. Each run is idempotent per intern and
end date (`intern_lifecycle_events.idempotency_key`). If HR extends an internship back to ACTIVE, the job doesn't
flip it again until the end date changes.

## Creating an intern

`internService.create()` (permission `intern.create`; `user.invite` too when sending an invitation):

1. Validates the form with a **strict** schema, so unknown fields such as `role`, `organization_id`, `permissions` or
   `employeeCode` are rejected.
2. Checks that the position, department and team belong to the organization, that the team is in that department,
   and that the manager and mentor are active staff (never interns).
3. Refuses duplicates: an email that is already an intern (including an archived record) or an active or suspended
   staff account. An invited or inactive account without an intern record is reused, not duplicated.
4. In **one transaction**: user (status INVITED, role Intern), intern with a generated employee code, profile,
   emergency contact, internship, lifecycle events, the onboarding snapshot (optional) and the invitation record
   (optional). Any failure rolls everything back.
5. After commit: audit entries (`intern.created`, `internship.created`, `intern.manager_assigned`,
   `intern.mentor_assigned`, `onboarding.created`), domain events, the invitation email, and the optional photo.
   External steps can't join the transaction, so they use compensation instead: if the email fails, the intern still
   exists, HR sees a warning, and **Resend invitation** on the profile issues a new link.

### Employee codes

`AYV-INT-0001`, `AYV-INT-0002`, … The prefix is the `intern.employee_code_prefix` setting. The number comes from an
atomic per-organization counter (`code_counters`, `INSERT … ON CONFLICT DO UPDATE … RETURNING`), never from counting
rows, so concurrent creations get distinct numbers. The counter never falls behind codes created some other way,
because it takes `GREATEST(counter + 1, highest existing + 1)`. `UNIQUE (organization_id, employee_code)` is the
final guarantee.

### Invitations

Intern invitations use the Phase 02 invitation system (hashed single-use tokens). Issuing a new invitation revokes
the previous pending one in the same transaction, and a partial unique index allows only one pending invitation per
user. Accepting activates the account, records `INVITATION_ACCEPTED` on the intern's timeline and emits
`invitation.accepted`. Expired, used or revoked links show a clear message, and HR can resend.

## Access rules

`resolveInternAccess()` (`src/server/services/intern-access.ts`) decides, once per request, how the viewer relates
to an intern and what they may see or do. Pages, services and API routes all use it.

| Viewer                   | Sees the record because                        | Contact / personal / sensitive     | Can change                                  |
| ------------------------ | ---------------------------------------------- | ---------------------------------- | ------------------------------------------- |
| The intern               | `intern_profile.read` OWN (`user_id` = me)     | own data in full                   | phone, bio, city/state/country              |
| Manager / mentor         | `intern.read` ASSIGNED (`manager_id` or `mentor_id` = me) | phone masked; education visible; no emergency contacts | onboarding items assigned to them |
| Team lead / dept head    | TEAM / DEPARTMENT scopes, if granted           | as above                           | as granted                                  |
| HR / Admin               | `intern.read` ORGANIZATION                     | everything                         | details, placement, dates, assignments, status |

- Out-of-scope and other-organization ids behave exactly like missing ones (404), so URLs can't be used to probe for
  records.
- The interns' own data is always resolved from the session (`internService.myInternId()` → `interns.user_id`). Ids from the
  URL or body are never trusted for self-service.
- The profile returns a purpose-built view model. Hidden fields are `null` or masked on the server and never sent to
  the browser.
- Manager and mentor changes use `internService.assign()`: audited, recorded on the timeline, and they move open
  onboarding items owned by the previous person. The UI requires a confirmation checkbox to replace or remove someone.

## Directory

`internService.directory()` parses untrusted URL params with a schema that falls back to safe defaults instead of
failing. It then runs one scoped, paginated query and one grouped count. Search matches name, email, employee code,
position, department and team (`ILIKE`, served by `pg_trgm` GIN indexes). Filters are status, department, team,
position, manager, mentor, and joining/end date ranges. Sorting is by name, joining date, end date, status,
department or created date. Page sizes are 25, 50 or 100. Everything lives in the URL (`/interns?status=ACTIVE&page=2`),
and search input is debounced. Phones get a card list instead of the table.

## Dashboards

`dashboardService.getInternship()` builds the internship part of `/` from permissions and relationships, not role
names:

- **Programme** (can create interns): total, active, onboarding, ending soon, upcoming joins (30 days), overdue
  onboardings.
- **My interns / My mentees** (anyone assigned as manager/mentor): progress, end dates, onboarding, open tasks.
- **My internship** (interns): status, day N of M, onboarding progress, manager, mentor, dates.

`/hr` adds programme totals, onboarding completion, the attention lists (overdue/blocked onboarding, ending soon,
upcoming joiners, recently added) and quick actions. Actions without a backing feature yet ("Review documents",
Phase 05) are disabled and labelled.

## Documents

- Upload: `documentService.upload()` validates the MIME type, extension, size and file signature. It stores the file
  privately under a server-generated key (`{orgId}/document/{year}/{uuid}.{ext}`; the original filename is kept only
  as metadata) and records `internship_documents`. Uploading can complete a DOCUMENT onboarding item; if that fails,
  the upload is rolled back.
- Visibility: `INTERN` (intern, manager, HR), `MANAGER`, `HR`, `ADMIN` (needs `document.restricted`). Interns can't
  choose visibility: ID documents default to HR-only, and everything else to `INTERN`. Mentors have no document
  access. Uploaders always see their own uploads.
- Download: only through `GET /api/documents/:id` after authorization (`private, no-store`, `nosniff`, sandboxed CSP).
  There are no public URLs.
- Delete: HR/Admin only, soft delete (`deleted_at`). Onboarding items that depended on the file reopen.

## Domain events

`src/server/events/domain-events.ts` is a small in-process bus. Services emit after commit, and handler failures are
logged without affecting the caller. Events: `intern.created`, `intern.updated`, `intern.status_changed`,
`intern.manager_assigned`, `intern.mentor_assigned`, `internship.ending_soon`, `invitation.created`,
`invitation.accepted`, `onboarding.created`, `onboarding.item_assigned`, `onboarding.item_completed`,
`onboarding.item_overdue`, `onboarding.completed`, `document.uploaded`, `document.deleted`. Notifications and email
(Prompts 05/09) subscribe with `domainEvents.on(...)`. Nothing sends email for these yet.

## Audit and timeline

Every mutation writes an audit entry (`src/server/services/audit-actions.ts`): `intern.created`, `intern.updated`,
`intern.manager_assigned`, `intern.mentor_assigned`, `intern.status_changed`, `internship.created`,
`internship.updated`, `onboarding.created`, `onboarding.completed`, `onboarding.item_completed`,
`onboarding.item_updated`, `policy.acknowledged`, `onboarding_template.created/updated`, `document.uploaded`,
`document.deleted`. Audit entries are written on the server only and never include document contents.

The profile **Activity** tab reads `intern_lifecycle_events`, which stores meaningful history (created, invited,
invitation accepted, manager/mentor assigned, onboarding started/completed, status changes, dates changed,
documents). It isn't derived from the current state.

## Services

| Service / module                       | Responsibility                                                     |
| -------------------------------------- | ------------------------------------------------------------------ |
| `internService`                        | directory, profile, create, update, assign, own profile, related interns, HR figures |
| `internLifecycleService`               | status transitions, ending-soon job, overdue-onboarding job        |
| `resolveInternAccess` / `scopeCovers`  | per-intern access decisions                                        |
| `onboardingService`, `onboardingTemplateService` | see [onboarding.md](onboarding.md)                       |
| `documentService`                      | upload, list, download, soft delete, visibility                    |
| `dashboardService.getInternship`       | role-aware dashboard sections                                      |
| `src/lib/interns/*`                    | pure rules: lifecycle table, dates, progress, employee codes       |

## Testing

- Unit (`tests/unit/interns.test.ts`): employee codes, transitions, permission mapping, organization-timezone dates,
  internship progress edge cases (future start, same day, overrun, completed, terminated), onboarding progress and
  overdue rules, strict schemas (mass assignment), scope coverage.
- Integration (`tests/integration/interns.test.ts`): the acceptance scenario (create John Doe → invitation → sign in
  → onboarding → manager view → mentor change → status change), transaction rollback, concurrent employee codes,
  duplicate prevention (database constraints), lifecycle rules and jobs, onboarding completion, policy
  acknowledgements, template snapshots, documents and visibility, IDOR, manager/mentor/intern scope, mass
  assignment, audit entries.
- End-to-end (`tests/e2e/app/interns.spec.ts`): the same scenario in a browser, plus HR screens, mentor scope,
  accessibility and phone layouts. `npm run test:e2e:local` runs it without Supabase (mock Auth server).

## Known limitations

- Interns can't be archived (soft-deleted) from the UI yet. Exits use the TERMINATED status, and records are never
  hard-deleted.
- Policies (handbook, NDA) have no editor yet (Phase 05 documents). Development seeds sample policies. Production
  needs policies inserted before templates can include acknowledgement items.
- Domain events are in-process. Events that must survive restarts are persisted separately (audit log, lifecycle
  events).
- Pages rendered inside the streaming dashboard layout show "Page not found" with HTTP 200 for out-of-scope ids. API
  routes return a real 404.

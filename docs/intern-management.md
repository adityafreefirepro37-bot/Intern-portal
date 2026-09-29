# Intern management

Phase 03 covers the HR side of the internship programme: the intern directory, adding interns, profiles,
manager/mentor assignment, the status lifecycle, documents, and the HR, manager and mentor dashboards.
Onboarding is described in [onboarding.md](onboarding.md).

## Pages

| Route | Who | What |
| --- | --- | --- |
| `/hr` | HR / Admin (`intern.create`) | Programme totals, onboarding needing attention, ending soon, upcoming joiners, recently added |
| `/interns` | `intern.read` with TEAM scope or wider | Directory: stats, debounced search, filters, sort, 25/50/100 rows, cards on mobile. All state is in the URL. Interns are redirected to their own profile. |
| `/interns/new` | `intern.create` | Add intern (one transactional workflow, below) |
| `/interns/[id]` | Anyone whose scope covers the record | Tabbed profile (`?tab=`): Overview, Internship, Onboarding, Tasks, Projects, Attendance, Leave, Learning, Performance, Documents, Activity |
| `/interns/[id]/onboarding` | Same | Full onboarding checklist |
| `/my-interns` · `/my-mentees` | Managers · mentors | Cards for interns where `manager_id` / `mentor_id` is you |
| `/my-internship` | Interns | Redirects to your own profile (resolved from the session) |
| `/` | Everyone | Role-aware: interns see their internship and onboarding; managers/mentors see summaries |

Navigation is permission- and relationship-aware (`src/config/navigation.ts`): "Interns" needs TEAM scope or
wider, "My Interns"/"My Mentees" appear only if you manage/mentor someone, "My Internship" only for interns.

## Access model

`resolveInternAccess(ctx, internId)` (`src/server/services/intern-access.ts`) is the single place that decides
what a viewer may see and do for one intern. It loads the record through the scope filter of the wider of
`intern.read` / `intern_profile.read` — out-of-scope and other-organization ids are **404**, indistinguishable
from missing ones — and returns `can.*` flags:

| Flag | Rule |
| --- | --- |
| `seeContact`, `seeSensitive` | Self, or organization-wide `intern_profile.read` (HR/Admin). Others get a masked phone and no emergency contacts. |
| `seePersonal` | Self, or `intern_profile.read` covering the record |
| `editDetails`, `assignPeople` | `intern.update` covering the record (never self) |
| `editSelfProfile` | Self with `intern_profile.update` — bio, phone, city/state/country only |
| `transition` / `close` | `internship.update` / `internship.complete` |
| `manageOnboarding` / `viewOnboarding` | `onboarding.manage` / `onboarding.read` |
| `viewDocuments`, `uploadDocuments`, `deleteDocuments` | `document.read` / `.upload` / `.delete` |
| `viewActivity` | Staff with `intern.read` covering the record |

`internService.getProfile` builds a purpose-built DTO from these flags: hidden fields are `null` or masked on the
server, never sent and hidden in the UI. Update schemas are `z.strictObject`, so unknown fields (status,
organization, role, employee code…) are rejected — mass-assignment protection.

## Adding an intern

`internService.create` (HR/Admin, `intern.create`; `user.invite` too if an invitation is requested):

1. Validates input (strict schema), placement (department/position/team belong to the organization and to each
   other) and that manager/mentor are active staff.
2. Rejects existing interns and active/suspended staff emails; reuses an INVITED/INACTIVE profile with no intern
   record.
3. In **one transaction**: user (INVITED) + intern role, employee code, intern (SELECTED, or ONBOARDING when
   onboarding starts now), profile, emergency contact, internship (PLANNED), lifecycle events, onboarding snapshot
   from a template, and the invitation record.
4. After commit: audit entries (intern created, internship created, manager/mentor assigned, onboarding created),
   domain events, then invitation delivery. If delivery fails the intern still exists and the page shows a warning;
   HR can resend from the profile ("Resend invitation"). Optional photo upload also happens after commit.

Any failure inside the transaction rolls everything back — there are no partial interns.

### Employee codes

`AYV-INT-0001` format (`src/lib/interns/employee-code.ts`; prefix from setting `intern.employee_code_prefix`).
The number comes from `code_counters` via `INSERT … ON CONFLICT DO UPDATE SET value = value + 1 RETURNING value`
inside the create transaction, so concurrent creations always get distinct numbers. The first use seeds the
counter from the highest existing code. `UNIQUE (organization_id, employee_code)` is the final guarantee.

## Status lifecycle

```
SELECTED ─▶ ONBOARDING ─▶ ACTIVE ─▶ ENDING_SOON ─▶ COMPLETED ─▶ ALUMNI
                             ▲          │
                             └──────────┘  (extension, reason required)
SELECTED / ONBOARDING / ACTIVE / ENDING_SOON ─▶ TERMINATED  (reason required)
```

All changes go through `internLifecycleService.transitionStatus` (`src/server/services/intern-lifecycle.service.ts`):

- The transition must be in `STATUS_TRANSITIONS` (`src/lib/interns/lifecycle.ts`).
- COMPLETED/ALUMNI/TERMINATED need `internship.complete`; others `internship.update`. Nobody changes their own status.
- ONBOARDING → ACTIVE requires every required onboarding item to be done, unless HR (`onboarding.manage`) overrides
  **with a reason**; the override is recorded in the audit log.
- SELECTED → ONBOARDING generates the checklist if none exists.
- Side effects: internship status follows (PLANNED/ACTIVE/COMPLETED/CANCELLED); COMPLETED/TERMINATED set the actual
  end date.
- Concurrency: the update is `WHERE status = <from>`; a concurrent change returns a conflict instead of
  overwriting.
- Records a `STATUS_CHANGED` lifecycle event, an audit entry and the `intern.status_changed` domain event.

High-risk transitions (Completed, Alumni, Terminated) require an explicit confirmation checkbox in the UI.

### Ending-soon job

`internLifecycleService.markEndingSoon()` moves ACTIVE interns whose expected end date is within
`internship.ending_soon_days` (default 14) to ENDING_SOON. It is idempotent per intern **and end date**
(lifecycle idempotency key `ending_soon:{internId}:{date}`), so re-runs do nothing and an intern HR moved back to
ACTIVE is not flipped again unless their end date changes. It never runs on page load. Run it daily:

- `npm run jobs:daily` (script), or
- `POST /api/jobs/daily` with `Authorization: Bearer $CRON_SECRET` (Vercel Cron, GitHub Actions…). Without
  `CRON_SECRET` the endpoint returns 404.

The same job emits `onboarding.item_overdue` for items that became overdue that day.

## Progress

`internshipProgress()` (`src/lib/interns/progress.ts`) computes day N of total, percent and days remaining from the
real dates in the organization's timezone. Missing dates, future starts, same-day internships, overruns,
completed and terminated internships all return well-defined values.

## Documents

Upload, view, download and soft delete, per intern (`documentService`, `/api/documents/[id]`):

- Files are validated (type, size, magic bytes), stored privately under a server-generated key
  (`{org}/document/{year}/{uuid}.ext`) and served only through the authorized route — never a public URL.
  Downloads are `attachment` (`?inline=1` previews PDF/images) with `nosniff` and a sandbox CSP.
- Visibility levels: **INTERN** (intern, manager, HR), **MANAGER** (manager, HR), **HR**, **ADMIN** (needs
  `document.restricted`). Uploaders always see what they uploaded. Mentors have no document access.
- Interns can't choose visibility: ID documents default to HR, everything else to INTERN. Staff can pick only
  levels they can see.
- Hidden documents are 404. Deleting is soft and reopens any onboarding item that relied on the document.

## Domain events

`src/server/events/domain-events.ts` is an in-process bus emitted **after** commit:
`intern.created`, `intern.updated`, `intern.status_changed`, `intern.manager_assigned`, `intern.mentor_assigned`,
`internship.ending_soon`, `invitation.created`, `invitation.accepted`, `onboarding.created`,
`onboarding.item_completed`, `onboarding.item_overdue`, `onboarding.completed`, `document.uploaded`,
`document.deleted`. Notifications (Prompt 05/06) subscribe here; handler failures are logged and never affect
the request. Durable history lives in the audit log and `intern_lifecycle_events`.

## Tests

- Unit: `tests/unit/interns.test.ts` — dates, codes, transitions, progress, overdue, schemas.
- Integration: `tests/integration/interns.test.ts` — create (all rows, rollback, concurrent codes, duplicates),
  editing and mass assignment, assignment, transitions and override, ending-soon idempotency, onboarding,
  document visibility matrix, scope/IDOR.
- E2E: `tests/e2e/app/interns.spec.ts` — HR adds John Doe, intern works through onboarding, manager scope,
  security denials.

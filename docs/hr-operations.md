# HR operations (Phase 05)

Attendance, leave, documents, HR requests, announcements, holidays, ending internships and the HR dashboard. Everything
extends the Phase 01–04 model; nothing is duplicated.

## Where things live

| Area | Pages | Service | Pure rules |
| ---- | ----- | ------- | ---------- |
| HR dashboard + action centre | `/hr` | `hr-dashboard.service.ts` (`overview`) | — |
| HR directory | `/hr/interns` → `/interns` (onboarding + document filters, Onboarding / Attendance / Documents columns, CSV) | `intern.service.ts` | `lib/hr/operations.ts` |
| Intern HR record | `/interns/[id]?tab=hr` (personal info, emergency contacts, stipend, offboarding) and the Attendance / Leave / Documents tabs | `intern-hr.service.ts` | — |
| Attendance | `/attendance` (self), `/hr/attendance` (Today, Records, Corrections, one person's month) | `attendance.service.ts` | `lib/hr/attendance.ts`, `lib/hr/time.ts` |
| Leave | `/leave` (self), `/hr/leave` (Requests, Calendar, Balances) | `leave.service.ts` | `lib/hr/leave.ts` |
| Documents | `/documents` (self), `/hr/documents` (queue, completion by intern) | `document.service.ts` | `lib/hr/documents.ts` |
| Onboarding buckets | `/onboarding?bucket=…` | `onboarding.service.ts` | `lib/hr/operations.ts` |
| HR requests | `/requests`, `/requests/[id]`, `/hr/requests` | `hr-request.service.ts` | `lib/hr/requests.ts` |
| Announcements | `/announcements` (For me / Manage) | `announcement.service.ts` | `lib/hr/announcements.ts` |
| Ending internships | `/hr/offboarding?window=7|14|30` | `offboarding.service.ts` | `lib/hr/operations.ts` |
| HR calendar | `/hr/calendar` | `hr-dashboard.service.ts` (`calendar`) | — |
| HR analytics | `/hr/analytics` | `hr-dashboard.service.ts` (`analytics`) | — |
| Holidays + HR settings | `/hr/settings` | `holiday.service.ts`, `settings.service.ts` (`hrSettingsService`) | — |
| Exports | `GET /api/hr/export/{interns,attendance,leave,documents,analytics}` | each service's `exportCsv` | `toCsv` / `safeCell` |

Server actions: `src/server/actions/hr.ts`. Components: `src/features/hr/components`.

## Attendance

- **Server timestamps only.** Check-in/out and breaks use the server clock; the day is `todayIn(org timezone)`. One
  record per person per day (unique index); a second check-in is a 409.
- **Breaks**: `attendance_breaks`, at most one open per record (partial unique index). Check-out closes an open break.
- **Status** (`computeStatus`): late when check-in is after `workStart + grace`; after check-out, worked minutes
  (breaks excluded) ≥ full day → PRESENT (or LATE), ≥ half day → HALF_DAY, otherwise ABSENT. While checked in the
  status is provisional.
- **Derived days** (`resolveDay`): ABSENT and MISSING (checked in, never checked out) are only derived for days that
  have **passed**; today and future days have no status. Approved leave → ON_LEAVE, holidays → HOLIDAY, non-working
  days → WEEKEND. Days before joining / after the internship are not tracked. The calendar shows a text code for every
  day (P, L, H, A, LV, HO, W, M) plus an accessible label and a legend — it never relies on colour.
- **Rules** are HR settings (`attendance.rules`): work start, grace, full/half-day minutes, working weekdays.
- **Corrections** keep `original_check_in/out`; they can target a day with no record. Reviewers need
  `attendance_correction.review` covering the person and can't review their own. Approval rewrites the record
  (`source = CORRECTION`) and recomputes its status; before/after and the reason are audited; the requester is notified.
- **HR edits** (`attendance.update`) need a reason; before/after are audited; `source = HR`.

## Leave

- **Types** have an allowance (`quota_days`, `null` = unlimited, tracked only), `requires_approval`,
  `requires_attachment`. A person-specific allowance lives in `leave_balances` (HR, `leave.manage`, audited).
- **Days** are working days in the range (`workingDaysBetween`): non-working weekdays and holidays are excluded and the
  count is stored on the request.
- **Validation**: end ≥ start, not further back than the policy's `backdateDays`, at most `maxRequestDays`, at least one
  working day, attachment when required, **no overlap** with the person's pending/approved leave, and enough balance
  (allocated − approved − pending).
- **Override**: HR (`leave.manage`) can record leave for someone, or approve leave that overlaps approved leave, only
  with an override reason; `overlap_override` + `override_reason` are stored and `leave.overlap_overridden` is audited.
- **Decisions**: PENDING → APPROVED/REJECTED by someone with `leave.approve`/`leave.reject` covering the person —
  **never the requester** (checked in the service even for Super Admins). Rejections need a reason.
- **Cancel**: requesters cancel pending leave or approved leave that hasn't started; HR can cancel any active leave.

## Documents

- **Types** (`document_types`): name, required, sensitive, has expiry, default visibility and a legacy category
  (`document_type` enum, still used by onboarding DOCUMENT items).
- **Statuses**: UPLOADED → UNDER_REVIEW → VERIFIED / REJECTED; EXPIRED when the expiry date passes (applied at read
  time and by the daily job). "REQUIRED" is derived: a required type with no current document.
- **Versions are never overwritten**: uploading a type that already has a document creates `version + 1` with
  `previous_version_id`; only the newest is `is_current`. Deleting the current version restores the previous one.
- **Review** (`document.verify`, never your own documents): verify, reject or request replacement — the last two need a
  reason the intern sees.
- **Sensitive types** (e.g. ID proof) are shown only to the intern, the uploader and holders of `document.sensitive`,
  whatever the visibility level; downloads of sensitive documents by staff are audited
  (`document.sensitive_accessed`).
- **Completion** counts only VERIFIED current documents against required types (`documentCompletion`).
- **Expiry**: the daily job marks lapsed documents EXPIRED (audited) and sends reminders at the warning threshold (HR
  setting) and 7 days before.

## HR requests

Categories: Attendance correction, Leave, Document update, Certificate, Experience letter, Profile change, Other.
Statuses: OPEN → IN_REVIEW ⇄ WAITING_FOR_USER → APPROVED / REJECTED / RESOLVED; requesters can cancel undecided
requests. Asking for information or rejecting needs a note. A reply from the requester moves WAITING_FOR_USER back to
IN_REVIEW. Everyone raises and reads **their own** requests (`hr_request.create/read` OWN); HR handles the queue
(`hr_request.manage`, organization-wide). Up to 3 files on creation, 10 per request, stored privately.

## Announcements

Categories (Company, HR, Holiday, Policy, Internship, Deadline); audiences Everyone, Department, Team, All interns,
Managers, Mentors, Specific people. "Managers" and "Mentors" are people who manage/mentor interns (data), not role
names. Lifecycle: Draft → Scheduled → Published → Archived. Viewers only receive announcements addressed to them
(search only surfaces organization-wide ones). Publishing notifies the audience exactly once (`notified_at`);
scheduled announcements go live at their time and are published + notified by the daily job.

## Ending internships and offboarding (foundation)

`/hr/offboarding` lists active internships ending within 7/14/30 days (or past their end date) with open tasks,
required-document completion, certificate status and the offboarding checklist. HR starts a checklist from the default
items in HR settings (`offboarding_checklists`, one per intern; `offboarding_items`). Performance reviews, exit
interviews and certificate issuance arrive in later phases (shown as such).

## HR dashboard, calendar and analytics

- **Dashboard** (`hr_dashboard.read`, organization-wide): KPIs (total, active, onboarding, ending soon, completed this
  month, documents to verify, pending leave, attendance issues), the **action centre** (everything waiting on HR with a
  link to the filtered view) and today's attendance. All counts come from **one aggregate SQL query**, so the page stays
  fast on a single pooled database connection.
- **Calendar**: joining and end dates, leave, holidays, onboarding deadlines, document expiries, review periods and
  meetings — an agenda with a text label per entry.
- **Analytics**: counts and ratios of stored records only (interns by status/department, joiners by month, attendance
  rate, late arrivals, leave days by type, document completion, onboarding buckets, request resolution time). No
  scores or predictions.

## Exports

CSV only (XLSX/PDF are not built — there is no export library in the stack yet). Each export needs its own permission
(`intern.export`, `attendance.export`, `leave.export`, `document.export`, `analytics.export`), respects scope, is
audited (`export.generated`) and neutralizes spreadsheet formulas (cells starting with `= + - @` get a leading `'`).

## Permissions

| Spec name | Catalog key |
| --------- | ----------- |
| `hr.dashboard.read` | `hr_dashboard.read` |
| `hr.interns.read/update/export` | `intern.read`, `intern.update`, `intern.export` |
| `hr.attendance.read/manage/export` | `attendance.read`, `attendance.manage`, `attendance.export` (+ `attendance.update`, `attendance_correction.review`) |
| `hr.leave.read/approve/manage/export` | `leave.read`, `leave.approve`/`leave.reject`, `leave.manage`, `leave.export` |
| `hr.documents.read/verify/manage/sensitive/export` | `document.read`, `document.verify`, `document.manage`, `document.sensitive`, `document.export` |
| `hr.requests.read/manage` | `hr_request.read`, `hr_request.manage` (+ `hr_request.create`) |
| `hr.announcements.create/publish` | `announcement.create`, `announcement.update` |
| `hr.offboarding.read/manage` | `offboarding.read`, `offboarding.manage` |
| `hr.settings.update` | `hr_settings.update` (+ `holiday.manage`, `leave_type.manage`) |
| `hr.analytics.read/export` | `analytics.read`, `analytics.export` |
| compensation | `compensation.read`, `compensation.update` |

HR holds all of these organization-wide. Managers keep assigned-scope attendance/leave review and get
`offboarding.read` (assigned). Everyone gets `hr_request.create/read` (own). Compensation, sensitive documents, exports,
verification and HR settings are HR/Admin only.

## Notifications and audit

Notifications: LEAVE_REQUESTED/APPROVED/REJECTED/CANCELLED, ATTENDANCE_CORRECTION_REQUESTED/APPROVED/REJECTED,
DOCUMENT_UPLOADED/VERIFIED/REJECTED/EXPIRING, ONBOARDING_ITEM_ASSIGNED/OVERDUE, HR_REQUEST_CREATED/UPDATED/COMMENTED,
ANNOUNCEMENT_PUBLISHED (`src/server/events/hr-subscribers.ts`). Queue owners are resolved from grants
(`usersWithPermission`), never role names.

Audit actions (`audit-actions.ts`) include before/after values and reasons for corrections, HR edits, leave decisions
and overrides, balances, document decisions, settings and compensation. Personal-information edits record which
fields changed, not their values.

## Daily job additions

`POST /api/jobs/daily` / `npm run jobs:daily` now also expires documents, sends expiry reminders and publishes due
scheduled announcements. All steps are idempotent.

## Not built in this phase

Performance management, LMS, AI, payroll, ATS, calendar sync, Slack and chat. XLSX/PDF exports.

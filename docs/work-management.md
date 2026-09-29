# Work management (projects, tasks, submissions)

Phase 04 turns the Phase 01 work tables into a working system:

```
PROJECT → MILESTONE → TASK → SUBTASK / CHECKLIST → WORK → SUBMISSION → REVIEW → CHANGES REQUESTED / APPROVED → COMPLETED
```

Every meaningful action is written to the audit log (tagged with `metadata.projectId`, which powers the project
timeline) and emitted as a domain event (which creates in-app notifications).

## Pages

| Route | What |
| --- | --- |
| `/my-work` | Personal command centre: due today, overdue, waiting for me, in progress, waiting for review, to review (reviewers), blocked, upcoming (tasks + milestones), recently completed, own workload |
| `/tasks` | List (server-side search, filters, sort, 25/50/100 pagination, bulk actions) or board (`?view=board`). Saved views are URL presets (My open work, Overdue, Awaiting review, Blocked, Unassigned) |
| `/tasks/[id]` | Task detail: status actions, description, checklist, subtasks, dependencies, submission & review history, attachments, comments, activity; side panel with dates, estimate/actual hours, progress, time log |
| `/projects` | Projects within scope: search, status/manager/member/date filters, sort, pagination |
| `/projects/[id]` | Project dashboard: KPIs (total, completed, in progress, blocked, overdue, pending review), milestone timeline, workload, recent activity, team |
| `/projects/[id]/tasks` · `milestones` · `files` · `team` · `activity` · `settings` | Project sections (settings: status transitions and details, for leads) |
| `/workload` | Workload per intern (managers/mentors: their interns; HR/Admin: everyone) |
| `/api/tasks/attachments/[id]`, `/api/projects/files/[id]` | Authorized private downloads (404 when not visible) |

The dashboard (`/`) adds role-aware work sections: *My tasks* (anyone with assignments), *Team work* (managers and
mentors — their interns and the projects they lead), *Organization work* (HR/Admin). The notification bell lists
in-app notifications.

## Authorization

Global RBAC and project membership are combined in `src/server/services/work-access.ts`:

- **Reading** uses the scope filters (`scope.ts`). `task.read` at ASSIGNED scope covers tasks you created or are
  assigned, tasks of interns you manage/mentor, and every task in a project you own, manage or belong to.
  `project.read` covers projects you own, manage or are a member of (or that your interns belong to). Anything
  outside scope — including other organizations — is **404**.
- **Project relation**: *lead* = owner/manager (`owner_id`, `manager_id`, or an OWNER/MANAGER member); *mentor* =
  MENTOR member; *member* = any member (VIEWER is read-only). Organization-wide grants act as lead everywhere.

| Capability | Rule |
| --- | --- |
| Edit project / change status / manage milestones | `project.update` and (org-wide or lead) |
| Manage members | `project.manage_members` and (org-wide or lead). Interns can only be CONTRIBUTOR or VIEWER |
| Archive | `project.delete` (org-wide) or owner — or a status change by a lead |
| Create tasks in a project | open project, `task.create`, and (org-wide or lead or mentor) |
| Edit / assign a task | `task.update` / `task.assign` and (org-wide or task creator or project lead/mentor) |
| Work on a task (start, block, checklist, attachments) | assignee, or a task lead |
| Submit | assignee with `task.submit` |
| Review | `task.review`, **not an assignee or the submitter**, and (org-wide or creator or project lead/mentor or the assignee’s manager/mentor) |
| Comment | `task.comment` and can see the task. Authors edit/delete their own; org-wide task editors can delete any |
| Log time | assignee (own entries only) |

Role defaults: **Admin/Super Admin** everything; **HR** org-wide project/task management and review;
**Manager** reads all projects and tasks, creates projects, and manages/assigns/reviews in projects they lead;
**Mentor** creates, assigns and reviews in projects they mentor; **Intern** reads their projects and tasks, works on
and submits assigned tasks, comments.

Assignees must be active project members (not viewers); tasks outside a project can only be assigned within the
assigner’s `task.assign` scope. The browser never supplies identity, organization, role or permission — they come
from the session.

## Task lifecycle

Statuses: `BACKLOG, ASSIGNED, IN_PROGRESS, BLOCKED, IN_REVIEW, CHANGES_REQUESTED, COMPLETED, CANCELLED`
(`src/lib/work/tasks.ts`). All manual changes go through `taskLifecycleService.transitionStatus`; review-driven
changes through `taskSubmissionService`.

| From | To | Who | Notes |
| --- | --- | --- | --- |
| BACKLOG | ASSIGNED / IN_PROGRESS / CANCELLED | lead (IN_PROGRESS: worker too) | ASSIGNED needs an assignee (adding one to a backlog task moves it automatically) |
| ASSIGNED | IN_PROGRESS / BLOCKED / BACKLOG / CANCELLED | worker or lead | |
| IN_PROGRESS | BLOCKED / COMPLETED / ASSIGNED / CANCELLED | worker (BLOCKED), lead | IN_PROGRESS → IN_REVIEW only by submitting |
| BLOCKED | IN_PROGRESS / ASSIGNED / CANCELLED | worker or lead | `previous_status` records where it came from |
| IN_REVIEW | CHANGES_REQUESTED / COMPLETED | review only | CANCELLED by a lead |
| CHANGES_REQUESTED | IN_PROGRESS / IN_REVIEW (resubmit) / BLOCKED / CANCELLED | worker or lead | |
| COMPLETED | IN_PROGRESS | lead | reopen, reason required |
| CANCELLED | BACKLOG | lead | restore; cancelled tasks stay visible in history and lists |

Reasons are required for BLOCKED (the blocker), CANCELLED and reopening. Starting work is refused while a BLOCKS
dependency is open. A parent can’t complete (directly or by approval) while subtasks are open. Tasks in closed
projects can’t change. Updates use optimistic concurrency (`WHERE status = <from>`), so a concurrent change returns a
conflict instead of overwriting. Side effects: `started_at` on first start, `completed_at` set on completion and
cleared on reopen, milestone UPCOMING → ACTIVE when its first task starts, project progress recomputed, audit entry,
`task.status_changed` event.

The board’s drag-and-drop only allows columns the viewer may move a card to (server-computed hints) and every card
has a **Move to…** menu as the keyboard/touch alternative. Nothing changes on the client until the server accepts.

**Priorities** `LOW, MEDIUM, HIGH, URGENT` drive badges, sorting (priority sort, board ordering), filters, dashboards.

**Subtasks** nest one level (a task and its subtasks). **Checklists** support add, rename, check, reorder and
delete. **Dependencies** are BLOCKS only, within one project, with self- and cycle-detection (`createsCycle`).
Closed (completed/cancelled) tasks are read-only for checklist and attachment changes.

## Submissions and reviews

```
(none) ─submit─▶ SUBMITTED ─review─▶ APPROVED ─────────────▶ task COMPLETED
                     │
                     ▼
            CHANGES_REQUESTED ─resubmit─▶ RESUBMITTED ─review─▶ …   (task CHANGES_REQUESTED ↔ IN_REVIEW)
```

- Only assignees submit, from IN_PROGRESS or CHANGES_REQUESTED, with a message and up to 5 files.
- Each submit/resubmit creates an immutable `submission_versions` row (message, files via
  `task_attachments.submission_version_id`, submitter, time). Reviews write reviewer, time, decision and comment
  onto that version. Earlier versions are never modified; submitted files can’t be deleted.
- Requesting changes requires a comment. A version can only be reviewed once (guarded update).
- `UNDER_REVIEW` exists in the enum for a future “review started” step; it counts as pending.

## Projects and milestones

Project statuses: `PLANNING → ACTIVE ⇄ ON_HOLD → COMPLETED → ARCHIVED`; any open status → `CANCELLED` →
`PLANNING` (restore) or `ARCHIVED`; `COMPLETED → ACTIVE` reopens (`src/lib/work/projects.ts`). Cancelling, pausing and
reopening need a reason; completing needs every task completed or cancelled. Archived projects are hidden from the
default list and read-only.

Members: `OWNER, MANAGER, MENTOR, CONTRIBUTOR, VIEWER`. The creator becomes OWNER; the chosen project manager is kept
as a MANAGER member. Removing a member releases their open assignments in the project.

Milestones: `UPCOMING, ACTIVE, COMPLETED, CANCELLED`; **OVERDUE is derived** (open and past due in the
organization’s timezone). Completing is an explicit lead action and requires no open tasks in the milestone.

## Progress (one method, documented)

- **Project / milestone** = completed ÷ non-cancelled **top-level** tasks × 100. Subtasks are excluded so work is
  never counted twice. Cached on `projects.progress_percentage` and recomputed on every status/structure change.
- **Task** = 100 when completed; otherwise completed ÷ non-cancelled subtasks, else checked ÷ total checklist items,
  else 0. Status alone never implies partial progress.

Estimates are stored as minutes (`estimated_minutes`, `actual_minutes`) and shown as hours. `actual_minutes` is the
sum of time entries.

## Deadlines

`due_date` and `start_date` are calendar dates (`DATE`); the due date must not precede the start date. States are
computed in the organization’s timezone: `UPCOMING`, `DUE_SOON` (≤ 2 days), `DUE_TODAY`, `OVERDUE`,
`COMPLETED_ON_TIME`, `COMPLETED_LATE`. Completion is judged against the due date using `completed_at`, which is never
rewritten, so late completions stay late.

## Workload (transparent rules)

Per person (`src/lib/work/workload.ts`, `workloadService`):

- **active** — assigned tasks in ASSIGNED, IN_PROGRESS, BLOCKED, CHANGES_REQUESTED
- **overdue** — open assigned tasks (including IN_REVIEW) past their due date
- **due this week** — active tasks due in the next 7 days
- **hours this week** — estimated hours of active tasks that are overdue or due within 7 days, split equally between
  assignees

| Level | Rule (first match) |
| --- | --- |
| OVERLOADED | active ≥ 8, or overdue ≥ 3, or hours > 40 |
| HIGH | active ≥ 5, or overdue ≥ 1, or hours > 30 |
| LOW | active ≤ 1 and nothing overdue |
| NORMAL | otherwise |

No scoring model or performance judgment is involved. `workService.metrics` exposes factual counts (total,
completed, overdue, blocked, pending reviews, average completion hours, on-time rate) as an analytics foundation.

## Bulk actions

Assign, change priority, change status, move to project, delete. Each task is authorized and changed on its own (a
task the viewer can’t change never blocks the rest), audited individually, and routed through the same services
(status changes use `taskLifecycleService`). The result lists which tasks failed and why.

## Files

Task attachments and project files use the storage service: type/extension/magic-byte and size validation,
server-generated keys, no public URLs. Downloads go through authorized routes (`attachment` by default, `?inline=1`
previews PDFs/images) with `private, no-store`, `nosniff` and a sandboxing CSP. Allowed: PDF, images (PNG, JPEG, WebP,
GIF), Office documents, ZIP, MP4, text/CSV. SVG is not accepted.

## Comments and mentions

One level of replies. Mentions use `@[Name](user-id)` markup inserted by the comment box; only task participants
(assignees, creator, project members) are stored as mentions and notified — other ids are ignored. Comment text is
rendered as text, never HTML.

## Notifications and events

Domain events (`src/server/events/domain-events.ts`) are emitted after commit; built-in subscribers
(`src/server/events/subscribers.ts`) write in-app notifications (`notifications` table), shown in the bell.

| Event | Notification | Recipients |
| --- | --- | --- |
| `task.assigned` | TASK_ASSIGNED | new assignees |
| `task.due_soon` / `task.overdue` (daily job) | TASK_DUE_SOON / TASK_OVERDUE | assignees |
| `task.status_changed` | TASK_STATUS_CHANGED | BLOCKED → creator and project leads; completed/cancelled/reopened → assignees |
| `task.comment_mention` | TASK_COMMENT_MENTION | mentioned participants |
| `task.submitted` | TASK_SUBMITTED | task creator, project leads, the submitter’s manager and mentor |
| `task.reviewed` | TASK_APPROVED / TASK_CHANGES_REQUESTED | the submitter |
| `project.member_added` | PROJECT_MEMBER_ADDED | the new member |
| `project.status_changed` | PROJECT_STATUS_CHANGED | members |
| `project.milestone_due` (daily job) | PROJECT_MILESTONE_DUE | project leads |

The actor is never notified of their own action. Email/push delivery and preferences are Phase 06. The daily job
(`npm run jobs:daily` / `POST /api/jobs/daily`) emits the due-soon, overdue and milestone events for exactly one day
window, so a daily run notifies once.

## Audit events

`task.created, task.updated, task.assigned, task.unassigned, task.status_changed, task.priority_changed,
task.deadline_changed, task.deleted, task.commented, task.submitted, task.reviewed, task.attachment_added,
task.attachment_removed, task.dependency_changed, task.checklist_updated, task.time_logged, project.created,
project.updated, project.member_added, project.member_removed, project.status_changed, project.file_uploaded,
project.file_deleted, milestone.created, milestone.updated, milestone.completed`. Metadata carries ids, titles and
from/to values — never file contents or personal data.

## Search

Global search covers projects, tasks and milestones (plus Phase 01–03 providers), each within the viewer’s scope.

## Tests

- Unit: `tests/unit/work.test.ts` — transition table, deadlines/timezones, progress, nesting, cycles, workload,
  submissions, project/milestone rules, schemas, mentions.
- Integration: `tests/integration/work.test.ts` — the full create → assign → start → submit → changes → resubmit →
  approve flow (versions, files, progress, activity, notifications), dependencies, blockers, subtasks, assignment
  rules, bulk, mentions, closed tasks, completion guards; security (cross-organization, private projects and files,
  self-review, managers/mentors/interns editing projects they don’t lead, smuggled fields); workload, deadline job,
  server-side filters.
- E2E: `tests/e2e/app/work.spec.ts` — the three required flows plus intern denials.

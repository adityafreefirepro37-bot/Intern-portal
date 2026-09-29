# Onboarding

Checklists that take a new intern from offer to their first task.

## Templates → snapshots

HR maintains **templates** at `/onboarding/templates` (`onboarding.manage`). Each template has ordered items:

| Field | Meaning |
| --- | --- |
| Type | DOCUMENT, ACKNOWLEDGEMENT, MEETING, TRAINING, FORM, TASK, CHECKLIST, ACCOUNT_SETUP, OTHER |
| Required | Required items must be done (or waived) for onboarding to complete; optional items never block |
| Due | Days after the intern's start date (negative = before) |
| Responsible | The intern, their manager, their mentor, or a specific HR person |
| Document type | DOCUMENT items: the document type the upload must have |
| Policy | ACKNOWLEDGEMENT items: which policy (and its current version) to acknowledge |

A template can be tied to a department and/or position and one template is the default. When onboarding starts
without an explicit choice, the most specific active template wins: position match → department match → default.

Starting onboarding (when an intern is created with "Start onboarding now", or on SELECTED → ONBOARDING)
**copies** the template into an intern-specific checklist (`onboardings` + `onboarding_items`) inside the same
transaction: due date = start date + offset, assignee resolved from the role. The copy is independent — editing
or deleting template items never changes existing checklists. One onboarding per internship is enforced by a
unique constraint.

Seeded templates: **General Intern Onboarding** (default), **Marketing**, **Design** and **Development**
(general items plus department-specific ones). Existing templates are never overwritten by re-seeding.

## Completing items

| Item type | How it completes |
| --- | --- |
| DOCUMENT | Uploading a document of the required type from the item (stored privately; see intern-management.md) |
| ACKNOWLEDGEMENT | The intern reads the policy and confirms; a `document_acknowledgements` row stores user, policy, **version**, time, IP and user agent |
| Everything else | "Mark complete" by the assignee |

Who can act:

- The **assignee** with `onboarding.complete` in scope (interns: OWN, managers/mentors: ASSIGNED).
- **HR** (`onboarding.manage` in scope) can complete any item and use the controls: *mark in progress*, *reopen*,
  *skip* (waiving a required item needs a reason), *mark blocked* (reason required).
- Only the intern can acknowledge their own policies.

Every action is audited (`onboarding.item_completed`, `onboarding.item_updated`, `policy.acknowledged`) and emits
a domain event.

## Progress, overdue, completion

`onboardingProgress()` (`src/lib/interns/progress.ts`) counts required/optional totals and completions (COMPLETED
and SKIPPED count as done), blocked items, overdue items (past due date in the organization's timezone and not
done), and a required-only percentage.

When the last required item is done the onboarding is marked complete **once** (`completed_at`), an
`ONBOARDING_COMPLETED` lifecycle event and audit entry are recorded and `onboarding.completed` is emitted.
**The intern is not activated automatically** — HR confirms ONBOARDING → ACTIVE from the profile. Reopening an
item (or deleting the document it relied on) clears `completed_at`.

## Pages

- `/onboarding` — HR dashboard: in progress / overdue / blocked / completed, with per-intern progress. Interns are
  redirected to their own checklist.
- `/interns/[id]/onboarding` and the profile's Onboarding tab — the checklist with per-item actions computed on the
  server (`canComplete`, `canManage`).
- `/onboarding/templates`, `/onboarding/templates/[id]` — template list and editor (settings, add/edit/reorder/remove
  items).

## Overdue notifications

The daily job (`npm run jobs:daily` / `POST /api/jobs/daily`) emits `onboarding.item_overdue` for items whose due
date was yesterday, so each item triggers once. Delivering notifications is Prompt 05/06.

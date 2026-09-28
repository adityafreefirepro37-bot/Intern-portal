# Onboarding

Onboarding turns a reusable **template** into an intern-specific **checklist**, tracks completion, and hands control
back to HR to activate the intern.

## Screens

| Route                          | Who                   | What                                                                   |
| ------------------------------ | --------------------- | ---------------------------------------------------------------------- |
| `/onboarding`                  | `onboarding.manage`   | HR dashboard: totals (all onboardings in scope), filter by state, table |
| `/onboarding/templates`        | `onboarding.manage`   | Templates list                                                         |
| `/onboarding/templates/[id]`   | `onboarding.manage`   | Template editor: settings, items, order                                |
| `/interns/[id]/onboarding`     | in scope              | The checklist (interns are redirected here from `/onboarding`)         |
| `/` (My internship card)       | interns               | Progress and a "Continue onboarding" link                              |

## Data model

```text
onboarding_templates ──< onboarding_template_items          (reusable, editable)
        │ copied when onboarding starts (snapshot)
        ▼
internships ──1:1── onboardings ──< onboarding_items          (per intern, independent)
                                          │
                                          ├── document_id → internship_documents   (DOCUMENT items)
                                          └── policy_id   → policies ──< document_acknowledgements (versioned)
```

- `onboarding_templates`: name (unique per organization), optional department/position, `is_active`, `is_default`,
  soft delete.
- `onboarding_template_items`: title, description, category, `required`, `due_days_after_start` (−365…365),
  `assigned_role` (INTERN / MANAGER / MENTOR / HR), `assigned_user_id` (required for HR items),
  `required_document_type`, `policy_id`, `sort_order`.
- `onboardings`: one per internship (`UNIQUE internship_id`), with the template id **and name** copied, `started_at`
  and `completed_at`.
- `onboarding_items`: the snapshot. It has its own title, type, required flag, due date, assignee and status
  (PENDING, IN_PROGRESS, BLOCKED with a required reason, COMPLETED, SKIPPED), plus links to the document or policy.
- `policies`: versioned documents (`UNIQUE organization_id, slug, version`).
- `document_acknowledgements`: user, policy, **version**, timestamp, IP address and user agent
  (`UNIQUE user_id, policy_id, policy_version`). This is not a boolean: publishing a new version asks for a new
  acknowledgement.

## Item types

`DOCUMENT`, `ACKNOWLEDGEMENT`, `MEETING`, `TRAINING`, `FORM`, `TASK`, `CHECKLIST`, `OTHER` (plus the legacy
`ACCOUNT_SETUP`).

- **DOCUMENT** completes when a document of the required type is uploaded through the item. It uses the intern
  document storage, and files are never stored in onboarding rows. Deleting the document reopens the item.
- **ACKNOWLEDGEMENT** completes when the intern reads the policy and confirms. Only the intern can acknowledge.
- **TRAINING, TASK, MEETING** are marked complete manually for now. Later phases connect them to the Learning Hub,
  Tasks and Calendar. `template_item_id`, `item_type` and `assigned_role` are the integration points.

## Choosing a template

When HR leaves the template on "Automatic", `templateRepository.pickFor()` picks the first active template in this
order:

1. one for the intern's position,
2. one for their department (with no position),
3. the organization default.

If none matches, HR is asked to choose one.

## Generating a checklist

`generateOnboarding(tx, …)` runs inside the caller's transaction (intern creation, or SELECTED → ONBOARDING):

1. Refuses a second onboarding for the internship. The database enforces this too.
2. Copies each template item into `onboarding_items`, in order.
3. Sets due dates to the internship start date + `due_days_after_start`, as calendar dates.
4. Assigns items to the intern, their manager, their mentor, or the named HR person.
5. Records `ONBOARDING_STARTED` on the intern's timeline (idempotent).

After commit, `announceOnboarding()` writes the `onboarding.created` audit entry and emits `onboarding.created`,
plus `onboarding.item_assigned` for each assigned item.

**Snapshot rule:** after generation, the checklist no longer depends on the template. Editing or deleting template
items never changes existing checklists (covered by an integration test). When a manager or mentor is replaced,
their **open** items move to the new person and emit `onboarding.item_assigned`.

## Completing items

| Action                            | Who                                                                |
| --------------------------------- | ------------------------------------------------------------------ |
| Mark complete                     | HR (`onboarding.manage` in scope), or the assignee with `onboarding.complete` in scope |
| Upload document (DOCUMENT)        | the intern, or HR                                                  |
| Acknowledge policy                | the intern only                                                    |
| Start, block (reason), skip (reason for required items), reopen | HR only                      |

Every item action looks up the item through the intern's scope. Items of interns the actor can't see return
**not found**, so an intern can't complete another intern's items and a manager can't touch another manager's
intern. Each change is audited (`onboarding.item_completed` / `onboarding.item_updated` / `policy.acknowledged`).

## Progress, overdue and completion

Pure rules in `src/lib/interns/progress.ts` (unit-tested):

- **Progress** = completed required items ÷ required items. Optional items are reported separately and never count
  towards the percentage. A required item HR skipped with a reason counts as resolved. With nothing required,
  progress is 100%.
- **Overdue**: `due_date` is before today in the **organization's timezone**, and the item isn't COMPLETED or SKIPPED.
  It's calculated when read and never stored, so opening a page changes nothing. The daily job emits
  `onboarding.item_overdue` once, on the day an item becomes overdue, for notifications later.
- **Complete**: all required items are done. The onboarding's `completed_at` is set once (a guarded update), an
  `ONBOARDING_COMPLETED` lifecycle event and audit entry are written, and `onboarding.completed` is emitted.
  Reopening a required item clears `completed_at`.
- Completion **does not** activate the intern. HR confirms ONBOARDING → ACTIVE from the profile, and activating
  earlier needs an override with a reason.

## HR dashboard

`onboardingService.dashboard()` counts **every** onboarding in the viewer's scope with database aggregates: total,
in progress, completed, overdue (unfinished with an overdue item), blocked, and the completion rate. The table shows
the 200 most recent checklists with intern, required progress, state, template, intern status, start date, last due
date and completion date. When there are more, the page says so.

## Seed data (development only)

`prisma/seed/onboarding.ts` creates:

- **Policies:** the Intern Handbook, a confidentiality agreement (NDA) and Information Security Essentials, all at
  version 1.
- **Templates:** General (default, 11 items), Marketing, Design and Development (14 items each, with department
  extras).
- **Checklists** for each demo intern:
  - Neel (onboarding): part-way, with an overdue résumé and a blocked environment set-up.
  - Kabir (selected): no checklist yet.
  - Everyone else: finished.
- Matching policy acknowledgements and lifecycle history.

Production doesn't run the seed's demo data. HR creates templates in the UI, and policies must be inserted until
the Phase 05 editor exists.

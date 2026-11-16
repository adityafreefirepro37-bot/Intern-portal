# Analytics (Phase 09, part 2)

`/analytics` — programme analytics, month by month, for the last 3, 6 or 12
months, optionally narrowed to a department or team. **Counts and ratios of
recorded activity only**: no scores, rankings or predictions about people.

## Who sees what

| Permission | Who (defaults) | Sees |
| --- | --- | --- |
| `analytics.read` at ORGANIZATION | HR, admins | Every intern; plus organization-wide communication figures (when no department/team filter is set) |
| `analytics.read` at ASSIGNED | Managers | Only the interns they manage or mentor; no communication section |
| `analytics.export` | HR, admins | CSV of the monthly table (audited as `export.generated`) |

Everything is computed for the interns in view (`internScope` + filters), so a
department filter narrows every figure on the page. The deeper HR, learning and
performance analytics pages are linked at the bottom for people who can open them.

## Figures and definitions

- **Intern pipeline**: joined (by joining date) and completed (status Completed or
  Alumni, by actual end date) per month; completion rate = completed ÷ (completed +
  ended early); average internship length; interns by current status.
- **Work** (tasks assigned to the interns): created and completed per month; on-time
  rate = completed on or before the due date ÷ completed tasks that had a due date;
  average days from creation to completion; submissions reviewed, share sent back
  for changes, average review turnaround (submitted → reviewed); open overdue
  tasks by project.
- **Attendance and leave**: attendance rate = days attended (present, late, half
  day) ÷ working days recorded (those plus absent and missing); late arrivals per
  month; approved leave days by type and month (by start date).
- **Learning and performance**: courses completed per month; enrolment completion
  rate; overdue courses; quiz pass rate; goals completed / open / at risk; weekly
  check-ins submitted and the share reviewed; reviews completed.
- **Communication** (organization-wide only): meetings held and cancelled,
  invitation acceptance, messages sent, notification emails sent / failed / skipped.

Months are counted in the organization's timezone. All figures come from a
handful of aggregate SQL queries run in parallel (`src/server/services/analytics.service.ts`).

## Charts

Server-rendered SVG (`src/features/analytics/components/charts.tsx`): one y-axis,
series colours from the `--viz-1` / `--viz-2` tokens (validated for colour-vision
deficiency and contrast in light and dark mode), a legend and labelled latest
values, a hover tooltip per month, and a **Show as table** view under every chart.

## Not included

Excel/PDF reports, saved report schedules, custom date ranges beyond 3/6/12
months, and per-person comparisons.

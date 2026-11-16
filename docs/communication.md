# Communication (Phase 08)

Calendar, meetings, messages and notification delivery. Everything is built on
the normal layering (pages → services → Prisma), permission-checked in the
services, and audited where it changes shared state.

## Calendar — `/calendar`

One personal schedule in **month**, **week** and **agenda** views
(`?view=month|week|agenda&date=YYYY-MM-DD`). `calendarService.items()` reads,
for the viewer only and only where they hold the permission:

| Source | Shown | Permission |
| --- | --- | --- |
| Meetings they attend (cancelled / declined shown struck through) | timed | `meeting.read` |
| Organization events (trainings, company events, deadlines) | all-day or timed | `calendar.read` |
| Tasks assigned to them, still open, by due date | all-day | `task.read` |
| Milestones of projects they own, manage or belong to | all-day | `project.read` |
| Their own leave (pending shown muted) | each day | `leave.read` |
| Holidays | all-day | — |
| Course due dates, goal target dates, onboarding items assigned to them | all-day | `learning.read`, `goal.read`, `onboarding.read` |

Instants are bucketed into days in the organization timezone. On phones the
month view becomes a day list. Every item has a text label (colour is never the
only signal). Organization events are created by `calendar.create` holders (HR,
managers, admins) and soft-deleted.

**Export:** `/api/calendar/ics` downloads the viewer's meetings (30 days back to
6 months ahead) and `/api/meetings/:id/ics` one meeting, as iCalendar files for
Google Calendar, Outlook or Apple Calendar. Both need a signed-in session; there
is deliberately no unauthenticated subscription URL yet.

## Meetings — `/calendar/meetings/:id`

- **Schedule** (`meeting.manage`): title, date, start/end (wall-clock in the
  organization timezone, ≤ 12 h, not in the past), location, an `https://` video
  link, agenda and invitees. The organizer is an attendee.
- **Who can be invited** follows the scope of `meeting.manage`: ORGANIZATION →
  anyone active; mentors hold it at ASSIGNED scope → only the interns they mentor.
- **Visibility:** attendees, plus organization-wide meeting managers (HR,
  managers, admins). Nobody else can open a meeting.
- **Replies:** accept / maybe / decline. Declines and maybes notify the organizer.
- **Changes:** a new time resets everyone's reply to "no reply" and tells them;
  added people get an invitation, removed people are told.
- **Conflicts:** saving reports attendees who already have an overlapping
  meeting they haven't declined (a warning, not a block).
- **Cancel:** organizer or organization-wide manager; attendees are notified
  with the optional reason.

The dashboard shows upcoming meetings, and the HR calendar links to them.

## Messages — `/messages`, `/messages/:slug`

- **Company channels** (type `GENERAL`, e.g. `#general`, created by the reference
  seed in every environment) are open to everyone.
- **Team / department / project channels** have explicit members. `channel.manage`
  holders create them (optionally adding everyone from a team, department or
  project), rename, add/remove members and archive. Members can leave.
- **Direct messages** are two-person channels (`dm-<id>-<id>`, one per pair).
  Nobody else can read them — administrators included.
- Messages support `@[Name](id)` mentions (only people who can read the channel
  are notified), edit, delete (own; channel managers can remove others' messages
  outside DMs — audited), links, and "load earlier".
- **Unread counts** come from `channel_members.last_read_at`; the chat marks the
  channel read when opened and as new messages arrive.
- **Live updates** poll `GET /api/messages/:channelId?since=` every 4 s while the
  tab is visible. Every edit and deletion bumps `updated_at`, so polls pick them up.
- Sending is rate-limited (`messageSend`: 30 per minute per person).

## Notifications — `/notifications`

- Full history (all / unread, paginated) and **settings**: per category
  (tasks, projects, meetings, messages, HR, onboarding, announcements, learning,
  performance) choose **in the app** and/or **email**. Defaults: in the app
  everywhere, email for meetings.
- `notificationService.notify()` applies the recipient's choice: in-app off
  stores the notification already read (history, no badge); both off creates
  nothing; email on queues a `notification_deliveries` row.
- **Email delivery** runs after the response (`after()`), with the daily job
  (`/api/jobs/daily`, `npm run jobs:daily`) sending whatever is left — up to 3
  attempts. Without an email provider (`EMAIL_PROVIDER`, `EMAIL_FROM` and keys)
  deliveries are marked SKIPPED, so the queue never grows. Administrators
  (`notification.manage`) see 7-day counts and can retry failures.
- Direct messages produce at most one unread notification per conversation.

New notification types: `MEETING_INVITED`, `MEETING_UPDATED`, `MEETING_CANCELLED`,
`MEETING_RESPONSE`, `MESSAGE_MENTION`, `DIRECT_MESSAGE`, `CHANNEL_ADDED`.

## Data

Migration `20261114090000_communication`: `meeting_attendees`, meeting
status/cancellation, calendar event all-day/location/soft delete, `channel_members`,
channel archive + last activity, message mentions/edits, `notification_preferences`,
`notification_deliveries`. Row-level security is enabled on the new tables.
Existing meetings get their creator as the organizer attendee.

## Timestamps and the database driver

Prisma's node-postgres adapter (5.22) sends DateTime values without an offset.
`src/lib/db/pool.ts` pins every connection to `TimeZone=UTC`, otherwise a server
in another timezone (a local PostgreSQL on an Indian machine) would store every
timestamp 5½ hours off. `tests/integration/timestamps.test.ts` guards this.

## Not included

Push notifications, real-time sockets (polling is used), calendar sync with
Google/Outlook accounts (export only), recurring meetings, file attachments in
messages, and AI meeting summaries.

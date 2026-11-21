# Task assessments (proctored)

Every task an intern submits comes with a short, timed, proctored assessment that
checks the intern really did the work and how well they understand it. No one has
to watch live: the attempt is recorded and reviewed afterwards.

## Lifecycle

1. **Created on submission** (`task.submitted` → `assessmentJobs.onSubmitted`), for
   interns only. A resubmission cancels the previous version's open assessment.
2. **Drafted** (`PREPARING`): AYAVA AI writes 4 multiple-choice and 3 short-answer
   questions from the task, its checklist, the submission message and file names
   (`buildAssessmentQuestionsMessages` in `src/lib/ai/prompts.ts`). Without AI, or if
   it fails, the reviewer writes them (`source = MANUAL`, `generation_error` explains).
3. **Approved** (`AWAITING_APPROVAL` → `READY`, `assessment.manage`): the mentor /
   manager checks and edits the questions and settings (time limit 5–120 min, pass
   mark, violations before auto-submit), then approves. The intern is notified.
4. **Taken** (`IN_PROGRESS`, `assessment.take`): see *Proctoring* below.
5. **Submitted** (`SUBMITTED`): by the intern, automatically when time runs out
   (server-enforced, also by the daily job) or when the violation limit is passed.
   Multiple choice is marked at once; AI suggests points for short answers.
6. **Graded** (`GRADED`, `assessment.review`): the reviewer sets the final points
   (AI suggestions pre-filled — never final), giving a score and pass / fail plus
   the integrity score. It can be regraded.
7. **Waived** (`WAIVED`, `assessment.review`): with a reason (audited).

**Approval gate:** `taskSubmissionService.review(APPROVE)` calls
`assessmentService.assertApprovable` — an intern's submission can only be approved
once its assessment is graded and passed, or waived.

## Proctoring (browser)

`src/features/assessments/components/proctor-session.tsx`:

- Consent notice (version `CONSENT_VERSION`), then camera + microphone
  (`getUserMedia`) and the **entire screen** (`getDisplayMedia`; a window or tab is
  rejected, also server-side) and full screen.
- Continuous recording with `MediaRecorder` in 10 s WebM chunks (camera ~180 kbps
  with audio, screen ~300 kbps at ≤5 fps), uploaded to
  `POST /api/assessments/attempts/:id/chunks`. Each recorder run (start, reopened page,
  re-shared screen) is a separate *segment* (`SEGMENT_SIZE`) so playback works. Each chunk is retried with
  growing pauses for up to 2 minutes (a stalled connection loses nothing); a chunk finally lost is logged as
  `UPLOAD_FAILED` with the stream, the reason (network or HTTP status) and the number of tries.
- Detected and logged (`PROCTOR_EVENT_TYPES`): leaving full screen, switching tab,
  window blur, stopped screen share / camera / microphone, more than one screen,
  sustained sound, paste / copy / right-click / developer-tools keys (blocked),
  offline. `FULLSCREEN_EXIT`, `TAB_HIDDEN` and `SCREEN_SHARE_STOPPED` count as
  violations, and so does `AWAY_FROM_WINDOW`: focus in another window (e.g. Alt+Tab while still in full screen)
  for more than `AWAY_SECONDS` (3 s). Shorter focus losses are only logged; each return logs `WINDOW_FOCUS` with the
  seconds away. Leaving full screen, stopping the share or a counted absence blocks the questions until acknowledged.
- Answers autosave; the countdown uses the server clock; events flush every 5 s.

Browsers cannot truly stop someone switching tabs or using a second device — the
design detects, records and scores instead, and the recording is the evidence.

## Integrity score

`integrityScore()` in `src/lib/assessments/integrity.ts`: 100 minus weighted,
per-type-capped penalties, minus a penalty when camera or screen recording covers
less than 80% / 50% of the attempt. ≥80 *Clean*, ≥50 *Needs a look*, otherwise
*High risk*. It informs the reviewer; it never decides on its own.

## Privacy and retention

- Recordings are private storage objects (`<org>/recording/...`), streamed only to
  reviewers in scope via `GET /api/assessments/attempts/:id/recording/camera|screen?segment=N`;
  every viewing is audited (`ASSESSMENT_RECORDING_VIEWED`). Interns never see the
  answer key, rubrics, recordings or the integrity score.
- Deleted after `RECORDING_RETENTION_DAYS` (30) by `assessmentJobs.maintenance()` in
  the daily job; the database keeps a row marked deleted.
- `Permissions-Policy` allows camera, microphone and display capture for the site itself only.
- Storage: roughly 20 MB per 15-minute attempt (measured).

## Permissions

| Permission | Who (default) |
| --- | --- |
| `assessment.read` | HR / admins (organization), managers / mentors (their interns), interns (own) |
| `assessment.manage` | HR / admins, managers, mentors — approve questions and settings |
| `assessment.review` | HR / admins, managers, mentors — grade, waive, watch recordings |
| `assessment.take` | Interns |

Nobody can manage or review their own assessment.

## Tests

`tests/unit/assessments.test.ts` (integrity score), `tests/integration/assessments.test.ts`
(full flow, manual fallback, auto-submit on violations, resubmission, maintenance, scope).

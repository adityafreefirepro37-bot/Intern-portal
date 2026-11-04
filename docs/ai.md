# AYAVA AI

The assistant and knowledge layer of AYAVA Intern OS (Prompt 07). It answers from the signed-in person's own data
and from company documents, cites its sources, and can propose actions that run only after confirmation. It can never
see more than the person asking, and it never makes HR decisions.

## Turning it on

AI stays off until a provider is configured. In `.env` (or your hosting dashboard):

```bash
AI_PROVIDER="nvidia"
AI_API_KEY="nvapi-..."   # create one at https://build.nvidia.com
```

Restart the server, then open `/ai/settings` to confirm "Connected". Existing knowledge documents need **Reprocess**
to get semantic search if they were added before the provider was configured (they work with keyword search until then).

| Setting | Default | Purpose |
| --- | --- | --- |
| `AI_PROVIDER` | blank = off | `nvidia`, `openai`, or `compatible` (any OpenAI-compatible API) |
| `AI_API_KEY` | | Server-side only; never sent to the browser or logged |
| `AI_BASE_URL` | per provider | Required for `compatible`, e.g. a local Ollama |
| `AI_MODEL` | `meta/llama-3.3-70b-instruct` (nvidia), `gpt-4o-mini` (openai) | Chat model |
| `AI_FALLBACK_MODEL` | none | Tried once on provider failures; same provider, so data never goes elsewhere |
| `AI_EMBEDDING_MODEL` | `nvidia/nv-embedqa-e5-v5` (nvidia), `text-embedding-3-small` (openai) | `none` = keyword search only |
| `AI_TEMPERATURE`, `AI_MAX_TOKENS`, `AI_TIMEOUT_MS` | 0.2, 1024, 60000 | Model behaviour and limits |

Organization settings at `/ai/settings` (`ai.manage`): feature flags (AI, knowledge answers, action proposals, document
summaries, study mode), questions per person per day, tokens per month, and retention days.

## How a question is answered

```text
POST /api/ai/chat (session + same-origin check)
  → ai.use, organization switch, daily and monthly limits, rate limit
  → conversation (owner only)
  → routeQuestion: intent + data sources (deterministic; src/lib/ai/router.ts)
       restricted decision → fixed refusal, no model call
  → runTools: permission + risk + feature flag, then the domain service's own checks
  → knowledgeService.retrieve: visible documents first, then semantic + keyword ranking
       company question with nothing to cite → "I couldn't find this", no model call
  → buildMessages: rules, then fenced data, then fenced documents, then history and the question
  → provider.streamText → StreamRedactor → NDJSON events to the browser
  → store message, usage event, audit events
```

| Path | What lives there |
| --- | --- |
| `src/lib/ai/` | Pure logic: `router`, `prompts` (the only place prompts are defined), `safety`, `chunk` |
| `src/server/ai/provider.ts` | `AIProvider` interface and the OpenAI-compatible implementation (plain `fetch`, no SDK) |
| `src/server/ai/tools.ts` | Tool registry and page-context builder |
| `src/server/ai/authorization.ts` | `aiAuthorizationService`: tool policy checks and response focus |
| `src/server/ai/chat.service.ts` | The pipeline above |
| `src/server/ai/actions.service.ts` | Proposals, confirmation, execution |
| `src/server/ai/knowledge.service.ts`, `extract.ts` | Documents, versions, processing, retrieval |
| `src/server/ai/settings.service.ts` | Settings, limits, usage metrics, retention |
| `src/features/ai/` | Chat, action card, Markdown renderer, knowledge and settings UI |

## Tools

The AI has no database, SQL, filesystem or code access. It can only receive what these tools return, and each one calls
the same service the UI uses, so scope and organization rules are identical.

| Tool | Permission | Data |
| --- | --- | --- |
| `getContext` | `ai.use` + record access | The task, project, lesson, review, checklist or document being viewed |
| `getMyWork` | `task.read` | Own tasks by state, milestones |
| `getPendingReviews` | `task.review` | Submissions waiting for this reviewer |
| `getMyProjects` | `project.read` | Visible projects |
| `getMyLearning` | `course.read` | Courses, progress, due dates |
| `getMyGoals`, `getMyFeedback`, `getMyCheckins` | `goal.read`, `feedback.read`, `checkin.read` | Own, or interns in scope |
| `getMyLeave`, `getMyAttendance` | `leave.read`, `attendance.read` | Own records |
| `getOnboardingStatus` | `onboarding.read` | Own checklist, or the staff dashboard |
| `getAnnouncements` | `announcement.read` | Current announcements for this person |
| `getTeamOverview`, `findPeopleWork` | `intern.read` | Interns in scope only; "not found" and "no access" look the same |
| `getHrOverview` | `hr_dashboard.read` | HR queues and onboarding progress |
| `searchKnowledge` | `knowledge.read` + flag | Documents this person may read |

`compact()` then drops credentials, storage paths, IP addresses, compensation, personal contact details and quiz answers
as a second line of defence, and caps sizes. The model is never given quiz questions' answers.

## Actions

The model only *proposes*. A proposal is stored (`ai_action_requests`, 15-minute expiry), validated, and shown as a card
with editable fields. On **Confirm** the server re-validates and runs the normal `taskService.create`, so its permission
checks, audit entries and notifications apply. A proposal runs at most once, and only its owner can see or confirm it.

Available: `create_task`, `create_subtasks`.

There is no action type for approving or rejecting leave or attendance corrections, ratings, completing reviews,
changing roles or permissions, termination, hiring, promotion or compensation. Requests for these get a fixed refusal
with a link to the right page.

## Knowledge base

`/knowledge`: search and read for everyone with `knowledge.read`; add, edit, version, reprocess, archive and delete with
`knowledge.manage`.

Upload → validate (type, signature, size) → store → extract (PDF by page, DOCX, HTML, Markdown, text) → normalize →
chunk at headings, paragraphs and sentences → embed → READY. Scanned PDFs have no text layer and need OCR first.

| Visibility | Who can retrieve it |
| --- | --- |
| Organization | Everyone with `knowledge.read` |
| Department | Interns placed there, its head, leads of its teams |
| Team | Interns placed there and its lead |
| Role | Holders of that role |
| Project | Its owner, manager and members |
| Private | The uploader |

`knowledge.manage` holders see all documents. Visibility is applied in the query that selects candidate documents,
before anything is scored or sent to a model.

**Search:** embeddings are stored as `real[]` and scored by the `ayava_cosine_similarity()` SQL function, so it works on
any PostgreSQL (the local development database has no pgvector). Keyword search uses a generated `tsvector` column. The
two rankings are combined with reciprocal rank fusion. This suits organization-sized collections; if a collection
grows to hundreds of thousands of chunks, move `embedding` to pgvector with an index.

**Versions:** a new version stays out of use until it finishes processing, then becomes current. Older versions are kept
and only current versions are retrieved.

## Security

- **Prompt injection:** rules come first; documents, tool results and pasted text are fenced as data, closing tags inside
  them are neutralized, and the rules say never to follow instructions found there. This reduces the risk but no model
  can guarantee it, so the real protection is structural: the model holds no credentials, can't call tools itself, and
  only ever receives data the person may already see. Even a fully compromised answer can't reach other people's data or
  perform an action without confirmation.
- **Leakage:** answers pass through a redactor (known secret values and key-shaped strings), including across streamed chunks.
- **Isolation:** conversations and proposals are private to their owner, including from administrators. Every query is
  scoped to the organization.
- **Logs and audit:** metadata only, never prompts, answers or document text. Usage metrics are counts.
- **Provider errors:** people see "AYAVA AI is temporarily unavailable"; details stay in server logs.
- **Rendering:** answers are rendered as React elements (no HTML), and links are limited to internal paths and http(s).
- **Uploaded HTML** is only ever downloaded as an attachment, never rendered.

Audit events: `ai.conversation_created`, `ai.query_sent`, `ai.tool_called`, `ai.knowledge_retrieved`,
`ai.action_proposed`, `ai.action_confirmed`, `ai.action_cancelled`, `ai.action_executed`, `ai.action_failed`,
`ai.restricted_request`, `ai.error`, `ai.settings_updated`, `knowledge.*`.

## Limits

| Limit | Value |
| --- | --- |
| Questions | 12 per minute per person; daily limit in settings (default 100) |
| Organization tokens | Monthly limit in settings (default 2,000,000; 0 = none) |
| Confirmations | 10 per minute per person |
| Uploads / reprocessing | 30 per 10 minutes per person |
| Upload size | `STORAGE_MAX_UPLOAD_MB` (10 MB). Vercel's serverless limit is 4.5 MB per request |
| Retention | Conversations 180 days unused, usage records 365 days (daily job; configurable) |

## Tests

- `tests/unit/ai.test.ts`: routing, redaction, compaction, fences, prompts, chunking, person matching, configuration, the
  provider over mocked HTTP (streaming, fallback, timeouts, cancellation, error safety), structured output.
- `tests/unit/ai-extract.test.ts`: real PDF, Word and HTML files. PDF cases run in a child Node process because Jest's
  sandbox can't run PDF.js.
- `tests/integration/ai.test.ts`: real PostgreSQL with a recording fake provider: conversation isolation, tool scope,
  restricted requests, visibility, cross-organization isolation, injection fencing, versions, confirmation bypass.
- `tests/e2e/app/ai.spec.ts`: UI stories. Chat stories need a provider: set `E2E_AI=1`.

Automated tests use a fake provider, so they prove the application's behaviour, not a real model's. Check answer quality
with a real key, including how the chosen model responds to injected instructions.

## Not built yet

- **Meetings:** summaries and preparation wait for the calendar work in Phase 08.
- **More actions:** `create_task` and `create_subtasks` only. Goals, HR requests and drafted announcements are not yet
  available as confirmed actions (the AI can draft text for them).
- **OCR** for scanned PDFs.
- **Other provider protocols:** Anthropic and native Gemini APIs would need their own `AIProvider` implementation.

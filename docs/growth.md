# Growth: lead sourcing, auto-audit and scoring (phase 1)

The portal finds businesses Ayava could help, audits each one automatically and
scores it, so outreach starts from a short list of good prospects with a
specific, useful reason to get in touch. **Nothing is sent to anyone in phase 1**:
outreach (email sequences, replies, booking) is phase 2.

## Pipeline

Run by the background worker (`POST /api/jobs/worker`, every 5 minutes; see
*Scheduler* below). Code: `src/server/leads/pipeline.ts`.

1. **Search** (`lead.search`): one page of an *industry × city × term* search.
   TomTom Search returns up to 100 businesses per call within 15 km of the city
   centre (geocoded once per city and cached in `settings.key = 'growth_geo'`);
   Google Places API (New) text search returns up to 20; OpenStreetMap (Overpass)
   returns all matches at once. New businesses become
   leads; duplicates (same listing, website domain or phone) and opted-out
   businesses (`lead_suppressions`) are skipped. Searches are created from the
   active industries × the cities in Growth settings (`syncSearches`) and run again
   30 days after they finish, to pick up new businesses. Searches **rotate through
   industries** (the one searched least recently goes next, then its least recently
   searched city / term), and imports take an advisory lock per organization so
   parallel searches never go over `newLeadsDailyCap`.
2. **Finding the website** (`lead.find_site`, only when the listing has none —
   TomTom rarely lists one in Indian towns). Fully automatic, using public pages only
   (`src/lib/leads/site-match.ts`):
   - *Likely addresses* (free): built from the business name
     (`shreebabaproperties.com`, `.in`, `.co.in`, with the city…), checked in DNS,
     then opened.
   - *Web search* (Brave Search API, when `BRAVE_SEARCH_API_KEY` is set): the name and
     city; directories, maps, marketplaces and social sites are ignored.
   - A page is taken as the business's website **only when it proves it**: every
     distinctive word of the name plus the listed phone number or the city (or the
     phone number with part of the name). Parked and placeholder pages are rejected.
     Every page tried, and why, is shown on the lead page.
   - `websiteLookup.result`: `found`, `not_found` (only after a web search found
     nothing) or `waiting` (no search key yet, or today's allowance used — the
     scheduler searches again by itself). A lead *waiting* isn't scored yet, and
     **"No website found" is only claimed after a web search**, never because a
     listing lacked one.
3. **Research** (`lead.research`): the homepage, the contact page and
2. **Research** (`lead.research`): the homepage, the contact page and
   `sitemap.xml` / `robots.txt` are fetched (`safe-fetch.ts`: http(s) only, no
   private addresses on any redirect hop, 12 s timeout, 1.5 MB limit) and read by
   `analyzeHtml()` (`src/lib/leads/audit.ts`). Only compact signals are stored,
   never the page. The email kept is one **the business publishes itself** — on
   its own domain, or a free mailbox (gmail…) shown on its site, never another
   company's (often the web designer's in the footer) — whose domain has a mail
   server (MX), and not opted out (`ownEmails`, `publishedEmail`).
4. **Speed** (`lead.speed`): PageSpeed Insights (mobile), with `PAGESPEED_API_KEY`
   (or `GOOGLE_MAPS_API_KEY`), else keyless (shared, rate-limited quota). A failure
   only drops that signal.
5. **Score**: `findingsFor()` turns the signals, the Google rating and the
   industry's extra checks into findings, each mapped to one of Ayava's 15
   services; `scoreLead()` (`src/lib/leads/score.ts`) gives *need* (sum of
   severity weights) and *fit* (industry priority, rating, reviews, reachable)
   → **Hot / Warm / Skip**, with every point explained. Outreach is automatic and by
   email, so with `requireEmail` (default on) a lead without a published email is
   Skip. Hot and Warm leads get a private audit page.
6. **Summary** (`lead.summary`): AYAVA AI words the top three problems and one
   opening line (`buildLeadSummaryMessages`). It sees only the portal's findings
   and the *verified proof* list from settings, and may not invent facts;
   invented service names are dropped. Until then (or without AI) a rules-based
   summary is used.

Leads researched with an older audit format (`audit.version` 1) are researched
again automatically, 20 per worker run.

Things a browser can't check automatically (whether Instagram is active, whether
they run ads) are a checklist for the reviewer, with links (Meta Ad Library).

## Free usage

| Source | Cost | Limit in the portal |
| --- | --- | --- |
| TomTom Search (free developer account, no card) | free allowance (check developer.tomtom.com/pricing) | `tomtomDailyCap` (60) and `tomtomMonthlyCap` (2,000), counted in `lead_api_usage` (geocoding included) |
| Google Places text search (website, phone, rating = *Enterprise* SKU) | 1,000 free calls / month | `placesDailyCap` (30) and `placesMonthlyCap` (950), counted in `lead_api_usage` before each call |
| PageSpeed Insights | free (an API key needs no billing account) | counted for visibility |
| Brave Search API (finding websites) | about $5 of free credit a month ≈ 1,000 searches (card required) | `siteSearchDailyCap` (30) and `siteSearchMonthlyCap` (900), counted in `lead_api_usage` (`brave_search`) |
| Likely-address checks | free (DNS + opening the page) | at most 3 pages per lead |
| OpenStreetMap Overpass | free (public servers are often overloaded; a retry goes to another server) | one search per worker run |
| AI summaries | your AI provider | one per Hot / Warm lead |

Also set a quota or budget alert in Google Cloud as a second safety net.

## Industries

30 industries (`src/lib/leads/catalog.ts`, seeded into `lead_industries`) with
Google search terms, OpenStreetMap tags, extra checks (`booking`, `ordering`,
`direct_booking`, `store`, `portfolio`, `lead_form`, `menu`) and a priority.
Admins switch industries on or off, change priority and terms in Growth settings.

## Private audit page

`/audit/<token>` (public, `noindex`, 24-character random token, expires after
`auditPageDays`). Shows only the business name and the audit — never contact
details or notes. A view is counted by the browser after 4 s of visibility (link
scanners don't count); the second view notifies the lead's assignee (or the
people with `lead.manage`). **"Remove my business's data"** erases contact details
and the audit, adds the listing, domain, phone and email to `lead_suppressions`
and marks the lead *Do not contact*; it is never imported again.

## Permissions

| Permission | Who (default) |
| --- | --- |
| `lead.manage` | Admins (organization): settings, industries, searches, assigning, manual leads, re-audit, "Run now" |
| `lead.read`, `lead.update` | Admins (organization); interns (ASSIGNED = leads assigned to them): review checklist, notes, decision |

## Scheduler

Supabase `pg_cron` + `pg_net` call the portal (free, inside the database):

```bash
# .env: DIRECT_URL / DATABASE_URL = production database, CRON_SECRET = same value as in Vercel
npm run scheduler:setup -- --url https://your-portal.example.com
npm run scheduler:setup -- --status
```

`ayava-daily` → `/api/jobs/daily` at 06:00 IST, `ayava-worker` → `/api/jobs/worker`
every 5 minutes. The secret is stored in Supabase Vault. Locally:
`npm run jobs:worker`.

The job queue (`src/server/jobs/queue.ts`, table `background_jobs`) claims work
with `FOR UPDATE SKIP LOCKED`, retries failures with backoff (1, 4, 9… minutes)
up to `max_attempts`, releases jobs a crashed run left behind after 10 minutes,
and ignores a duplicate enqueue for an open `dedupe_key`.

## Configuration

- `TOMTOM_API_KEY`: a TomTom developer key (free, no card): the main source.
- `GOOGLE_MAPS_API_KEY`: a Google Cloud key with *Places API (New)* (needs a billing
  account). Optional; without it Google is skipped.
- `PAGESPEED_API_KEY`: a Google Cloud key restricted to *PageSpeed Insights API*
  (no billing account needed). Optional.
- `BRAVE_SEARCH_API_KEY`: Brave Search API key (api-dashboard.search.brave.com, free
  monthly credit). Optional; without it only likely addresses are tried and leads
  without a found website wait.
- Sources without a key are skipped; OpenStreetMap needs none.
- `CRON_SECRET`: required for the worker and daily endpoints.
- Growth settings (`settings.key = 'growth'`): on/off, cities, sources, caps, web
  search on/off and caps, require email, AI summaries, verified proof, audit-page
  lifetime.

## Tests

`tests/unit/leads.test.ts` (analysis, findings, score, website matching, own
emails, catalogue, address guards), `tests/integration/leads.test.ts` (search →
find site → research → speed → score → summary with fake sources: a site found at a
likely address after a parked one, one found by web search past a directory, a
confirmed "no website", a lead waiting for search, older audits researched again,
allowance caps, de-duplication, audit page views and removal, intern scope, manual
leads, job queue retries).

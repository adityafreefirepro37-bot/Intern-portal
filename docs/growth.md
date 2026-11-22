# Growth: lead sourcing, full-service audit, review and outreach

The portal finds businesses Ayava could help, audits each one against every
service Ayava offers, decides who should contact it, and emails the rest
automatically: a first email built from the audit, two follow-ups, and a person
takes over as soon as anyone replies. Serious cases (Hot leads that look like a
big business) go to the team instead. Everything uses official APIs and public
pages only, and every email can be unsubscribed from in one click.

## Pipeline

Run by the background worker (`POST /api/jobs/worker`, every 5 minutes; see
*Scheduler* below). Code: `src/server/leads/pipeline.ts`, then
`src/server/outreach/engine.ts`.

1. **Search** (`lead.search`): one page of an *industry × city × term* search.
   TomTom Search returns up to 100 businesses per call within 15 km of the city
   centre (geocoded once per city and cached in `settings.key = 'growth_geo'`);
   Google Places API (New) text search returns up to 20; OpenStreetMap (Overpass)
   returns all matches at once. New businesses become leads; duplicates (same
   listing, website domain or phone) and opted-out businesses (`lead_suppressions`)
   are skipped. Searches are created from the active industries × the cities in
   Growth settings (`syncSearches`) and run again 30 days after they finish.
   Searches **rotate through industries** (the one searched least recently goes
   next, then its least recently searched city / term), and imports take an
   advisory lock per organization so parallel searches never go over
   `newLeadsDailyCap`.
2. **Finding the website** (`lead.find_site`, only when the listing has none —
   TomTom rarely lists one in Indian towns), using public pages only
   (`src/lib/leads/site-match.ts`):
   - *Likely addresses* (free): built from the business name
     (`shreebabaproperties.com`, `.in`, `.co.in`, with the city…), checked in DNS,
     then opened. One-word guesses (`friends.com`) are never tried.
   - *Web search* (Brave Search API, when `BRAVE_SEARCH_API_KEY` is set): the name and
     city; directories, maps, marketplaces and social sites are ignored.
   - A page is taken as the business's website **only when it proves it**: every
     distinctive word of the name plus the listed phone number or the city (also
     looked for on its contact page), or the phone number with part of the name.
     Parked and placeholder pages are rejected. Every page tried, and why, is shown
     on the lead page.
   - `websiteLookup.result`: `found`, `not_found` (only after a web search found
     nothing) or `waiting` (no search key yet, or today's allowance used — the
     scheduler searches again by itself). A lead *waiting* isn't scored yet, and
     **"No website found" is only claimed after a web search**.
3. **Research** (`lead.research`): the homepage, the contact page, the sitemap
   (size and newest date), `robots.txt` and the favicon are fetched (`safe-fetch.ts`:
   http(s) only, no private addresses on any redirect hop, 12 s timeout, 1.5 MB
   limit) and read by `analyzeHtml()` (`src/lib/leads/audit.ts`): mobile, HTTPS,
   platform, analytics, Meta Pixel, Google Ads tag, schema markup, noindex, logo,
   video, chat widgets, testimonials, newsletter, booking / ordering / store, app
   links, socials. Only compact signals are stored, never the page. The email kept
   is one **the business publishes itself** — on its own domain, or a free mailbox
   (gmail…) shown on its site, never another company's (often the web designer's in
   the footer) — whose domain has a mail server (MX), and not opted out.
4. **Speed** (`lead.speed`): PageSpeed Insights (mobile): performance plus the
   Lighthouse SEO, accessibility and best-practice scores from the same run.
5. **Presence** (`lead.presence`):
   - *Search visibility*: where the site appears in a web search for
     "*industry term* *city*" (Brave; one search per industry × city, cached for a
     month in `lead_serps` and shared by every lead), and which competitors appear.
   - *Instagram*: the public business profile the site links to (Instagram Graph API
     business discovery: followers, posts, last post date, engagement), when
     `INSTAGRAM_ACCESS_TOKEN` / `INSTAGRAM_BUSINESS_ID` are set.
   - *YouTube*: subscribers, videos and last upload of the linked channel, when
     `YOUTUBE_API_KEY` is set.
6. **Score**: `findingsFor()` turns the signals into findings, each mapped to one
   of Ayava's services — Website, SEO (Lighthouse SEO, noindex, schema, search
   ranking), Google Ads, Meta Ads, Social media (Instagram activity, followers,
   engagement), Video, Content (freshness), Branding (favicon, logo), AI (chat
   assistant), Analytics/CRO (tap-to-call, enquiry form, tracking), Email/CRM,
   Reputation (rating, testimonials), E-commerce. Influencer marketing and ASO
   can't be judged automatically. `scoreLead()` gives *need* and *fit* → **Hot /
   Warm / Skip**, with every point explained; with `requireEmail` (default on) a
   lead without a published email is Skip. Hot and Warm leads get a private audit page.
7. **Review** (`reviewLead()`, `src/lib/leads/review.ts`): a Hot lead with at
   least `bigBusinessSignals` (2) signs of size — 100+ Google reviews, 5,000+
   Instagram followers, 2,000+ YouTube subscribers, a 50+ page site, ad tracking on
   the site, a high-value industry — goes to the **team** (people with
   `lead.manage` are notified); other Hot and Warm leads with an email get the
   **automatic** emails.
8. **Summary** (`lead.summary`): AYAVA AI words the top three problems
   (`buildLeadSummaryMessages`), from the findings and the *verified proof* list only.
9. **Outreach** (see below).

Leads researched with an older audit format are researched again automatically,
20 per worker run, so new checks reach existing leads.

## Outreach

Code: `src/server/outreach/engine.ts` (worker), `mailer.ts` (SMTP / IMAP / DNS),
`src/lib/leads/outreach.ts` (rules), `outreach.service.ts` (Growth → Outreach page).

- **Enrol**: AUTO-route Hot / Warm leads with a published email and an open audit
  page (`outreach.draft`).
- **Draft**: AI writes the first email from the findings
  (`buildOutreachEmailMessages`). `draftProblem()` rejects a draft that invents a
  number, adds links, email addresses or prices, uses spammy wording, misses the
  audit link or doesn't name the business — the template is used instead. The
  stored email is exactly what will be sent.
- **Approval**: the first `approvalsRequired` (50) first emails wait in Growth →
  Outreach for an admin (approve, edit or don't send); then they send on their own.
- **Send** (`outreach.send`): only in the sending window (India time, Mon–Sat
  10:00–18:00 by default), one email per mailbox per worker run (4 minutes apart),
  and a warm-up per mailbox: 5 a day, +3 a day, up to `mailboxDailyMax` (40).
- **Follow-ups**: two short follow-ups in the same thread (`followUpGapDays`, 3
  and 4 days), from the same mailbox; the last says it is the last.
- **Every email** shows the sender, company, website, postal address, why they got
  it, and an unsubscribe link; it also carries `List-Unsubscribe` and one-click
  (`List-Unsubscribe-Post`) headers. The footer link opens a confirm page
  (`/unsubscribe/<token>`), so link scanners can't unsubscribe anyone.
- **Inbox** (`outreach.inbox`, every 10 minutes per mailbox, IMAP): a reply stops
  the sequence and notifies the lead's owner (answer it personally from that
  mailbox); automatic replies are ignored; bounces and "unsubscribe / remove me"
  replies suppress the address and stop everything. An SMTP refusal of the
  address counts as a bounce.
- **Readiness**: nothing is sent until outreach is switched on, the sender's name
  and postal address are set, mailboxes are configured, `NEXT_PUBLIC_APP_URL` is
  the public address, and each sending domain has an SPF record. The page also
  shows DKIM and DMARC.
- Leads whose status changes (not a fit, do not contact), that are handed to the
  team or opt out on the audit page are never emailed again; scheduled emails are
  cancelled when it's their turn.

## Free usage

| Source | Cost | Limit in the portal |
| --- | --- | --- |
| TomTom Search (free developer account, no card) | free allowance (check developer.tomtom.com/pricing) | `tomtomDailyCap` (60) and `tomtomMonthlyCap` (2,000), counted in `lead_api_usage` (geocoding included) |
| Google Places text search (website, phone, rating = *Enterprise* SKU) | 1,000 free calls / month | `placesDailyCap` (30) and `placesMonthlyCap` (950), counted in `lead_api_usage` before each call |
| PageSpeed Insights | free (an API key needs no billing account) | counted for visibility |
| Brave Search API (finding websites) | about $5 of free credit a month ≈ 1,000 searches (card required) | `siteSearchDailyCap` (30) and `siteSearchMonthlyCap` (900), counted in `lead_api_usage` (`brave_search`) |
| Likely-address checks | free (DNS + opening the page) | at most 3 pages per lead |
| OpenStreetMap Overpass | free (public servers are often overloaded; a retry goes to another server) | one search per worker run |
| Brave Search API (search visibility) | shares the allowance above | one search per industry × city per month |
| Instagram Graph API | free (about 200 calls an hour) | `instagramDailyCap` (150) |
| YouTube Data API | free (10,000 units a day; ~3 per channel) | `youtubeDailyCap` (300) |
| Outreach email | your mailboxes (Hostinger) | warm-up, `mailboxDailyMax` (40) per mailbox |
| AI summaries and first emails | your AI provider | one each per Hot / Warm lead |

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
- `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_BUSINESS_ID`: a long-lived token from a Meta app
  and Ayava's Instagram business account id (Instagram Graph API). Optional.
- `YOUTUBE_API_KEY`: YouTube Data API key (Google Cloud, no billing). Optional.
- `OUTREACH_MAILBOXES`: the sending mailboxes as JSON
  (`[{"email":"…","password":"…","name":"…"}]`); passwords live only in the hosting
  provider's secret settings. `OUTREACH_SMTP_HOST` / `_PORT`, `OUTREACH_IMAP_HOST` /
  `_PORT` default to Hostinger.
- Sources without a key are skipped; OpenStreetMap needs none.
- `CRON_SECRET`: required for the worker and daily endpoints.
- Growth settings (`settings.key = 'growth'`): on/off, cities, sources, caps, web
  search on/off and caps, require email, AI summaries, verified proof, audit-page
  lifetime.

## Tests

`tests/unit/leads.test.ts` (analysis, findings for every service, score, review,
website matching, own emails, catalogue, address guards), `tests/unit/outreach.test.ts`
(emails, draft checks, sending window, warm-up, reply / bounce classification),
`tests/integration/outreach.test.ts` (drafts, approval, sending with unsubscribe
headers, follow-ups in the thread, replies, bounces, unsubscribe, SPF gate), `tests/integration/leads.test.ts` (search →
find site → research → speed → score → summary with fake sources: a site found at a
likely address after a parked one, one found by web search past a directory, a
confirmed "no website", a lead waiting for search, older audits researched again,
allowance caps, de-duplication, audit page views and removal, intern scope, manual
leads, job queue retries).

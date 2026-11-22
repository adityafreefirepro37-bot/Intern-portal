import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/errors'
import type { RequestContext } from '@/server/context'
import { setAIProviderForTesting, type AIProvider, type GenerateOptions, type StreamEvent } from '@/server/ai/provider'
import { enqueueJob, runJobs } from '@/server/jobs/queue'
import { runWorker } from '@/server/jobs/worker'
import { importBusinesses } from '@/server/leads/pipeline'
import { setLeadSourcesForTests, type FoundBusiness, type LeadSources } from '@/server/leads/sources'
import { leadService, publicAuditService } from '@/server/services/lead.service'
import { NOTIFICATION_TYPES } from '@/server/services/notification.service'
import { AYAVA_ORGANIZATION_ID, contextFor, prisma } from './helpers'

const NEGLECTED = `<html><head><title></title></head><body><img src="1.jpg"><img src="2.jpg"><img src="3.jpg"><img src="4.jpg">
  <p>Welcome to Cafe Mocha</p><a href="/files/menu.pdf">Menu</a><p>Copyright 2019 Cafe Mocha</p>
  <p>Write to info@cafe-mocha.example</p><p>Site by hello@webdesigner.example</p></body></html>`

const filler = 'Fresh, home-style food cooked every day for families, students and travellers. '.repeat(5)
/** Pages that exist only on addresses the website finder guesses or searches for. */
const FOUND_PAGES: Record<string, string> = {
  'https://doondhaba.com/': `<html><body>doondhaba.com is for sale! Buy this domain. ${filler}</body></html>`,
  'https://doondhaba.in/': `<html><head><title>Doon Dhaba</title></head><body><p>Doon Dhaba, Rajpur Road. Call 98111-11111 or doondhaba@gmail.com</p><p>${filler}</p></body></html>`,
  'https://rajpurmomos.co.in/menu': `<html><head><title>Menu | Rajpur Momos Corner</title></head><body><p>Rajpur Momos Corner, Rajpur Road, Dehradun.</p><p>${filler}</p></body></html>`,
  'https://rajpurmomos.co.in/': `<html><head><title>Rajpur Momos Corner</title></head><body><p>Rajpur Momos Corner, Dehradun. orders@rajpurmomos.co.in</p><p>${filler}</p></body></html>`,
  'https://hiddenbakers.example/': `<html><head><title>Hidden Bakers Studio</title></head><body><p>Hidden Bakers Studio: cakes to order. WhatsApp 98555 55555, hello@hiddenbakers.example</p><p>${filler}</p></body></html>`,
}

const businesses: FoundBusiness[] = [
  { externalId: 'place-no-site', name: 'Doon Dhaba', category: 'Restaurant', address: 'Rajpur Road', phone: '+91 98111 11111', website: null, email: null, mapsUrl: 'https://maps.google.com/?cid=1', rating: 4.5, reviewCount: 60, businessStatus: 'OPERATIONAL', latitude: 30.3, longitude: 78 },
  { externalId: 'place-mocha', name: 'Cafe Mocha', category: 'Cafe', address: 'Paltan Bazaar', phone: '+91 98222 22222', website: 'http://cafe-mocha.example', email: null, mapsUrl: 'https://maps.google.com/?cid=2', rating: 3.4, reviewCount: 8, businessStatus: 'OPERATIONAL', latitude: 30.3, longitude: 78 },
  { externalId: 'place-closed', name: 'Old Bakery', category: 'Bakery', address: 'Clock Tower', phone: '+91 98333 33333', website: 'https://old-bakery.example', email: null, mapsUrl: null, rating: 4.1, reviewCount: 30, businessStatus: 'CLOSED_PERMANENTLY', latitude: null, longitude: null },
  { externalId: 'place-momos', name: 'Rajpur Momos Corner', category: 'Restaurant', address: 'Rajpur Road', phone: '+91 98444 44444', website: null, email: null, mapsUrl: null, rating: 4.2, reviewCount: 25, businessStatus: 'OPERATIONAL', latitude: null, longitude: null },
  { externalId: 'place-tiffin', name: 'Sunrise Tiffin Service', category: 'Restaurant', address: 'Prem Nagar', phone: '+91 98666 66666', website: null, email: null, mapsUrl: null, rating: 4.0, reviewCount: 12, businessStatus: 'OPERATIONAL', latitude: null, longitude: null },
]

class FakeSources implements LeadSources {
  searches: string[] = []
  pages: string[] = []
  geocoded: string[] = []
  tomtomOn = false
  placesConfigured() {
    return true
  }
  tomtomConfigured() {
    return this.tomtomOn
  }
  async tomtomGeocode(city: string) {
    this.geocoded.push(city)
    return { lat: 30.32, lon: 78.03 }
  }
  async tomtomSearch(term: string, near: { lat: number; lon: number }) {
    this.searches.push(`tomtom:${term}@${near.lat}`)
    return {
      nextPageToken: null,
      businesses: [
        { externalId: 'tt-1', name: 'Tom Bistro', category: 'restaurant', address: 'EC Road, Dehradun', phone: '+91 135 2700000', website: 'www.tom-bistro.example', email: null, mapsUrl: 'https://www.google.com/maps/search/?api=1&query=Tom%20Bistro', rating: null, reviewCount: null, businessStatus: null, latitude: 30.32, longitude: 78.04 },
      ],
    }
  }
  async placesTextSearch(query: string) {
    this.searches.push(query)
    return { businesses, nextPageToken: null }
  }
  async osmSearch() {
    return []
  }
  async pageSpeed() {
    return { performance: 28, lcpMs: 7900, cls: 0.2 }
  }
  async fetchPage(url: string) {
    this.pages.push(url)
    if (url === 'http://cafe-mocha.example/') return { url, status: 200, contentType: 'text/html', text: NEGLECTED }
    if (FOUND_PAGES[url]) return { url, status: 200, contentType: 'text/html', text: FOUND_PAGES[url] }
    return { url, status: 404, contentType: 'text/html', text: 'Not found' }
  }
  webSearchOn = true
  webSearches: string[] = []
  webSearchConfigured() {
    return this.webSearchOn
  }
  async webSearch(query: string) {
    this.webSearches.push(query)
    if (query.includes('Rajpur Momos'))
      return [
        { url: 'https://www.justdial.com/Dehradun/Rajpur-Momos-Corner', title: 'Rajpur Momos Corner - Justdial' },
        { url: 'https://rajpurmomos.co.in/menu', title: 'Menu | Rajpur Momos Corner' },
      ]
    if (query.includes('Hidden Bakers')) return [{ url: 'https://hiddenbakers.example/', title: 'Hidden Bakers Studio' }]
    return []
  }
  async hostResolves(host: string) {
    return Object.keys(FOUND_PAGES).some((url) => new URL(url).hostname === host)
  }
  async hasMailServer(domain: string) {
    return domain !== 'no-mail.example'
  }
}

class FakeAI implements AIProvider {
  readonly name = 'fake'
  readonly model = 'fake-chat'
  readonly embeddingModel = null
  calls: GenerateOptions[] = []
  async generateText(options: GenerateOptions) {
    this.calls.push(options)
    const text = JSON.stringify({
      problems: [
        { title: 'Your site is hard to use on phones', detail: 'Most diners search on their phones, and the page doesn’t fit the screen.' },
        { title: 'The menu is a PDF', detail: 'PDF menus are slow to open on mobile.' },
      ],
      services: ['Website Design', 'Not a real service'],
      opener: 'I noticed your menu is a PDF that is hard to read on a phone.',
    })
    return { text, provider: this.name, model: this.model, usage: { input: 20, output: 30 } }
  }
  async *streamText(): AsyncIterable<StreamEvent> {
    throw new Error('not used')
  }
  async embed(): Promise<never> {
    throw new Error('not used')
  }
}

let admin: RequestContext
let intern: RequestContext
let sources: FakeSources
let ai: FakeAI

async function drain() {
  // Each run claims what is queued; follow-up jobs (research → speed → summary) run in the next batches.
  for (let i = 0; i < 6; i++) await runWorker(200_000)
}

beforeAll(async () => {
  ;[admin, intern] = await Promise.all([contextFor('admin@ayavacreatives.com'), contextFor('intern@ayavacreatives.com')])
  const org = AYAVA_ORGANIZATION_ID
  await prisma.backgroundJob.deleteMany({})
  await prisma.lead.deleteMany({ where: { organization_id: org } })
  await prisma.leadSearch.deleteMany({ where: { organization_id: org } })
  await prisma.leadSuppression.deleteMany({ where: { organization_id: org } })
  await prisma.leadApiUsage.deleteMany({ where: { organization_id: org } })
  await prisma.setting.deleteMany({ where: { organization_id: org, key: { in: ['growth', 'ai'] } } })
  // Keep the run small: one industry (F&B, 3 search terms) in one city.
  await prisma.leadIndustry.updateMany({ where: { organization_id: org }, data: { active: false } })
  await prisma.leadIndustry.updateMany({ where: { organization_id: org, key: 'fnb_qsr' }, data: { active: true } })
  sources = new FakeSources()
  ai = new FakeAI()
  setLeadSourcesForTests(sources)
  setAIProviderForTesting(ai)
})

afterAll(async () => {
  setLeadSourcesForTests(null)
  setAIProviderForTesting(undefined)
  await prisma.leadIndustry.updateMany({ where: { organization_id: AYAVA_ORGANIZATION_ID }, data: { active: true } })
  await prisma.$disconnect()
})

describe('Growth pipeline', () => {
  it('finds, de-duplicates, audits, scores and summarises businesses inside the Google allowance', async () => {
    const saved = await leadService.saveSettings(admin, { enabled: true, cities: ['Dehradun'], tomtomEnabled: true, tomtomDailyCap: 60, tomtomMonthlyCap: 2000, googleEnabled: true, osmEnabled: false, placesDailyCap: 2, placesMonthlyCap: 950, newLeadsDailyCap: 300, aiSummaries: true, proof: [], auditPageDays: 90 })
    expect(saved.searches).toBe(7) // 3 terms × (TomTom + Google) + 1 OpenStreetMap; TomTom has no key here and OSM is off

    await drain()

    // Two searches ran (the daily cap); the second returned the same businesses, which weren't added twice.
    expect(sources.searches).toHaveLength(2)
    expect(sources.searches[0]).toMatch(/ in Dehradun$/)
    const usage = await prisma.leadApiUsage.findMany({ where: { organization_id: AYAVA_ORGANIZATION_ID } })
    expect(usage.find((u) => u.api === 'places_text_search')?.calls).toBe(2)
    expect(usage.find((u) => u.api === 'pagespeed')?.calls).toBe(3) // Mocha + the two websites found
    // Only the two businesses whose website wasn't guessed were searched for.
    expect(sources.webSearches.sort()).toEqual(['"Rajpur Momos Corner" Dehradun', '"Sunrise Tiffin Service" Dehradun'])
    expect(usage.find((u) => u.api === 'brave_search')?.calls).toBe(2)

    const leads = await prisma.lead.findMany({ where: { organization_id: AYAVA_ORGANIZATION_ID }, orderBy: { name: 'asc' } })
    expect(leads.map((l) => l.name)).toEqual(['Cafe Mocha', 'Doon Dhaba', 'Old Bakery', 'Rajpur Momos Corner', 'Sunrise Tiffin Service'])
    expect(leads.every((l) => l.research_status === 'DONE')).toBe(true)
    const [mocha, dhaba, bakery, momos, tiffin] = leads as [(typeof leads)[0], (typeof leads)[0], (typeof leads)[0], (typeof leads)[0], (typeof leads)[0]]

    expect(mocha.tier).toBe('HOT')
    expect(mocha.need_score).toBe(100)
    expect(mocha.email).toBe('info@cafe-mocha.example') // not the web designer's address in the footer
    expect(mocha.summary_source).toBe('AI')
    expect((mocha.summary as { services: string[] }).services).toEqual(['Website Design']) // invented services dropped
    expect(mocha.audit_token).toMatch(/^[A-Za-z0-9_-]{24}$/)
    expect((mocha.audit as { speed: { performance: number } }).speed.performance).toBe(28)

    // No website listed: the guessed .com was a parked page; the .in named the business with its phone number.
    expect(dhaba.website).toBe('https://doondhaba.in/')
    expect(dhaba.email).toBe('doondhaba@gmail.com')
    expect(dhaba.audit).toMatchObject({ version: 2, websiteSource: 'guess', websiteLookup: { result: 'found', guessed: true, searched: false } })
    expect((dhaba.audit as { websiteLookup: { tried: { url: string; reason: string }[] } }).websiteLookup.tried).toEqual([
      { url: 'https://doondhaba.com/', reason: 'parked or placeholder page' },
      { url: 'https://doondhaba.in/', reason: 'name and phone number match' },
    ])
    expect(dhaba.tier).toBe('HOT')

    // Found by the web search (the directory result was ignored); the email is the one on its own site.
    expect(momos).toMatchObject({ website: 'https://rajpurmomos.co.in/', email: 'orders@rajpurmomos.co.in' })
    expect(momos.audit).toMatchObject({ websiteSource: 'search', websiteLookup: { result: 'found', searched: true } })
    expect(momos.tier).not.toBe('SKIP')

    // Searched and nothing found: "No website found" is a fair finding, but there's no email to contact them.
    expect(tiffin.website).toBeNull()
    expect(tiffin.audit).toMatchObject({ websiteLookup: { result: 'not_found', searched: true } })
    expect(tiffin.tier).toBe('SKIP')
    expect((tiffin.score_reasons as string[]).at(-1)).toBe('Skipped: no published email address to contact them')
    expect((await leadService.get(admin, tiffin.id)).findings.map((f) => f.title)).toEqual(['No website found', 'Only 12 Google reviews'])

    expect(bakery.tier).toBe('SKIP') // permanently closed
    expect(bakery.audit_token).toBeNull()

    // The AI only saw the portal's findings and was told never to invent facts.
    expect(String(ai.calls[0]!.messages[0]!.content)).toMatch(/Use ONLY the findings provided/)

    // Allowance used up: another run doesn't search again.
    await runWorker(30_000)
    expect(sources.searches).toHaveLength(2)

    const list = await leadService.list(admin, { tier: 'HOT' })
    expect(list.items.map((l) => l.name)).toEqual(expect.arrayContaining(['Cafe Mocha', 'Doon Dhaba']))
    expect(list.items.find((l) => l.name === 'Cafe Mocha')!.topProblem).toBe('Your site is hard to use on phones')
    const detail = await leadService.get(admin, mocha.id)
    expect(detail.findings.map((f) => f.key)).toEqual(expect.arrayContaining(['not_mobile', 'slow_mobile', 'menu_pdf', 'low_rating']))
  })

  it('the private audit page shows the audit (no contact details), counts views and honours removal', async () => {
    const mocha = await prisma.lead.findFirstOrThrow({ where: { organization_id: AYAVA_ORGANIZATION_ID, name: 'Cafe Mocha' } })
    const page = await publicAuditService.get(mocha.audit_token!)
    expect(page).toMatchObject({ businessName: 'Cafe Mocha', city: 'Dehradun', speed: 28 })
    expect(JSON.stringify(page)).not.toMatch(/98222|cafe-mocha\.example|Paltan/)

    await publicAuditService.recordView(mocha.audit_token!)
    await publicAuditService.recordView(mocha.audit_token!)
    const viewed = await prisma.lead.findUniqueOrThrow({ where: { id: mocha.id } })
    expect(viewed.audit_views).toBe(2)
    const signal = await prisma.notification.findFirst({ where: { user_id: admin.actor.userId, type: NOTIFICATION_TYPES.LEAD_AUDIT_VIEWED, related_entity_id: mocha.id } })
    expect(signal?.title).toBe('Cafe Mocha opened their audit again')

    expect(await publicAuditService.get('not-a-real-token-at-all-xx')).toBeNull()

    await publicAuditService.optOut(mocha.audit_token!)
    const removed = await prisma.lead.findUniqueOrThrow({ where: { id: mocha.id } })
    expect(removed).toMatchObject({ status: 'DO_NOT_CONTACT', phone: null, email: null, website: null, audit: null, summary: null, audit_token: null })
    expect(await publicAuditService.get(mocha.audit_token!)).toBeNull()
    const suppressed = await prisma.leadSuppression.findMany({ where: { organization_id: AYAVA_ORGANIZATION_ID } })
    expect(suppressed.map((s) => `${s.kind}:${s.value}`).sort()).toEqual(['DOMAIN:cafe-mocha.example', 'EMAIL:info@cafe-mocha.example', 'PHONE:9822222222', 'PLACE:GOOGLE_PLACES:place-mocha'])

    // Never imported again, from any source, even under a different listing id.
    const again = await importBusinesses(AYAVA_ORGANIZATION_ID, [{ ...businesses[1]!, externalId: 'osm-copy' }], { source: 'OPENSTREETMAP', searchId: null, industryId: null, city: 'Dehradun' }, 300)
    expect(again.added).toBe(0)
    await expect(leadService.addManual(admin, { name: 'Cafe Mocha', website: 'cafe-mocha.example' })).rejects.toBeInstanceOf(ConflictError)
  })

  it('interns see and review only the leads assigned to them', async () => {
    const dhaba = await prisma.lead.findFirstOrThrow({ where: { organization_id: AYAVA_ORGANIZATION_ID, name: 'Doon Dhaba' } })
    const bakery = await prisma.lead.findFirstOrThrow({ where: { organization_id: AYAVA_ORGANIZATION_ID, name: 'Old Bakery' } })
    expect((await leadService.list(intern, {})).total).toBe(0)

    await leadService.assign(admin, { leadIds: [dhaba.id], userId: intern.actor.userId })
    const note = await prisma.notification.findFirst({ where: { user_id: intern.actor.userId, type: NOTIFICATION_TYPES.LEAD_ASSIGNED } })
    expect(note?.title).toBe('A lead was assigned to you')

    expect((await leadService.list(intern, {})).items.map((l) => l.name)).toEqual(['Doon Dhaba'])
    const own = await leadService.get(intern, dhaba.id)
    expect(own.canUpdate).toBe(true)
    expect(own.canManage).toBe(false)
    await leadService.update(intern, { leadId: dhaba.id, status: 'READY', checklist: { instagramActive: 'no', runsAds: 'no' }, notes: 'Owner is Mr. Negi' })
    const reviewed = await prisma.lead.findUniqueOrThrow({ where: { id: dhaba.id } })
    expect(reviewed.status).toBe('READY')
    expect(reviewed.checklist).toEqual({ instagramActive: 'no', runsAds: 'no' })

    await expect(leadService.get(intern, bakery.id)).rejects.toBeInstanceOf(NotFoundError)
    await expect(leadService.update(intern, { leadId: bakery.id, status: 'READY' })).rejects.toBeInstanceOf(NotFoundError)
    await expect(leadService.settings(intern)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(leadService.assign(intern, { leadIds: [bakery.id], userId: intern.actor.userId })).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('TomTom: geocodes each city once, stays inside its cap and imports businesses', async () => {
    sources.tomtomOn = true
    sources.searches = []
    await leadService.saveSettings(admin, { enabled: true, cities: ['Dehradun'], tomtomEnabled: true, tomtomDailyCap: 3, tomtomMonthlyCap: 2000, googleEnabled: false, osmEnabled: false, placesDailyCap: 2, placesMonthlyCap: 950, newLeadsDailyCap: 300, aiSummaries: false, proof: [], auditPageDays: 90 })
    await drain()
    // 3 calls allowed today: 1 geocode (cached afterwards) + 2 searches; the same business found twice is added once.
    expect(sources.geocoded).toEqual(['Dehradun'])
    expect(sources.searches).toEqual([expect.stringMatching(/^tomtom:.+@30.32$/), expect.stringMatching(/^tomtom:.+@30.32$/)])
    const usage = await prisma.leadApiUsage.findFirst({ where: { organization_id: AYAVA_ORGANIZATION_ID, api: 'tomtom_search' } })
    expect(usage?.calls).toBe(3)
    const leads = await prisma.lead.findMany({ where: { organization_id: AYAVA_ORGANIZATION_ID, source: 'TOMTOM' } })
    expect(leads.map((l) => [l.name, l.website, l.research_status])).toEqual([['Tom Bistro', 'https://www.tom-bistro.example/', 'DONE']])
    sources.tomtomOn = false
  })

  it('a lead whose website is unknown waits for the web search, then gets it', async () => {
    sources.webSearchOn = false
    const { id } = await leadService.addManual(admin, { name: 'Hidden Bakers Studio', phone: '9855555555' })
    await drain()
    let lead = await prisma.lead.findUniqueOrThrow({ where: { id } })
    expect(lead).toMatchObject({ research_status: 'DONE', tier: 'SKIP', website: null })
    expect((lead.score_reasons as string[]).at(-1)).toMatch(/^Waiting: website not found yet/)
    expect(lead.audit).toMatchObject({ websiteLookup: { result: 'waiting', guessed: true, searched: false } })

    // With a search key the scheduler picks it up by itself.
    sources.webSearchOn = true
    await drain()
    lead = await prisma.lead.findUniqueOrThrow({ where: { id } })
    expect(lead).toMatchObject({ website: 'https://hiddenbakers.example/', email: 'hello@hiddenbakers.example', research_status: 'DONE' })
    expect(lead.audit).toMatchObject({ version: 2, websiteSource: 'search' })
    expect(lead.tier).not.toBe('SKIP')
  })

  it('leads researched with the older audit format are researched again', async () => {
    const tiffin = await prisma.lead.findFirstOrThrow({ where: { organization_id: AYAVA_ORGANIZATION_ID, name: 'Sunrise Tiffin Service' } })
    await prisma.lead.update({ where: { id: tiffin.id }, data: { audit: { version: 1, checkedAt: '2026-11-01T00:00:00.000Z', website: null, site: null, siteError: null, speed: null, sitemap: null } } })
    await drain()
    const again = await prisma.lead.findUniqueOrThrow({ where: { id: tiffin.id } })
    expect(again.audit).toMatchObject({ version: 2, websiteLookup: { result: 'not_found' } })
  })

  it('manual leads are audited like the rest', async () => {
    const { id } = await leadService.addManual(admin, { name: 'Referral Clinic', website: 'referral-clinic.example', phone: '9844444444' })
    await expect(leadService.addManual(admin, { name: 'Same site', website: 'https://www.referral-clinic.example/about' })).rejects.toBeInstanceOf(ConflictError)
    await expect(leadService.addManual(admin, { name: 'Facebook only', website: 'https://facebook.com/someclinic' })).rejects.toBeInstanceOf(ConflictError)
    await drain()
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id } })
    expect(lead.research_status).toBe('DONE')
    expect((lead.audit as { siteError: string }).siteError).toBe('The website returned an error (404).')
  })
})

describe('background job queue', () => {
  it('ignores duplicate jobs, retries failures with backoff and gives up after the last attempt', async () => {
    expect(await enqueueJob({ type: 'test.flaky', dedupeKey: 'flaky-1', maxAttempts: 2 })).toBe(true)
    expect(await enqueueJob({ type: 'test.flaky', dedupeKey: 'flaky-1' })).toBe(false)
    let calls = 0
    const handlers = {
      'test.flaky': async () => {
        calls++
        throw new Error('boom')
      },
    }
    await runJobs({ handlers, budgetMs: 5_000, jobTimeoutMs: 1_000 })
    let job = await prisma.backgroundJob.findFirstOrThrow({ where: { dedupe_key: 'flaky-1' } })
    expect(job).toMatchObject({ status: 'QUEUED', attempts: 1, last_error: 'boom' })
    expect(job.run_after.getTime()).toBeGreaterThan(Date.now())

    // Not due yet: nothing runs.
    await runJobs({ handlers, budgetMs: 5_000, jobTimeoutMs: 1_000 })
    expect(calls).toBe(1)

    await prisma.backgroundJob.update({ where: { id: job.id }, data: { run_after: new Date(Date.now() - 1000) } })
    await runJobs({ handlers, budgetMs: 5_000, jobTimeoutMs: 1_000 })
    job = await prisma.backgroundJob.findFirstOrThrow({ where: { id: job.id } })
    expect(job).toMatchObject({ status: 'FAILED', attempts: 2 })
    // A finished key can be queued again.
    expect(await enqueueJob({ type: 'test.flaky', dedupeKey: 'flaky-1' })).toBe(true)
    await prisma.backgroundJob.deleteMany({ where: { type: 'test.flaky' } })
  })
})

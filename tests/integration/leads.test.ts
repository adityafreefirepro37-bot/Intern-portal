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
  <p>Welcome to Cafe Mocha</p><a href="/files/menu.pdf">Menu</a><p>Copyright 2019 Cafe Mocha</p></body></html>`

const businesses: FoundBusiness[] = [
  { externalId: 'place-no-site', name: 'Doon Dhaba', category: 'Restaurant', address: 'Rajpur Road', phone: '+91 98111 11111', website: null, email: null, mapsUrl: 'https://maps.google.com/?cid=1', rating: 4.5, reviewCount: 60, businessStatus: 'OPERATIONAL', latitude: 30.3, longitude: 78 },
  { externalId: 'place-mocha', name: 'Cafe Mocha', category: 'Cafe', address: 'Paltan Bazaar', phone: '+91 98222 22222', website: 'http://cafe-mocha.example', email: null, mapsUrl: 'https://maps.google.com/?cid=2', rating: 3.4, reviewCount: 8, businessStatus: 'OPERATIONAL', latitude: 30.3, longitude: 78 },
  { externalId: 'place-closed', name: 'Old Bakery', category: 'Bakery', address: 'Clock Tower', phone: '+91 98333 33333', website: 'https://old-bakery.example', email: null, mapsUrl: null, rating: 4.1, reviewCount: 30, businessStatus: 'CLOSED_PERMANENTLY', latitude: null, longitude: null },
]

class FakeSources implements LeadSources {
  searches: string[] = []
  pages: string[] = []
  placesConfigured() {
    return true
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
    return { url, status: 404, contentType: 'text/html', text: 'Not found' }
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
    const saved = await leadService.saveSettings(admin, { enabled: true, cities: ['Dehradun'], googleEnabled: true, osmEnabled: false, placesDailyCap: 2, placesMonthlyCap: 950, newLeadsDailyCap: 300, aiSummaries: true, proof: [], auditPageDays: 90 })
    expect(saved.searches).toBe(4) // 3 Google terms + 1 OpenStreetMap search (OSM is off, so it never runs)

    await drain()

    // Two searches ran (the daily cap); the second returned the same businesses, which weren't added twice.
    expect(sources.searches).toHaveLength(2)
    expect(sources.searches[0]).toMatch(/ in Dehradun$/)
    const usage = await prisma.leadApiUsage.findMany({ where: { organization_id: AYAVA_ORGANIZATION_ID } })
    expect(usage.find((u) => u.api === 'places_text_search')?.calls).toBe(2)
    expect(usage.find((u) => u.api === 'pagespeed')?.calls).toBe(1)

    const leads = await prisma.lead.findMany({ where: { organization_id: AYAVA_ORGANIZATION_ID }, orderBy: { name: 'asc' } })
    expect(leads.map((l) => l.name)).toEqual(['Cafe Mocha', 'Doon Dhaba', 'Old Bakery'])
    expect(leads.every((l) => l.research_status === 'DONE')).toBe(true)
    const [mocha, dhaba, bakery] = leads as [(typeof leads)[0], (typeof leads)[0], (typeof leads)[0]]

    expect(mocha.tier).toBe('HOT')
    expect(mocha.need_score).toBe(100)
    expect(mocha.summary_source).toBe('AI')
    expect((mocha.summary as { services: string[] }).services).toEqual(['Website Design']) // invented services dropped
    expect(mocha.audit_token).toMatch(/^[A-Za-z0-9_-]{24}$/)
    expect((mocha.audit as { speed: { performance: number } }).speed.performance).toBe(28)

    expect(dhaba.tier).toBe('WARM') // no website: one big problem, strong fit
    expect(dhaba.website).toBeNull()
    expect(dhaba.audit_token).not.toBeNull()

    expect(bakery.tier).toBe('SKIP') // permanently closed
    expect(bakery.audit_token).toBeNull()

    // The AI only saw the portal's findings and was told never to invent facts.
    expect(String(ai.calls[0]!.messages[0]!.content)).toMatch(/Use ONLY the findings provided/)

    // Allowance used up: another run doesn't search again.
    await runWorker(30_000)
    expect(sources.searches).toHaveLength(2)

    const list = await leadService.list(admin, { tier: 'HOT' })
    expect(list.items.map((l) => l.name)).toEqual(['Cafe Mocha'])
    expect(list.items[0]!.topProblem).toBe('Your site is hard to use on phones')
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
    expect(suppressed.map((s) => `${s.kind}:${s.value}`).sort()).toEqual(['DOMAIN:cafe-mocha.example', 'PHONE:9822222222', 'PLACE:GOOGLE_PLACES:place-mocha'])

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

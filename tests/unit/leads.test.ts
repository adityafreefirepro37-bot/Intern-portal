import { analyzeHtml, findingsFor, hasBusinessSchema, instagramHandle, mergeSignals, ownEmails, servicesFor, websiteSettled, type LeadAudit } from '@/lib/leads/audit'
import { reviewLead } from '@/lib/leads/review'
import { AYAVA_SERVICES, INDUSTRIES, INDUSTRY_CHECKS } from '@/lib/leads/catalog'
import { scoreLead } from '@/lib/leads/score'
import { distinctiveWords, domainGuesses, isDirectory, matchSite } from '@/lib/leads/site-match'
import { isPrivateAddress, normaliseWebsite } from '@/server/leads/safe-fetch'

const GOOD_SITE = `<!doctype html><html><head>
  <title>Smile Dental Clinic | Dehradun</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Family dentist in Dehradun: implants, braces and painless root canals.">
  <meta property="og:image" content="https://smile.example/og.jpg">
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC1234567"></script>
  <script>!function(f,b,e,v,n,t,s){}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','123');</script>
  <script src="https://static.klaviyo.com/onsite/js/klaviyo.js"></script>
</head><body>
  <h1>Smile Dental</h1>
  <a href="/contact-us">Contact</a> <a href="/blog">Blog</a> <a href="https://www.practo.com/dehradun/clinic/smile">Book an appointment</a>
  <a href="https://www.instagram.com/smiledental/">Instagram</a> <a href="https://www.facebook.com/sharer/sharer.php?u=x">Share</a>
  <a href="https://wa.me/919800000000">WhatsApp</a> <a href="tel:+91 98000 00000">Call</a> <a href="mailto:Hello@SmileDental.example?subject=hi">Email</a>
  <img src="a.jpg" alt="Clinic"><p>${'Caring dentistry for the whole family. '.repeat(40)}</p>
  <footer>© 2025 Smile Dental. Contact: info@smiledental.example or noreply@sentry.io and logo@2x.png</footer>
</body></html>`

const BAD_SITE = `<html><head><title></title></head><body>
  <img src="1.jpg"><img src="2.jpg"><img src="3.jpg"><img src="4.jpg" alt="ok">
  <p>Welcome to our cafe</p><a href="/files/menu.pdf">Menu</a>
  <p>Copyright 2019 Cafe Mocha</p><script src="https://static.wixstatic.com/x.js"></script>
</body></html>`

function auditFrom(html: string | null, extra: Partial<LeadAudit> = {}, url = 'https://site.example/'): LeadAudit {
  return {
    version: 1,
    checkedAt: '2026-11-21T00:00:00.000Z',
    website: html === null ? null : url,
    site: html === null ? null : analyzeHtml(html, url),
    siteError: null,
    speed: null,
    sitemap: true,
    ...extra,
  }
}

describe('website analysis', () => {
  it('reads tracking, platform, contact details, socials and booking from a page', () => {
    const s = analyzeHtml(GOOD_SITE, 'https://smiledental.example/')
    expect(s).toMatchObject({ https: true, viewport: true, metaDescription: true, h1: true, ogImage: true, ga4: true, metaPixel: true, whatsapp: true, blog: true, copyrightYear: 2025 })
    expect(s.title).toBe('Smile Dental Clinic | Dehradun')
    expect(s.emailTools).toEqual(['Klaviyo'])
    // Own-domain address first; tracking / image noise ignored.
    expect(s.emails[0]).toBe('hello@smiledental.example')
    expect(s.emails).toContain('info@smiledental.example')
    expect(s.emails.some((e) => e.includes('sentry') || e.includes('@2x'))).toBe(false)
    expect(s.phones).toEqual(['+919800000000'])
    expect(s.socials.instagram).toBe('https://www.instagram.com/smiledental')
    expect(s.socials.facebook).toBeUndefined() // a share button isn't the business's page
    expect(s.booking).toEqual(expect.arrayContaining(['Practo', 'Booking button']))
    expect(s.contactPageUrl).toBe('https://smiledental.example/contact-us')
    expect(s.wordCount).toBeGreaterThan(150)
  })

  it('spots the problems of a neglected site', () => {
    const s = analyzeHtml(BAD_SITE, 'http://cafe.example/')
    expect(s).toMatchObject({ https: false, viewport: false, title: null, ga4: false, gtm: false, metaPixel: false, platform: 'Wix', menuPdf: true, menuPage: false, copyrightYear: 2019 })
    expect(s.imagesWithoutAlt).toBe(3)
  })

  it('merges the contact page into the homepage signals', () => {
    const home = analyzeHtml('<html><body><h1>x</h1></body></html>', 'https://a.example/')
    const contact = analyzeHtml('<form><input type="email"><textarea></textarea></form><a href="mailto:a@a.example">a</a>', 'https://a.example/contact')
    const merged = mergeSignals(home, contact)
    expect(merged.contactForm).toBe(true)
    expect(merged.emails).toEqual(['a@a.example'])
  })
})

describe('findings', () => {
  const now = new Date('2026-11-21T00:00:00Z')

  const searched = { result: 'not_found' as const, guessed: true, searched: true, checkedAt: '2026-11-21T00:00:00.000Z', tried: [] }

  it('"No website found" only after a web search found nothing', () => {
    const f = findingsFor(auditFrom(null, { websiteLookup: searched }), { checks: ['booking'], rating: 4.6, reviewCount: 120, now })
    expect(f.map((x) => x.key)).toEqual(['no_website'])
    expect(f[0]!.title).toBe('No website found')
    expect(f[0]!.service).toBe('website')
    // A listing without a website (or only guesses tried) proves nothing: no claim, and not scored yet.
    const unknown = auditFrom(null, { websiteLookup: { ...searched, result: 'waiting', searched: false } })
    expect(findingsFor(unknown, { checks: [], rating: null, reviewCount: null, now })).toEqual([])
    expect(findingsFor(auditFrom(null), { checks: [], rating: null, reviewCount: null, now })).toEqual([])
    expect(websiteSettled(unknown)).toBe(false)
    expect(websiteSettled(auditFrom(null, { websiteLookup: searched }))).toBe(true)
    expect(websiteSettled(auditFrom(BAD_SITE))).toBe(true)
  })

  it('maps each problem to an Ayava service, serious first, with industry checks', () => {
    const f = findingsFor(auditFrom(BAD_SITE, { speed: { performance: 31, lcpMs: 7400, cls: 0.3 }, sitemap: false }, 'http://cafe.example/'), { checks: ['ordering', 'menu'], rating: 3.4, reviewCount: 8, now })
    const keys = f.map((x) => x.key)
    expect(keys).toEqual(expect.arrayContaining(['not_mobile', 'slow_mobile', 'no_https', 'stale_site', 'builder_site', 'no_enquiry', 'no_ordering', 'menu_pdf', 'no_analytics', 'no_pixel', 'weak_seo_tags', 'no_sitemap', 'thin_content', 'images_no_alt', 'no_socials', 'low_rating', 'few_reviews']))
    expect(f.find((x) => x.key === 'slow_mobile')!.title).toBe('Slow on mobile: 31/100')
    expect(f.find((x) => x.key === 'low_rating')!.severity).toBe('high')
    // Sorted: every high before any medium before any low.
    const order = f.map((x) => ({ high: 0, medium: 1, low: 2 })[x.severity])
    expect([...order].sort()).toEqual(order)
    for (const finding of f) expect(AYAVA_SERVICES[finding.service]).toBeTruthy()
  })

  it('a well-run site has only minor findings', () => {
    const f = findingsFor(auditFrom(GOOD_SITE, { speed: { performance: 92, lcpMs: 1800, cls: 0 } }), { checks: ['booking'], rating: 4.7, reviewCount: 210, now })
    expect(f.filter((x) => x.severity === 'high')).toEqual([])
    expect(f.map((x) => x.key)).not.toContain('no_booking')
  })

  it('servicesFor ranks services by total severity', () => {
    const f = findingsFor(auditFrom(BAD_SITE), { checks: [], rating: null, reviewCount: null, now })
    expect(servicesFor(f)[0]!.service).toBe('website')
  })
})

describe('lead score', () => {
  const findings = findingsFor(auditFrom(BAD_SITE), { checks: ['menu'], rating: null, reviewCount: null })

  it('many problems + good fit = hot', () => {
    const s = scoreLead({ findings, industryPriority: 1, rating: 4.3, reviewCount: 80, hasEmail: true, hasPhone: true, businessStatus: 'OPERATIONAL' })
    expect(s.tier).toBe('HOT')
    expect(s.need).toBe(100)
    expect(s.fit).toBe(100)
    expect(s.reasons[0]).toMatch(/^Need 100/)
  })

  it('skips closed businesses, unreachable ones and ones with little to fix', () => {
    const base = { findings, industryPriority: 1, rating: 4.3, reviewCount: 80, hasEmail: true, hasPhone: true, businessStatus: 'OPERATIONAL' }
    expect(scoreLead({ ...base, businessStatus: 'CLOSED_PERMANENTLY' }).tier).toBe('SKIP')
    expect(scoreLead({ ...base, hasEmail: false, hasPhone: false }).tier).toBe('SKIP')
    expect(scoreLead({ ...base, findings: [] }).tier).toBe('SKIP')
    // Outreach is by email: a phone alone isn't enough (unless that rule is switched off).
    const phoneOnly = scoreLead({ ...base, hasEmail: false })
    expect(phoneOnly.tier).toBe('SKIP')
    expect(phoneOnly.reasons.at(-1)).toBe('Skipped: no published email address to contact them')
    expect(scoreLead({ ...base, hasEmail: false, requireEmail: false }).tier).toBe('HOT')
    // Website still unknown: waits rather than being judged.
    expect(scoreLead({ ...base, websiteSettled: false }).reasons.at(-1)).toMatch(/^Waiting: website not found yet/)
  })

  it('a lower-priority, smaller business is warm or skipped', () => {
    const s = scoreLead({ findings, industryPriority: 3, rating: null, reviewCount: null, hasEmail: true, hasPhone: false, businessStatus: null })
    expect(s.fit).toBe(35)
    expect(s.tier).toBe('SKIP')
    // 20 (priority 3) + 10 (rating 3.6) + 6 (5 reviews) + 15 (email) = 51: warm, not hot.
    const warm = scoreLead({ findings, industryPriority: 3, rating: 3.6, reviewCount: 5, hasEmail: true, hasPhone: false, businessStatus: null })
    expect(warm.fit).toBe(51)
    expect(warm.tier).toBe('WARM')
  })
})

const page = (body: string, title = '') =>
  `<html><head><title>${title}</title></head><body>${body} ${'Fresh food made every day with care for our guests. '.repeat(6)}</body></html>`

describe('full-service checks (audit version 3)', () => {
  const now = new Date('2026-11-21T00:00:00Z')
  const RICH = `<html><head><title>Hotel Doon View</title><link rel="icon" href="/f.png">
    <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite"},{"@type":"Hotel","name":"Doon View"}]}</script>
    <script src="https://embed.tawk.to/abc/default"></script><script>gtag('config','AW-123456789')</script></head>
    <body><img src="/img/logo.png" alt="Doon View"><iframe src="https://www.youtube.com/embed/xyz"></iframe>
    <h2>What our guests say</h2><form><input type="email"><button>Subscribe to offers</button></form>
    <a href="https://play.google.com/store/apps/details?id=com.doonview">App</a><a href="tel:+919800000000">Call</a></body></html>`

  it('reads ads, schema, chat, video, trust and app signals', () => {
    const site = analyzeHtml(RICH, 'https://doonview.example/')
    expect(site).toMatchObject({ googleAds: true, faviconLink: true, logo: true, video: true, chatWidget: ['Tawk.to'], testimonials: true, newsletter: true, appLinks: ['Google Play'], noindex: false })
    expect(site.structuredData).toEqual(['WebSite', 'Hotel'])
    expect(hasBusinessSchema(site.structuredData)).toBe(true)
    expect(hasBusinessSchema(['WebSite', 'BreadcrumbList'])).toBe(false)
    expect(analyzeHtml('<meta name="robots" content="noindex, nofollow">', 'https://x.example/').noindex).toBe(true)
    expect(instagramHandle('https://www.instagram.com/doonview.hotel/')).toBe('doonview.hotel')
    expect(instagramHandle('https://instagram.com/p/Cx12/')).toBeNull()
  })

  it('turns social, search, freshness and branding signals into findings for each service', () => {
    const audit = auditFrom(BAD_SITE, {
      version: 3,
      speed: { performance: 60, lcpMs: null, cls: null, seo: 72, accessibility: 55, bestPractices: 80 },
      sitemapLatest: '2024-06-01T00:00:00.000Z',
      favicon: false,
      search: { query: 'cafe dehradun', position: null, competitors: ['rival.example'], checkedAt: '2026-11-20T00:00:00.000Z' },
      instagram: { handle: 'cafe', followers: 4200, posts: 80, lastPostAt: '2026-06-15T00:00:00.000Z', engagementPct: 0.4 },
      youtube: { url: 'https://youtube.com/@cafe', subscribers: 90, videos: 4, lastUploadAt: '2025-01-10T00:00:00.000Z' },
    })
    const f = findingsFor(audit, { checks: [], rating: null, reviewCount: null, now })
    const byKey = Object.fromEntries(f.map((x) => [x.key, x]))
    expect(byKey.not_ranking).toMatchObject({ service: 'seo', severity: 'high', title: 'Not in the top 10 search results for “cafe dehradun”' })
    expect(byKey.not_ranking!.detail).toMatch(/Sites that do appear: rival\.example\.$/)
    expect(byKey.no_google_ads!.service).toBe('google_ads')
    expect(byKey.lighthouse_seo!.title).toBe('Google’s SEO check scores 72/100')
    expect(byKey.ig_inactive).toMatchObject({ service: 'smm', title: 'Instagram quiet since Jun 2026' })
    expect(byKey.ig_engagement!.title).toBe('Low Instagram engagement (0.4%)')
    expect(byKey.yt_inactive!.service).toBe('video')
    expect(byKey.no_updates).toMatchObject({ service: 'content', title: 'No page updated since Jun 2024' })
    expect(byKey.no_favicon!.service).toBe('branding')
    expect(byKey.no_chat!.service).toBe('ai')
    expect(byKey.no_click_to_call!.service).toBe('analytics_cro')
    expect(byKey.no_testimonials!.service).toBe('reputation')
    expect(byKey.accessibility!.service).toBe('website')
    // Older audits don't have these signals: no findings invented from missing data.
    const old = findingsFor(auditFrom(BAD_SITE), { checks: [], rating: null, reviewCount: null, now })
    expect(old.map((x) => x.key)).not.toContain('no_chat')
  })
})

describe('review: automatic emails or the team', () => {
  const audit = auditFrom(BAD_SITE, { version: 3 })
  it('sends big Hot businesses to the team and the rest to the automatic emails', () => {
    expect(reviewLead({ tier: 'HOT', hasEmail: true, industryKey: 'fnb_qsr', reviewCount: 40, audit })).toEqual({ route: 'AUTO', reasons: ['Automatic email: Hot lead'] })
    const big = reviewLead({ tier: 'HOT', hasEmail: true, industryKey: 'hospitality_travel', reviewCount: 320, audit })
    expect(big.route).toBe('TEAM')
    expect(big.reasons[0]).toBe('Team: a Hot lead that looks like a big business (320 Google reviews, high-value industry)')
    // Warm leads are never "serious", however big.
    expect(reviewLead({ tier: 'WARM', hasEmail: true, industryKey: 'hospitality_travel', reviewCount: 320, audit }).route).toBe('AUTO')
    expect(reviewLead({ tier: 'WARM', hasEmail: false, industryKey: null, reviewCount: null, audit }).route).toBe('TEAM')
    expect(reviewLead({ tier: 'SKIP', hasEmail: true, industryKey: null, reviewCount: null, audit }).route).toBeNull()
  })
})

describe('finding a website', () => {
  const lead = { name: 'Shree Baba Properties Pvt Ltd', city: 'Dehradun', phone: '+91 98970 12345' }

  it('guesses likely addresses from the distinctive part of the name', () => {
    expect(distinctiveWords(lead.name, lead.city)).toEqual(['baba'])
    expect(domainGuesses(lead.name, lead.city).slice(0, 3)).toEqual([
      'https://shreebabaproperties.com/',
      'https://shreebabaproperties.in/',
      'https://shreebabaproperties.co.in/',
    ])
    expect(domainGuesses('Property Dealer', 'Dehradun')).toEqual([]) // nothing to identify it by
  })

  it('takes a page only when it proves to be the business', () => {
    const url = 'https://shreebabaproperties.com/'
    expect(matchSite({ url, html: page('Shree Baba Properties, Rajpur Road. Call 98970-12345', 'Shree Baba Properties') }, lead)).toEqual({ ok: true, reason: 'name and phone number match' })
    expect(matchSite({ url, html: page('Shree Baba Properties, Rajpur Road, Dehradun') }, lead).ok).toBe(true)
    // The same name in another city, with another phone number: not theirs.
    expect(matchSite({ url, html: page('Shree Baba Properties, Sector 12, Noida. Call 99999 88888') }, lead)).toMatchObject({ ok: false, reason: 'name matches but not the phone number or city' })
    expect(matchSite({ url: 'https://other.example/', html: page('Krishna Estates, Dehradun') }, lead)).toMatchObject({ ok: false, reason: 'page is about a different business' })
    expect(matchSite({ url, html: page('shreebabaproperties.com is for sale! Buy this domain today. Dehradun') }, lead)).toMatchObject({ ok: false, reason: 'parked or placeholder page' })
  })

  it('never takes a directory or social page as the website', () => {
    expect(isDirectory('https://www.justdial.com/Dehradun/Shree-Baba')).toBe(true)
    expect(isDirectory('https://www.magicbricks.com/x')).toBe(true)
    expect(isDirectory('https://shreebabaproperties.com/')).toBe(false)
  })

  it('keeps only email addresses the business publishes for itself', () => {
    expect(ownEmails(['info@smile.example', 'smileclinic@gmail.com', 'hello@webdesigner.example', 'noreply@smile.example'], 'https://www.smile.example/contact')).toEqual(['info@smile.example', 'smileclinic@gmail.com'])
  })
})

describe('catalogue', () => {
  it('has 30 industries with unique keys, search terms and known checks', () => {
    expect(INDUSTRIES).toHaveLength(30)
    expect(new Set(INDUSTRIES.map((i) => i.key)).size).toBe(30)
    for (const i of INDUSTRIES) {
      expect(i.terms.length).toBeGreaterThan(0)
      for (const c of i.checks) expect(INDUSTRY_CHECKS).toContain(c)
      for (const t of i.osmTags) expect(t).toMatch(/^[a-z_:]+=[a-z_]+$/)
    }
  })
})

describe('website address guards', () => {
  it('normalises listing websites and ignores social profiles', () => {
    expect(normaliseWebsite('smiledental.in')).toBe('https://smiledental.in/')
    expect(normaliseWebsite('http://www.Cafe.example/menu#top')).toBe('http://www.cafe.example/menu')
    expect(normaliseWebsite('https://www.facebook.com/cafe')).toBeNull()
    expect(normaliseWebsite('https://instagram.com/cafe')).toBeNull()
    expect(normaliseWebsite('not a url')).toBeNull()
    expect(normaliseWebsite('')).toBeNull()
  })

  it('treats private, loopback and link-local addresses as private', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
      expect(isPrivateAddress(ip)).toBe(true)
    }
    for (const ip of ['8.8.8.8', '103.21.244.1', '2606:4700::1111']) expect(isPrivateAddress(ip)).toBe(false)
  })
})

describe('TomTom source', () => {
  const realFetch = global.fetch
  afterEach(() => {
    global.fetch = realFetch
  })

  function loadSources() {
    process.env.TOMTOM_API_KEY = 'test-tomtom-key'
    let mod: typeof import('@/server/leads/sources') | undefined
    jest.isolateModules(() => {
      mod = jest.requireActual<typeof import('@/server/leads/sources')>('@/server/leads/sources')
    })
    delete process.env.TOMTOM_API_KEY
    return mod!.leadSources()
  }

  it('maps POI results and pages by offset until the results run out', async () => {
    const calls: string[] = []
    const results = Array.from({ length: 100 }, (_, i) => ({
      id: `poi-${i}`,
      type: 'POI',
      poi: { name: `Cafe ${i}`, phone: '+(91)-135-2700000', url: 'www.cafe.example', categories: ['café/pub'] },
      address: { freeformAddress: 'Rajpur Road, Dehradun' },
      position: { lat: 30.3, lon: 78.0 },
    }))
    global.fetch = jest.fn(async (url: string | URL | Request) => {
      calls.push(String(url))
      return new Response(JSON.stringify({ summary: { numResults: 100, offset: 0, totalResults: 250 }, results }), { status: 200 })
    }) as typeof fetch
    const sources = loadSources()
    expect(sources.tomtomConfigured()).toBe(true)
    const page = await sources.tomtomSearch('cafe', { lat: 30.32, lon: 78.03 }, null)
    expect(page.nextPageToken).toBe('100')
    expect(page.businesses).toHaveLength(100)
    expect(page.businesses[0]).toMatchObject({ externalId: 'poi-0', name: 'Cafe 0', phone: '+(91)-135-2700000', website: 'www.cafe.example', category: 'café/pub', address: 'Rajpur Road, Dehradun' })
    expect(page.businesses[0]!.mapsUrl).toBe('https://www.google.com/maps/search/?api=1&query=Cafe%200%20Rajpur%20Road%2C%20Dehradun')
    expect(calls[0]).toMatch(/^https:\/\/api\.tomtom\.com\/search\/2\/poiSearch\/cafe\.json\?/)
    expect(calls[0]).toMatch(/countrySet=IN/)
    expect(calls[0]).toMatch(/radius=15000/)
    // Last page: fewer than 100 results → no next page.
    global.fetch = jest.fn(async () => new Response(JSON.stringify({ summary: { totalResults: 250 }, results: results.slice(0, 50) }), { status: 200 })) as typeof fetch
    expect((await sources.tomtomSearch('cafe', { lat: 30.32, lon: 78.03 }, '200')).nextPageToken).toBeNull()
  })

  it('reports TomTom errors with their message', async () => {
    global.fetch = jest.fn(async () => new Response(JSON.stringify({ detailedError: { message: 'Invalid API key' } }), { status: 403 })) as typeof fetch
    await expect(loadSources().tomtomGeocode('Dehradun')).rejects.toThrow('TomTom search failed (403): Invalid API key')
  })
})

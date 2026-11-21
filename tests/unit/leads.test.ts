import { analyzeHtml, findingsFor, mergeSignals, servicesFor, type LeadAudit } from '@/lib/leads/audit'
import { AYAVA_SERVICES, INDUSTRIES, INDUSTRY_CHECKS } from '@/lib/leads/catalog'
import { scoreLead } from '@/lib/leads/score'
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

  it('a missing website is the one big finding', () => {
    const f = findingsFor(auditFrom(null), { checks: ['booking'], rating: 4.6, reviewCount: 120, now })
    expect(f.map((x) => x.key)).toEqual(['no_website'])
    expect(f[0]!.service).toBe('website')
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
  })

  it('a lower-priority, smaller business is warm or skipped', () => {
    const s = scoreLead({ findings, industryPriority: 3, rating: null, reviewCount: null, hasEmail: false, hasPhone: true, businessStatus: null })
    expect(s.fit).toBe(30)
    expect(s.tier).toBe('SKIP')
    // 20 (priority 3) + 10 (rating 3.6) + 6 (5 reviews) + 10 (phone) = 46: warm, not hot.
    const warm = scoreLead({ findings, industryPriority: 3, rating: 3.6, reviewCount: 5, hasEmail: false, hasPhone: true, businessStatus: null })
    expect(warm.fit).toBe(46)
    expect(warm.tier).toBe('WARM')
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

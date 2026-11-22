import { AYAVA_SERVICES, type AyavaService, type IndustryCheck } from './catalog'

/**
 * Audit for a lead: signals read from the homepage (and its contact page), the
 * sitemap, Google's PageSpeed / Lighthouse scores, a web search for the
 * industry in the city, and the public Instagram / YouTube profiles the site
 * links to — turned into findings that each map to an Ayava service. Pure
 * functions with no I/O — the fetching lives in src/server/leads/pipeline.ts.
 * The stored audit is compact JSON: never the page's HTML.
 */

export interface SiteSignals {
  finalUrl: string
  https: boolean
  viewport: boolean
  title: string | null
  metaDescription: boolean
  h1: boolean
  ogImage: boolean
  wordCount: number
  images: number
  imagesWithoutAlt: number
  ga4: boolean
  gtm: boolean
  metaPixel: boolean
  emailTools: string[]
  platform: string | null
  contactForm: boolean
  whatsapp: boolean
  emails: string[]
  phones: string[]
  socials: Partial<Record<'instagram' | 'facebook' | 'linkedin' | 'youtube' | 'x', string>>
  booking: string[]
  ordering: string[]
  ota: string[]
  store: boolean
  portfolio: boolean
  blog: boolean
  menuPdf: boolean
  menuPage: boolean
  copyrightYear: number | null
  contactPageUrl: string | null
  // Audit version 3 (older audits don't have these):
  googleAds?: boolean
  /** schema.org types in the page's JSON-LD. */
  structuredData?: string[]
  noindex?: boolean
  canonical?: boolean
  faviconLink?: boolean
  logo?: boolean
  video?: boolean
  chatWidget?: string[]
  testimonials?: boolean
  newsletter?: boolean
  appLinks?: string[]
}

export interface SpeedResult {
  performance: number
  lcpMs: number | null
  cls: number | null
  /** Lighthouse category scores (0–100), from the same PageSpeed run. */
  seo?: number | null
  accessibility?: number | null
  bestPractices?: number | null
}

/** Where the business appears in a web search for its trade in its city (Brave Search). */
export interface SearchVisibility {
  query: string
  /** 1–10, or null when it isn't in the top 10. */
  position: number | null
  /** Other businesses' own sites in the top 10 (directories left out). */
  competitors: string[]
  checkedAt: string
}

/** Public Instagram business profile (Instagram Graph API, business discovery). */
export interface InstagramProfile {
  handle: string
  followers: number
  posts: number
  lastPostAt: string | null
  /** Average likes + comments on the last posts, as % of followers. */
  engagementPct: number | null
}

export interface YouTubeChannel {
  url: string
  subscribers: number | null
  videos: number
  lastUploadAt: string | null
}

/** Current audit format. Leads researched with an older one are researched again. */
export const AUDIT_VERSION = 3

/**
 * The search for a website when the listing had none: likely addresses first,
 * then a web search. `not_found` is only set after a web search ran, so "No
 * website found" is never claimed from guesses alone; `waiting` means the web
 * search hasn't run yet (no key, or today's allowance is used).
 */
export interface WebsiteLookup {
  result: 'found' | 'not_found' | 'waiting'
  guessed: boolean
  searched: boolean
  checkedAt: string
  /** Candidate pages opened and why each was or wasn't the business's site. */
  tried: { url: string; reason: string }[]
}

export interface LeadAudit {
  version: 1 | 2 | 3
  checkedAt: string
  website: string | null
  /** Where the website came from: the listing, a likely address that proved to be theirs, or a web search. */
  websiteSource?: 'listing' | 'guess' | 'search' | null
  websiteLookup?: WebsiteLookup | null
  site: SiteSignals | null
  siteError: string | null
  speed: SpeedResult | null
  sitemap: boolean | null
  // Audit version 3:
  /** Pages listed in the sitemap, and the newest "last modified" date in it. */
  sitemapPages?: number | null
  sitemapLatest?: string | null
  /** A tab icon: declared in the page or served at /favicon.ico. */
  favicon?: boolean | null
  search?: SearchVisibility | null
  instagram?: InstagramProfile | null
  youtube?: YouTubeChannel | null
}

export type Severity = 'high' | 'medium' | 'low'

export interface Finding {
  key: string
  severity: Severity
  service: AyavaService
  title: string
  detail: string
}

const PLATFORMS: [string, RegExp][] = [
  ['Shopify', /cdn\.shopify\.com|Shopify\.theme/i],
  ['Wix', /static\.wixstatic\.com|wix\.com\/|_wixCssImports|wix-bolt/i],
  ['Squarespace', /static1\.squarespace\.com|squarespace\.com/i],
  ['Webflow', /webflow\.(com|io)|data-wf-page/i],
  ['WooCommerce', /woocommerce/i],
  ['WordPress', /wp-content\/|wp-includes\/|<meta[^>]+generator[^>]+WordPress/i],
  ['GoDaddy Website Builder', /img1\.wsimg\.com|godaddy\.com\/websites/i],
  ['Blogger', /blogger\.com|blogspot\.com/i],
  ['Google Sites', /sites\.google\.com/i],
]

const EMAIL_TOOLS: [string, RegExp][] = [
  ['Klaviyo', /klaviyo\.com/i],
  ['HubSpot', /js\.hs-scripts\.com|hubspot\.com|hs-forms/i],
  ['Mailchimp', /list-manage\.com|mailchimp\.com|mc\.us\d+/i],
  ['Zoho', /zohopublic|campaigns\.zoho/i],
  ['Brevo', /sibforms\.com|sendinblue|brevo\.com/i],
]

const BOOKING: [string, RegExp][] = [
  ['Practo', /practo\.com/i],
  ['Calendly', /calendly\.com/i],
  ['Fresha', /fresha\.com/i],
  ['Booksy', /booksy\.com/i],
  ['Setmore', /setmore\.com/i],
  ['SimplyBook', /simplybook\.(me|it)/i],
  ['Zenoti', /zenoti\.com/i],
  ['Lybrate', /lybrate\.com/i],
  ['Hotel booking engine', /ezeereservation|ezee(absolute|centrix)|staah\.net|cloudbeds\.com|simplotel|bookingjini|djubo|asiatech|axisrooms|resavenue/i],
  ['Booking button', /book(ing)?[\s-]*(an?\s+)?(appointment|consultation|now|online|a table|your stay)|schedule\s+(a|an|your)\s+(visit|appointment|consultation)|check\s+availability/i],
]

const ORDERING: [string, RegExp][] = [
  ['Zomato', /zomato\.com/i],
  ['Swiggy', /swiggy\.com/i],
  ['Online ordering', /dotpe\.in|petpooja|thrivenow|order\s+online|order\s+now/i],
]

const OTA: [string, RegExp][] = [
  ['Booking.com', /booking\.com/i],
  ['MakeMyTrip', /makemytrip\.com/i],
  ['Goibibo', /goibibo\.com/i],
  ['Agoda', /agoda\.com/i],
  ['Airbnb', /airbnb\.(com|co\.in)/i],
  ['Tripadvisor', /tripadvisor\.(com|in)/i],
  ['Expedia', /expedia\.(com|co\.in)/i],
]

const CHAT_WIDGETS: [string, RegExp][] = [
  ['Tawk.to', /embed\.tawk\.to/i],
  ['Crisp', /client\.crisp\.chat/i],
  ['Intercom', /widget\.intercom\.io|js\.intercomcdn\.com/i],
  ['Tidio', /code\.tidio\.co/i],
  ['Zoho SalesIQ', /salesiq\.zoho/i],
  ['Freshchat', /wchat\.freshchat\.com|freshworks\.com\/live-chat/i],
  ['LiveChat', /cdn\.livechatinc\.com/i],
  ['Drift', /js\.driftt\.com/i],
  ['HubSpot chat', /js\.usemessages\.com/i],
  ['WATI', /wati\.io/i],
  ['Interakt', /interakt\.(ai|shop)/i],
  ['Gallabox', /gallabox\.com/i],
  ['Chatbot', /chatbase\.co|botpress\.cloud|landbot\.io|kommunicate\.io|haptik\.ai|voiceflow\.com/i],
]

/** schema.org types that describe the business itself (not just the page). */
const BUSINESS_TYPE = /(Organization|Business|Store|Restaurant|Cafe|Hotel|Resort|Dentist|Clinic|Physician|Hospital|Pharmacy|Agent|School|College|University|Salon|Spa|Gym|Establishment|Service|Dealer|Contractor|Attorney|Bakery|Lodging|Place|Center)$/

function jsonLdTypes(html: string): string[] {
  const types = new Set<string>()
  const visit = (node: unknown, depth: number) => {
    if (!node || typeof node !== 'object' || depth > 6) return
    if (Array.isArray(node)) return node.forEach((n) => visit(n, depth + 1))
    const record = node as Record<string, unknown>
    const t = record['@type']
    for (const value of Array.isArray(t) ? t : [t]) if (typeof value === 'string') types.add(value)
    for (const key of ['@graph', 'mainEntity', 'publisher', 'author', 'organizer', 'provider']) visit(record[key], depth + 1)
  }
  for (const match of html.matchAll(/<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      visit(JSON.parse(match[1]!.trim()), 0)
    } catch {
      // Broken JSON-LD counts as none.
    }
  }
  return [...types].slice(0, 12)
}

export function hasBusinessSchema(types: string[] | undefined): boolean {
  return Boolean(types?.some((t) => BUSINESS_TYPE.test(t)))
}

const SOCIAL_PATTERNS = {
  instagram: /https?:\/\/(www\.)?instagram\.com\/[A-Za-z0-9_.]+/i,
  facebook: /https?:\/\/(www\.|m\.)?facebook\.com\/[A-Za-z0-9_.\-/]+/i,
  linkedin: /https?:\/\/(www\.|in\.)?linkedin\.com\/(company|in)\/[A-Za-z0-9_\-%]+/i,
  youtube: /https?:\/\/(www\.)?youtube\.com\/(@|c\/|channel\/|user\/)[A-Za-z0-9_\-]+/i,
  x: /https?:\/\/(www\.)?(twitter|x)\.com\/[A-Za-z0-9_]+/i,
} as const

const IGNORED_EMAIL = /\.(png|jpe?g|gif|webp|svg)$|example\.(com|org)|sentry|wixpress|domain\.com|email\.com|yourname|@2x/i

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

/** Visible text: scripts, styles and tags removed. */
export function visibleText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim()
}

function hrefs(html: string): string[] {
  const out: string[] = []
  for (const match of html.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"']+)["']/gi)) out.push(decodeEntities(match[1]!.trim()))
  return out
}

function firstMatch(list: [string, RegExp][], haystack: string): string[] {
  return list.filter(([, re]) => re.test(haystack)).map(([name]) => name)
}

function absolute(href: string, base: string): string | null {
  try {
    const url = new URL(href, base)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

/** Signals from one HTML page. `pageUrl` is the address after redirects. */
export function analyzeHtml(html: string, pageUrl: string): SiteSignals {
  const links = hrefs(html)
  const text = visibleText(html)
  const linkText = links.join(' ')
  const host = (() => {
    try {
      return new URL(pageUrl).hostname.replace(/^www\./, '')
    } catch {
      return ''
    }
  })()

  const emails = new Set<string>()
  for (const href of links) {
    if (href.toLowerCase().startsWith('mailto:')) {
      const address = decodeURIComponent(href.slice(7).split('?')[0] ?? '').trim().toLowerCase()
      if (address.includes('@')) emails.add(address)
    }
  }
  for (const match of text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}/g)) emails.add(match[0].toLowerCase())
  const cleanEmails = [...emails].filter((e) => !IGNORED_EMAIL.test(e) && e.length <= 80)
  // Prefer addresses on the business's own domain.
  cleanEmails.sort((a, b) => Number(b.endsWith('@' + host)) - Number(a.endsWith('@' + host)))

  const phones = new Set<string>()
  for (const href of links) {
    if (href.toLowerCase().startsWith('tel:')) {
      const digits = href.slice(4).replace(/[^\d+]/g, '')
      if (digits.replace(/\D/g, '').length >= 10) phones.add(digits)
    }
  }

  const socials: SiteSignals['socials'] = {}
  for (const [name, re] of Object.entries(SOCIAL_PATTERNS) as [keyof typeof SOCIAL_PATTERNS, RegExp][]) {
    const found = links.find((href) => re.test(href) && !/sharer|share\?|intent\/tweet|\/plugins\//i.test(href))
    if (found) socials[name] = found.match(re)![0]
  }

  const contactHref = links.find((href) => /contact|reach-us|get-in-touch|enquir/i.test(href) && !href.startsWith('mailto:') && !href.startsWith('tel:'))
  const contactPageUrl = contactHref ? absolute(contactHref, pageUrl) : null

  const years = [...text.matchAll(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(20\d{2})/gi)].map((m) => Number(m[1]))
  const images = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0])
  const forms = [...html.matchAll(/<form\b[\s\S]*?<\/form>/gi)].map((m) => m[0])

  return {
    finalUrl: pageUrl,
    https: pageUrl.startsWith('https://'),
    viewport: /<meta[^>]+name\s*=\s*["']viewport["'][^>]*width\s*=\s*device-width/i.test(html) || /<meta[^>]+content\s*=\s*["'][^"']*width=device-width[^>]*name\s*=\s*["']viewport/i.test(html),
    title: decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim() ?? '') || null,
    metaDescription: /<meta[^>]+name\s*=\s*["']description["'][^>]+content\s*=\s*["'][^"']{20,}/i.test(html) || /<meta[^>]+content\s*=\s*["'][^"']{20,}["'][^>]+name\s*=\s*["']description/i.test(html),
    h1: /<h1\b/i.test(html),
    ogImage: /<meta[^>]+property\s*=\s*["']og:image["']/i.test(html),
    wordCount: text ? text.split(' ').length : 0,
    images: images.length,
    imagesWithoutAlt: images.filter((img) => !/\balt\s*=\s*["'][^"']+["']/i.test(img)).length,
    ga4: /gtag\/js\?id=G-|["']G-[A-Z0-9]{6,}["']|google-analytics\.com\/(g\/)?collect/i.test(html),
    gtm: /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]{4,}/i.test(html),
    metaPixel: /connect\.facebook\.net\/[a-z_A-Z]+\/fbevents\.js|fbq\(\s*['"]init['"]/i.test(html),
    emailTools: firstMatch(EMAIL_TOOLS, html),
    platform: PLATFORMS.find(([, re]) => re.test(html))?.[0] ?? null,
    contactForm: forms.some((form) => /type\s*=\s*["'](email|tel)["']|<textarea/i.test(form)),
    whatsapp: /wa\.me\/|api\.whatsapp\.com\/send|whatsapp:\/\/send|web\.whatsapp\.com\/send/i.test(linkText) || /wa\.me\//i.test(html),
    emails: cleanEmails.slice(0, 5),
    phones: [...phones].slice(0, 3),
    socials,
    booking: firstMatch(BOOKING, `${linkText} ${text} ${html.match(/<iframe[^>]+src\s*=\s*["'][^"']+/gi)?.join(' ') ?? ''}`),
    ordering: firstMatch(ORDERING, `${linkText} ${text}`),
    ota: firstMatch(OTA, linkText),
    store: /add[\s-]*to[\s-]*cart|\/cart\b|\/checkout\b|woocommerce|cdn\.shopify\.com|shop now/i.test(`${linkText} ${text} ${html}`),
    portfolio: /portfolio|our[\s-]+work|projects|gallery|case[\s-]+stud/i.test(linkText) || /portfolio|our work|gallery|case stud/i.test(text.slice(0, 4000)),
    blog: /\/blog|\/news|\/articles|\/insights/i.test(linkText),
    menuPdf: links.some((href) => /menu[^"']*\.pdf|\.pdf[^"']*menu/i.test(href)),
    menuPage: links.some((href) => /\/menu\b|#menu|our-menu/i.test(href) && !/\.pdf/i.test(href)),
    copyrightYear: years.length ? Math.max(...years) : null,
    contactPageUrl,
    googleAds: /AW-\d{6,}|googleadservices\.com\/pagead\/conversion|googleads\.g\.doubleclick\.net/i.test(html),
    structuredData: jsonLdTypes(html),
    noindex: /<meta[^>]+name\s*=\s*["']robots["'][^>]+content\s*=\s*["'][^"']*noindex/i.test(html) || /<meta[^>]+content\s*=\s*["'][^"']*noindex[^"']*["'][^>]+name\s*=\s*["']robots/i.test(html),
    canonical: /<link[^>]+rel\s*=\s*["']canonical["']/i.test(html),
    faviconLink: /<link[^>]+rel\s*=\s*["'][^"']*\b(icon|apple-touch-icon)\b/i.test(html),
    logo: /<(img|svg|a|div|span)\b[^>]*\blogo/i.test(html) || /"logo"\s*:/i.test(html),
    video: /<video\b|youtube(-nocookie)?\.com\/embed\/|player\.vimeo\.com|fast\.wistia|<iframe[^>]+facebook\.com\/plugins\/video/i.test(html),
    chatWidget: firstMatch(CHAT_WIDGETS, html),
    testimonials: /testimonial|what (our )?(clients|customers|patients|guests|students|parents) say|client reviews|customer reviews|google reviews|happy (clients|customers|patients)/i.test(text) || /elfsight|trustindex|embedsocial|grwapi|reviewsonmywebsite/i.test(html),
    newsletter: forms.some((form) => /type\s*=\s*["']email["']/i.test(form) && /subscribe|newsletter|updates|offers/i.test(form)),
    appLinks: [
      ...(/play\.google\.com\/store\/apps\/details/i.test(linkText) ? ['Google Play'] : []),
      ...(/apps\.apple\.com\/[a-z-]*\/?app\//i.test(linkText) ? ['App Store'] : []),
    ],
  }
}

/** The Instagram username in a profile link, or null for posts, reels and other pages. */
export function instagramHandle(url: string | undefined): string | null {
  const handle = url?.match(/instagram\.com\/([A-Za-z0-9_.]{1,30})\/?/i)?.[1]
  return handle && !['p', 'reel', 'reels', 'explore', 'accounts', 'stories', 'tv'].includes(handle.toLowerCase()) ? handle : null
}

/** Combines the homepage with the contact page (contact details, forms and booking often live there). */
export function mergeSignals(home: SiteSignals, extra: SiteSignals | null): SiteSignals {
  if (!extra) return home
  const unique = <T>(a: T[], b: T[]) => [...new Set([...a, ...b])]
  return {
    ...home,
    contactForm: home.contactForm || extra.contactForm,
    whatsapp: home.whatsapp || extra.whatsapp,
    emails: unique(home.emails, extra.emails).slice(0, 5),
    phones: unique(home.phones, extra.phones).slice(0, 3),
    socials: { ...extra.socials, ...home.socials },
    booking: unique(home.booking, extra.booking),
    ordering: unique(home.ordering, extra.ordering),
    ota: unique(home.ota, extra.ota),
    emailTools: unique(home.emailTools, extra.emailTools),
    ga4: home.ga4 || extra.ga4,
    gtm: home.gtm || extra.gtm,
    metaPixel: home.metaPixel || extra.metaPixel,
    googleAds: Boolean(home.googleAds || extra.googleAds),
    chatWidget: unique(home.chatWidget ?? [], extra.chatWidget ?? []),
    testimonials: Boolean(home.testimonials || extra.testimonials),
    newsletter: Boolean(home.newsletter || extra.newsletter),
    video: Boolean(home.video || extra.video),
  }
}

export interface FindingContext {
  checks: readonly IndustryCheck[]
  rating: number | null
  reviewCount: number | null
  now?: Date
}

function finding(key: string, severity: Severity, service: AyavaService, title: string, detail: string): Finding {
  return { key, severity, service, title, detail }
}

/** The audit's problems, most serious first. Each maps to the Ayava service that fixes it. */
export function findingsFor(audit: LeadAudit, context: FindingContext): Finding[] {
  const out: Finding[] = []
  const year = (context.now ?? new Date()).getFullYear()
  const checks = new Set(context.checks)

  if (context.rating !== null && context.rating < 4) {
    out.push(finding('low_rating', context.rating < 3.5 ? 'high' : 'medium', 'reputation', `Google rating is ${context.rating.toFixed(1)}`, 'Most people skip businesses rated under 4 stars; reviews need managing and answering.'))
  }
  if (context.reviewCount !== null && context.reviewCount < 20) {
    out.push(finding('few_reviews', 'medium', 'reputation', `Only ${context.reviewCount} Google review${context.reviewCount === 1 ? '' : 's'}`, 'Few reviews make the business look small or new next to competitors with hundreds.'))
  }

  if (!audit.website) {
    // Only claimed after a web search found nothing; a listing without a website proves nothing.
    if (websiteKnownMissing(audit))
      out.push(finding('no_website', 'high', 'website', 'No website found', 'We searched online and found no website of the business’s own, so customers only see directory listings: nowhere to explain services, show proof or take enquiries.'))
    return sortFindings(out)
  }
  const site = audit.site
  if (!site) {
    out.push(finding('site_down', 'high', 'website', 'Website doesn’t load', audit.siteError ?? 'The website could not be opened when we checked.'))
    return sortFindings(out)
  }

  if (!site.https) out.push(finding('no_https', 'medium', 'website', 'No secure connection (HTTPS)', 'Browsers mark the site “Not secure”, which puts visitors off.'))
  if (!site.viewport) out.push(finding('not_mobile', 'high', 'website', 'Not built for mobile', 'The site has no mobile layout, and most visitors come from phones.'))
  if (audit.speed) {
    const seconds = audit.speed.lcpMs ? ` (main content after ${(audit.speed.lcpMs / 1000).toFixed(1)} s)` : ''
    if (audit.speed.performance < 50) out.push(finding('slow_mobile', 'high', 'website', `Slow on mobile: ${audit.speed.performance}/100`, `Google’s speed test scores the mobile site ${audit.speed.performance}/100${seconds}; slow sites lose visitors before they load.`))
    else if (audit.speed.performance < 70) out.push(finding('slow_mobile', 'medium', 'website', `Could be faster on mobile: ${audit.speed.performance}/100`, `Google’s speed test scores the mobile site ${audit.speed.performance}/100${seconds}.`))
  }
  if (site.copyrightYear !== null && site.copyrightYear <= year - 2) {
    out.push(finding('stale_site', 'medium', 'website', `Looks out of date (© ${site.copyrightYear})`, 'An old copyright year suggests the site hasn’t been updated for years.'))
  }
  if (site.platform && ['Wix', 'GoDaddy Website Builder', 'Blogger', 'Google Sites'].includes(site.platform)) {
    out.push(finding('builder_site', 'low', 'website', `Built on ${site.platform}`, 'Site builders limit speed, SEO and custom features as a business grows.'))
  }

  const leadFormNeeded = checks.has('lead_form')
  if (!site.contactForm && !site.whatsapp) {
    out.push(finding('no_enquiry', leadFormNeeded ? 'high' : 'medium', 'analytics_cro', 'No enquiry form or WhatsApp button', 'Visitors who are ready to ask have no quick way to do it, so enquiries are lost.'))
  }
  if (checks.has('booking') && !site.booking.length) {
    out.push(finding('no_booking', 'high', 'website', 'No online booking', 'Customers can’t book an appointment online; they have to call during opening hours.'))
  }
  if (checks.has('direct_booking') && !site.booking.length) {
    out.push(finding('no_direct_booking', 'high', 'website', site.ota.length ? `Bookings go through ${site.ota.slice(0, 2).join(' and ')}` : 'No direct booking on the website', 'Every booking through a travel site costs 15–25% commission; a booking engine on the own site keeps it.'))
  }
  if (checks.has('ordering') && !site.ordering.length) {
    out.push(finding('no_ordering', 'medium', 'website', 'No online ordering link', 'Hungry visitors can’t order from the website or find the business on Zomato/Swiggy from it.'))
  }
  if (checks.has('menu') && site.menuPdf && !site.menuPage) {
    out.push(finding('menu_pdf', 'medium', 'website', 'Menu is only a PDF', 'PDF menus are hard to read on phones and invisible to Google searches for dishes.'))
  }
  if (checks.has('store') && !site.store) {
    out.push(finding('no_store', 'medium', 'ecommerce', 'No online store', 'Products can’t be bought online, so sales stop at the shop’s opening hours and location.'))
  }
  if (checks.has('portfolio') && !site.portfolio) {
    out.push(finding('no_portfolio', 'medium', 'website', 'No portfolio or project gallery', 'Buyers want to see past work before they enquire.'))
  }

  if (!site.ga4 && !site.gtm) out.push(finding('no_analytics', 'medium', 'analytics_cro', 'No analytics', 'There is no Google Analytics, so nobody knows where visitors come from or what they do.'))
  if (!site.metaPixel) out.push(finding('no_pixel', 'low', 'meta_ads', 'No Meta Pixel', 'Visitors can’t be retargeted on Instagram and Facebook, and ad results can’t be measured.'))
  if (!site.emailTools.length && !site.newsletter) out.push(finding('no_email_capture', 'low', 'email_crm', 'No email marketing set up', 'There is no way to collect and follow up with interested visitors by email.'))

  if (!site.title || !site.metaDescription) out.push(finding('weak_seo_tags', 'medium', 'seo', 'Missing search titles or descriptions', 'Google shows a poor or auto-generated snippet, so fewer people click.'))
  if (!site.h1) out.push(finding('no_h1', 'low', 'seo', 'No main heading', 'Search engines can’t tell what the page is about.'))
  if (audit.sitemap === false) out.push(finding('no_sitemap', 'low', 'seo', 'No sitemap', 'Google may not find all the pages.'))
  if (site.wordCount < 150) out.push(finding('thin_content', 'medium', 'content', 'Very little text on the homepage', 'With so little content the site can’t rank for the services it offers.'))
  if (!site.blog) out.push(finding('no_blog', 'low', 'content', 'No blog or articles', 'There is no content bringing in visitors from Google searches.'))
  if (site.images >= 4 && site.imagesWithoutAlt / site.images > 0.5) {
    out.push(finding('images_no_alt', 'low', 'seo', 'Images have no descriptions', `${site.imagesWithoutAlt} of ${site.images} images have no alt text, which hurts search and accessibility.`))
  }

  if (!site.socials.instagram && !site.socials.facebook) out.push(finding('no_socials', 'medium', 'smm', 'No social media linked', 'The site doesn’t link to Instagram or Facebook, where customers check a business first.'))
  if (!site.ogImage) out.push(finding('no_share_preview', 'low', 'smm', 'No preview when shared', 'Links shared on WhatsApp or social media show no image.'))

  if ((audit.version ?? 1) >= 3) out.push(...v3Findings(audit, site, context))
  return sortFindings(out)
}

function monthYear(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
}

function daysSince(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? null : Math.floor((now.getTime() - t) / 86_400_000)
}

/** The checks added in audit version 3: SEO depth, ads, social, video, content freshness, branding, chat, trust. */
function v3Findings(audit: LeadAudit, site: SiteSignals, context: FindingContext): Finding[] {
  const out: Finding[] = []
  const now = context.now ?? new Date()

  // SEO
  if (site.noindex) out.push(finding('noindex', 'high', 'seo', 'Hidden from Google', 'The homepage tells search engines not to list it (a “noindex” tag), so it can’t appear in searches.'))
  if (audit.speed?.seo != null && audit.speed.seo < 80) out.push(finding('lighthouse_seo', 'medium', 'seo', `Google’s SEO check scores ${audit.speed.seo}/100`, 'Google’s own Lighthouse test finds basic SEO problems on the homepage.'))
  if (!hasBusinessSchema(site.structuredData)) out.push(finding('no_schema', 'low', 'seo', 'No business details for Google', 'There is no structured data (schema markup) giving Google the address, hours and services, which helps local search.'))
  const search = audit.search
  if (search) {
    const rivals = search.competitors.length ? ` Sites that do appear: ${search.competitors.slice(0, 3).join(', ')}.` : ''
    if (search.position === null) out.push(finding('not_ranking', 'high', 'seo', `Not in the top 10 search results for “${search.query}”`, `In a web search for “${search.query}” the website isn’t on the first page.${rivals}`))
    else if (search.position > 3) out.push(finding('low_ranking', 'medium', 'seo', `Number ${search.position} in search results for “${search.query}”`, `In a web search for “${search.query}” it’s below the top three, where most clicks go.${rivals}`))
  }

  // Google Ads
  if (!site.googleAds) {
    if (search && search.position === null)
      out.push(finding('no_google_ads', 'medium', 'google_ads', 'No sign of Google Ads', `The site isn’t on the first page for “${search.query}” and has no Google Ads tracking, so people searching right now find other businesses.`))
    else out.push(finding('no_ads_tracking', 'low', 'google_ads', 'No Google Ads conversion tracking', 'If ads run, nobody can see which ones bring enquiries.'))
  }

  // Social media (Instagram)
  const ig = audit.instagram
  if (ig) {
    const quiet = daysSince(ig.lastPostAt, now)
    if (ig.posts === 0) out.push(finding('ig_empty', 'high', 'smm', 'Instagram has no posts', `@${ig.handle} is linked from the website but has never posted.`))
    else if (quiet !== null && quiet > 60) out.push(finding('ig_inactive', 'high', 'smm', `Instagram quiet since ${monthYear(ig.lastPostAt!)}`, `@${ig.handle} hasn’t posted for ${Math.round(quiet / 30)} months; customers checking it think the business is closed or inactive.`))
    if (ig.followers < 1000) out.push(finding('ig_small', 'medium', 'smm', `Only ${ig.followers} Instagram followers`, 'A small audience means posts reach few local customers.'))
    else if (ig.engagementPct !== null && ig.engagementPct < 1) out.push(finding('ig_engagement', 'medium', 'smm', `Low Instagram engagement (${ig.engagementPct.toFixed(1)}%)`, `Recent posts get few likes and comments for ${ig.followers} followers.`))
  }

  // Video
  const yt = audit.youtube
  if (!site.video && !site.socials.youtube) out.push(finding('no_video', 'low', 'video', 'No video on the website', 'Short videos (walkthroughs, testimonials) build trust and work on Reels and YouTube too.'))
  if (yt) {
    const quiet = daysSince(yt.lastUploadAt, now)
    if (yt.videos === 0) out.push(finding('yt_empty', 'medium', 'video', 'YouTube channel has no videos', 'The channel is linked from the website but empty.'))
    else if (quiet !== null && quiet > 120) out.push(finding('yt_inactive', 'medium', 'video', `No YouTube upload since ${monthYear(yt.lastUploadAt!)}`, 'An inactive channel misses search traffic from YouTube and Google.'))
  }

  // Content freshness
  const stale = daysSince(audit.sitemapLatest, now)
  if (stale !== null && stale > 365) out.push(finding('no_updates', 'medium', 'content', `No page updated since ${monthYear(audit.sitemapLatest!)}`, 'The sitemap shows nothing new for over a year; fresh pages and posts keep a site ranking.'))

  // Branding
  if (audit.favicon === false) out.push(finding('no_favicon', 'low', 'branding', 'No browser tab icon', 'The site shows a blank icon in browser tabs and bookmarks, which looks unfinished.'))
  if (site.logo === false) out.push(finding('no_logo', 'low', 'branding', 'No logo found on the homepage', 'We couldn’t find a logo image; a clear logo makes the business memorable.'))

  // AI chat
  if (!site.chatWidget?.length)
    out.push(site.whatsapp
      ? finding('no_chat_assistant', 'low', 'ai', 'No automated chat assistant', 'An AI assistant can answer common questions and capture enquiries at any hour, not only when someone replies on WhatsApp.')
      : finding('no_chat', 'medium', 'ai', 'No instant chat for visitors', 'Visitors with a quick question have no chat or WhatsApp; an AI assistant could answer and capture the enquiry.'))

  // Conversion & trust
  if (!site.phones.length) out.push(finding('no_click_to_call', 'medium', 'analytics_cro', 'No tap-to-call button', 'Mobile visitors can’t call the business in one tap.'))
  if (!site.testimonials) out.push(finding('no_testimonials', 'low', 'reputation', 'No reviews or testimonials on the website', 'Visitors see no proof from past customers before they enquire.'))
  if (audit.speed?.accessibility != null && audit.speed.accessibility < 70) out.push(finding('accessibility', 'low', 'website', `Accessibility scores ${audit.speed.accessibility}/100`, 'Google’s Lighthouse test finds text, contrast or button problems that make the site hard to use.'))
  return out
}

/** True only when a web search confirmed there's no website (not just a listing without one). */
export function websiteKnownMissing(audit: LeadAudit | null): boolean {
  return Boolean(audit && !audit.website && audit.websiteLookup?.result === 'not_found' && audit.websiteLookup.searched)
}

/** Whether the audit can be scored: it has a website, or a search proved there is none. */
export function websiteSettled(audit: LeadAudit | null): boolean {
  return Boolean(audit && (audit.website || websiteKnownMissing(audit)))
}

const FREE_MAIL = /@(gmail|googlemail|yahoo|ymail|rediffmail|outlook|hotmail|live|icloud|me|aol|proton|protonmail|zoho|yandex)\.[a-z.]+$/i
const NO_REPLY = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|abuse|webmaster|privacy|unsubscribe)@/i

/**
 * Addresses a business publishes for itself: on its own domain, or a free mailbox
 * (gmail…) shown on its site. An address on another company's domain (often the
 * web designer's, in the footer) is not the business's.
 */
export function ownEmails(emails: string[], siteUrl: string | null): string[] {
  let host = ''
  try {
    host = siteUrl ? new URL(siteUrl).hostname.replace(/^www\./, '').toLowerCase() : ''
  } catch {
    host = ''
  }
  const base = host.split('.').slice(-3).join('.')
  return emails.filter((e) => {
    if (NO_REPLY.test(e)) return false
    const domain = e.split('@')[1] ?? ''
    return FREE_MAIL.test(e) || (host !== '' && (domain === host || host.endsWith(`.${domain}`) || domain.endsWith(`.${base}`)))
  })
}

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 }

function sortFindings(list: Finding[]): Finding[] {
  return [...list].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
}

/** Services the findings point to, most-needed first (by total severity weight). */
export function servicesFor(findings: Finding[]): { service: AyavaService; name: string; weight: number }[] {
  const weights = new Map<AyavaService, number>()
  for (const f of findings) weights.set(f.service, (weights.get(f.service) ?? 0) + SEVERITY_WEIGHT[f.severity])
  return [...weights.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([service, weight]) => ({ service, name: AYAVA_SERVICES[service], weight }))
}

export const SEVERITY_WEIGHT: Record<Severity, number> = { high: 25, medium: 12, low: 5 }

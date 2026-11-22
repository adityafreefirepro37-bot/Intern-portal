import { AYAVA_SERVICES, type AyavaService, type IndustryCheck } from './catalog'

/**
 * Website audit for a lead: signals read from the homepage (and its contact
 * page), turned into findings that each map to an Ayava service. Pure
 * functions with no I/O — the fetching lives in src/server/leads/research.ts.
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
}

export interface SpeedResult {
  performance: number
  lcpMs: number | null
  cls: number | null
}

/** Current audit format. Leads researched with an older one are researched again. */
export const AUDIT_VERSION = 2

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
  version: 1 | 2
  checkedAt: string
  website: string | null
  /** Where the website came from: the listing, a likely address that proved to be theirs, or a web search. */
  websiteSource?: 'listing' | 'guess' | 'search' | null
  websiteLookup?: WebsiteLookup | null
  site: SiteSignals | null
  siteError: string | null
  speed: SpeedResult | null
  sitemap: boolean | null
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
  }
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
  if (!site.emailTools.length) out.push(finding('no_email_capture', 'low', 'email_crm', 'No email marketing set up', 'There is no way to collect and follow up with interested visitors by email.'))

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

  return sortFindings(out)
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

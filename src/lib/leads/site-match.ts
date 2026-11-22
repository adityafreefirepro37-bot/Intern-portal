import { visibleText } from './audit'

/**
 * Finding a business's own website when its listing has none. Two ways, both
 * public and legitimate: likely addresses built from the business name
 * (shreebabaproperties.com, .in, .co.in…) and, when a key is set, a web search
 * (Brave Search API). Every candidate page is opened and must prove it belongs
 * to the business — its distinctive name words plus its phone number or city —
 * so a lookalike or parked domain is never taken for the business. Pure
 * functions; the fetching lives in src/server/leads/pipeline.ts.
 */

/** Legal suffixes and filler: never part of a domain guess. */
const FILLER = new Set(['the', 'and', 'of', 'pvt', 'private', 'ltd', 'limited', 'llp', 'co', 'inc', 'opc', 'mr', 'dr', 'm/s', 'ms'])

/**
 * Words that say what a business is rather than which one it is. Kept in domain
 * guesses (sharmadental.com) but never enough on their own to prove a match.
 */
const GENERIC = new Set([
  'property', 'properties', 'real', 'estate', 'realty', 'realtors', 'dealer', 'dealers', 'associates', 'associate',
  'developers', 'developer', 'builders', 'construction', 'constructions', 'infra', 'infratech', 'homes', 'housing',
  'clinic', 'clinics', 'dental', 'dentist', 'hospital', 'hospitals', 'medical', 'medicare', 'healthcare', 'health', 'care',
  'diagnostics', 'diagnostic', 'lab', 'labs', 'pathology', 'pharmacy', 'chemist', 'skin', 'eye', 'physiotherapy',
  'hotel', 'hotels', 'resort', 'resorts', 'stay', 'homestay', 'inn', 'lodge', 'guest', 'house', 'restaurant', 'cafe',
  'bakery', 'kitchen', 'dhaba', 'foods', 'food', 'sweets', 'caterers', 'catering', 'school', 'schools', 'academy',
  'institute', 'classes', 'coaching', 'tutorials', 'college', 'education', 'educational', 'centre', 'center',
  'salon', 'spa', 'parlour', 'parlor', 'beauty', 'unisex', 'studio', 'studios', 'gym', 'fitness', 'yoga', 'store',
  'stores', 'shop', 'mart', 'enterprises', 'enterprise', 'traders', 'trading', 'solutions', 'services', 'service',
  'group', 'india', 'indian', 'consultants', 'consultancy', 'agency', 'travels', 'travel', 'tours', 'holidays',
  'motors', 'automobiles', 'auto', 'garage', 'furniture', 'interiors', 'interior', 'designs', 'design', 'events',
  'wedding', 'photography', 'jewellers', 'jewellery', 'boutique', 'fashion', 'garments', 'collection', 'industries',
  'international', 'global', 'new', 'shri', 'shree', 'sri', 'om', 'jai', 'maa', 'city', 'office', 'company',
])

/** Lower-case words of a business name (accents and punctuation removed). */
export function nameWords(name: string): string[] {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !FILLER.has(w))
}

/** The words that identify this particular business (not its trade or a blessing). */
export function distinctiveWords(name: string, city?: string | null): string[] {
  const cityWords = new Set(city ? nameWords(city) : [])
  return [...new Set(nameWords(name).filter((w) => w.length >= 3 && !GENERIC.has(w) && !cityWords.has(w)))]
}

/** Likely own-domain addresses for a business, best guesses first (at most `limit`). */
export function domainGuesses(name: string, city?: string | null, limit = 8): string[] {
  const words = nameWords(name)
  const distinct = distinctiveWords(name, city)
  if (!distinct.length) return [] // "Property Dealer" has no address of its own to guess.
  const stems = new Set<string>()
  const full = words.join('')
  if (full.length >= 4 && full.length <= 40) stems.add(full)
  // One distinctive word alone (friends.com, sharma.in) is always somebody else's.
  const short = distinct.join('')
  if (distinct.length >= 2 && short.length <= 30) stems.add(short)
  if (words.length >= 2 && full.length <= 40) stems.add(words.join('-'))
  const cityStem = city ? nameWords(city).join('') : ''
  if (cityStem && full.length + cityStem.length <= 40) stems.add(full + cityStem)
  const out: string[] = []
  for (const stem of stems) for (const tld of ['.com', '.in', '.co.in']) out.push(`https://${stem}${tld}/`)
  return out.slice(0, limit)
}

const PARKED =
  /domain (name )?(is )?for sale|buy this domain|this domain (may be|is) for sale|parked (free|domain)|sedo(parking)?|domain parking|hugedomains|dan\.com|afternic|godaddy\.com\/domainsearch|this site can.t be reached|account (has been )?suspended|default web site page|welcome to nginx|apache2? (ubuntu )?default page|index of \//i

export interface CandidatePage {
  url: string
  html: string
}

export interface SiteMatch {
  ok: boolean
  /** Why the page was or wasn't taken as the business's website (shown on the lead page). */
  reason: string
}

function digitsOnly(text: string) {
  return text.replace(/\D/g, '')
}

function containsWord(haystack: string, word: string) {
  return new RegExp(`(^|[^a-z0-9])${word}([^a-z0-9]|$)`).test(haystack)
}

/**
 * Does this page belong to the business? It must name it (every distinctive
 * word in the title, text or domain) and confirm it with the listed phone
 * number or the city. A matching phone number with part of the name also counts.
 */
export function matchSite(page: CandidatePage, lead: { name: string; city: string | null; phone: string | null }): SiteMatch {
  const text = visibleText(page.html).toLowerCase()
  const title = page.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.toLowerCase() ?? ''
  if (PARKED.test(`${title} ${text.slice(0, 3000)}`)) return { ok: false, reason: 'parked or placeholder page' }
  if (text.split(' ').length < 30) return { ok: false, reason: 'almost empty page' }

  let host = ''
  try {
    host = new URL(page.url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return { ok: false, reason: 'bad address' }
  }
  const domainStem = host.split('.')[0]!.replace(/-/g, '')
  const haystack = `${title} ${text}`
  const distinct = distinctiveWords(lead.name, lead.city)
  const named = distinct.filter((w) => containsWord(haystack, w) || domainStem.includes(w))
  const fullName = distinct.length > 0 && named.length === distinct.length

  const phone = lead.phone ? digitsOnly(lead.phone).slice(-10) : ''
  const phoneMatch = phone.length === 10 && digitsOnly(page.html).includes(phone)
  const cityMatch = Boolean(lead.city) && nameWords(lead.city!).every((w) => containsWord(haystack, w))

  if (phoneMatch && named.length > 0) return { ok: true, reason: 'name and phone number match' }
  if (fullName && cityMatch) return { ok: true, reason: 'name and city match' }
  if (fullName && phoneMatch) return { ok: true, reason: 'name and phone number match' }
  if (!distinct.length) return { ok: false, reason: 'business name too general to confirm' }
  if (!fullName) return { ok: false, reason: 'page is about a different business' }
  return { ok: false, reason: NAME_ONLY }
}

/** matchSite's reason when only the name matched: the contact page may still confirm it. */
export const NAME_ONLY = 'name matches but not the phone number or city'

/**
 * Sites that list many businesses (directories, maps, marketplaces, social
 * networks): a search result there is never the business's own website.
 */
const DIRECTORIES =
  /(^|\.)(justdial|indiamart|tradeindia|sulekha|yellowpages|asklaila|grotal|getmeashop|nearbuy|magicbricks|99acres|housing|nobroker|commonfloor|makaan|squareyards|proptiger|quikr|olx|practo|lybrate|credihealth|zomato|swiggy|eazydiner|dineout|tripadvisor|booking|makemytrip|goibibo|agoda|airbnb|expedia|trivago|oyorooms|yatra|cleartrip|facebook|instagram|linkedin|twitter|x|youtube|pinterest|threads|wikipedia|wikimapia|google|bing|yelp|foursquare|mapmyindia|zaubacorp|tofler|crunchbase|falconebiz|thecompanycheck|indiafilings|urbancompany|shiksha|collegedunia|careers360|getmyuni|amazon|flipkart|meesho|wa|whatsapp|linktr|blogspot|wordpress|medium|reddit|quora|glassdoor|naukri|indeed|apnacircle|dial4trade|exportersindia|helpline|zoominfo|dnb|apollo247|1mg|pharmeasy|weddingwire|wedmegood|weddingz|urbanclap|yellowpage|indiacom|justdialb2b)\.[a-z.]+$/i

export function isDirectory(url: string): boolean {
  try {
    return DIRECTORIES.test(new URL(url).hostname.replace(/^www\./, ''))
  } catch {
    return true
  }
}

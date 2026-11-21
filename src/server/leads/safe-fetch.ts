import 'server-only'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

/**
 * Fetches a business's public web page for the lead audit. The address comes
 * from Google / OpenStreetMap data, so it is untrusted: only http(s) on the
 * standard ports, never a private, loopback or link-local address (checked on
 * every redirect hop), a short timeout and a size limit. Returns text only.
 */

const MAX_REDIRECTS = 4
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 site-audit'

export class FetchBlockedError extends Error {}

function privateV4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number) as [number, number]
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

function privateV6(ip: string): boolean {
  const v = ip.toLowerCase()
  if (v === '::' || v === '::1') return true
  if (v.startsWith('::ffff:')) return privateV4(v.slice(7))
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v)
}

export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip)
  if (kind === 4) return privateV4(ip)
  if (kind === 6) return privateV6(ip)
  return true
}

async function assertPublic(url: URL) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new FetchBlockedError('Only web addresses can be checked')
  if (url.port && url.port !== '80' && url.port !== '443') throw new FetchBlockedError('Unusual port')
  if (url.username || url.password) throw new FetchBlockedError('Address contains credentials')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(host)) throw new FetchBlockedError('Private address')
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true })
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) throw new FetchBlockedError('Private address')
}

export interface FetchedPage {
  url: string
  status: number
  contentType: string
  text: string
}

async function readLimited(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  while (size < maxBytes) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.byteLength
  }
  await reader.cancel().catch(() => undefined)
  const all = new Uint8Array(Math.min(size, maxBytes))
  let offset = 0
  for (const chunk of chunks) {
    const part = chunk.subarray(0, Math.max(0, all.length - offset))
    all.set(part, offset)
    offset += part.length
    if (offset >= all.length) break
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(all)
}

/** Normalises what a listing gives as a website ("example.com", "http://…") to a URL, or null. */
export function normaliseWebsite(raw: string | null | undefined): string | null {
  if (!raw) return null
  let value = raw.trim()
  if (!value || /\s/.test(value)) return null
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`
  try {
    const url = new URL(value)
    if (!url.hostname.includes('.')) return null
    // Social profiles and link-in-bio pages aren't the business's own website.
    if (/(^|\.)(facebook|instagram|linkedin|twitter|x|youtube|wa|whatsapp|linktr|google|business\.site|justdial|indiamart|sulekha|zomato|swiggy|practo)\.(com|me|ee|site|in|co)$/i.test(url.hostname)) return null
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

export function domainOf(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return null
  }
}

export async function safeFetch(rawUrl: string, options: { timeoutMs?: number; maxBytes?: number; accept?: string } = {}): Promise<FetchedPage> {
  const deadline = AbortSignal.timeout(options.timeoutMs ?? 12_000)
  let url = new URL(rawUrl)
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublic(url)
    const response = await fetch(url, {
      redirect: 'manual',
      signal: deadline,
      headers: { 'user-agent': USER_AGENT, accept: options.accept ?? 'text/html,application/xhtml+xml,*/*;q=0.8', 'accept-language': 'en-IN,en;q=0.9' },
    })
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      await response.body?.cancel().catch(() => undefined)
      url = new URL(response.headers.get('location')!, url)
      continue
    }
    const contentType = response.headers.get('content-type') ?? ''
    const text = /text|html|xml|json/i.test(contentType) || !contentType ? await readLimited(response, options.maxBytes ?? 1_500_000) : ''
    if (!/text|html|xml|json/i.test(contentType) && contentType) await response.body?.cancel().catch(() => undefined)
    return { url: url.toString(), status: response.status, contentType, text }
  }
  throw new FetchBlockedError('Too many redirects')
}

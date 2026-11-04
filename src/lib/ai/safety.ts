/**
 * AYAVA AI safety helpers (pure — unit tested).
 *
 *  - redactSecrets / StreamRedactor: last-line defence so model output can never
 *    carry a credential, even one split across streamed chunks.
 *  - compact: shrinks tool results to small, minimal JSON and drops fields the
 *    AI must never see (credentials, storage paths, compensation…).
 *  - untrusted: fences retrieved/user-supplied text so it can't pose as instructions.
 */

const SECRET_PATTERNS: RegExp[] = [
  /\bnvapi-[A-Za-z0-9_-]{16,}/g,
  /\bsk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{16,}/g,
  /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{16,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWTs (e.g. service-role keys)
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s:@/]+:[^\s@/]+@[^\s]+/g, // connection strings with passwords
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
]

/** Replaces known secret values and secret-shaped strings with [redacted]. */
export function redactSecrets(text: string, secrets: readonly (string | undefined | null)[] = []): string {
  let out = text
  for (const secret of secrets) {
    if (secret && secret.length >= 8) out = out.split(secret).join('[redacted]')
  }
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, '[redacted]')
  return out
}

/**
 * Redacts a streamed reply without ever emitting part of a secret: the last
 * `holdBack` characters stay buffered until more text (or the end) arrives.
 */
export class StreamRedactor {
  private pending = ''
  private emitted = ''

  constructor(
    private readonly secrets: readonly (string | undefined | null)[] = [],
    private readonly holdBack = 160,
  ) {}

  /** Feed a chunk; returns text that is safe to send now. */
  push(chunk: string): string {
    this.pending += chunk
    const safe = redactSecrets(this.emitted + this.pending, this.secrets)
    const ready = safe.length - this.holdBack
    if (ready <= this.emitted.length) return ''
    const out = safe.slice(this.emitted.length, ready)
    this.emitted += out
    this.pending = safe.slice(ready)
    return out
  }

  /** Flush the remainder at the end of the stream. */
  end(): string {
    const safe = redactSecrets(this.emitted + this.pending, this.secrets)
    const out = safe.slice(this.emitted.length)
    this.emitted = safe
    this.pending = ''
    return out
  }

  get text() {
    return this.emitted + this.pending
  }
}

/** Keys never passed to the model, whatever service returned them. */
const DENY_KEY =
  /password|token|secret|api_?key|is_correct|correct_answer|correct_option|answer_key|explanation|storage_?path|signed_?url|ip_?address|user_?agent|auth_?user|session|stipend|salary|compensation|bank|account_?number|ifsc|pan_?number|aadhaar|tax|emergency|date_?of_?birth|dob|home_?address|phone/i

export interface CompactOptions {
  maxDepth?: number
  maxArray?: number
  maxString?: number
}

/**
 * Minimal JSON-safe copy of service output for the model: dates become ISO
 * dates, empty values and denied keys are dropped, arrays and strings capped.
 */
export function compact(value: unknown, options: CompactOptions = {}, depth = 0): unknown {
  const { maxDepth = 5, maxArray = 15, maxString = 600 } = options
  if (value === null || value === undefined) return undefined
  if (value instanceof Date) {
    const iso = value.toISOString()
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.slice(0, 16).replace('T', ' ')
  }
  if (typeof value === 'string') return value.length > maxString ? `${value.slice(0, maxString)}…` : value
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return Number(value)
  if (depth >= maxDepth) return undefined
  if (Array.isArray(value)) {
    const items = value.slice(0, maxArray).map((item) => compact(item, options, depth + 1)).filter((v) => v !== undefined)
    if (value.length > maxArray) items.push(`…${value.length - maxArray} more`)
    return items.length ? items : undefined
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (DENY_KEY.test(key) || key.startsWith('_') || typeof item === 'function') continue
      const next = compact(item, options, depth + 1)
      if (next === undefined || (typeof next === 'object' && next !== null && !Array.isArray(next) && !Object.keys(next).length)) continue
      out[key] = next
    }
    return Object.keys(out).length ? out : undefined
  }
  return undefined
}

/** Neutralizes a closing fence inside untrusted text so it can't end the block early. */
function defang(text: string, tag: string) {
  return text.replace(new RegExp(`</?\\s*${tag}`, 'gi'), (match) => match.replace('<', '‹'))
}

/**
 * Wraps untrusted content (retrieved documents, uploaded text) in a fenced
 * block. The system prompt tells the model to treat everything inside as data.
 */
export function untrusted(tag: 'document' | 'tool_result' | 'record', attributes: Record<string, string | number | undefined>, body: string) {
  const attrs = Object.entries(attributes)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}="${String(v).replace(/["<>\n]/g, ' ')}"`)
    .join(' ')
  return `<${tag}${attrs ? ` ${attrs}` : ''}>\n${defang(body, tag)}\n</${tag}>`
}

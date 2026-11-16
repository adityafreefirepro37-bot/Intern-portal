/**
 * Certificate wording and identifiers. Pure functions shared by the PDF renderer,
 * the on-page preview and the public verification page.
 */

export const CERTIFICATE_TYPES = ['COMPLETION', 'EXPERIENCE', 'EXCELLENCE', 'PARTICIPATION'] as const
export type CertificateTypeValue = (typeof CERTIFICATE_TYPES)[number]

export const CERTIFICATE_TYPE_LABELS: Record<CertificateTypeValue, string> = {
  COMPLETION: 'Completion',
  EXPERIENCE: 'Experience',
  EXCELLENCE: 'Excellence',
  PARTICIPATION: 'Participation',
}

export const CERTIFICATE_TYPE_HINTS: Record<CertificateTypeValue, string> = {
  COMPLETION: 'Completed the internship (or a course).',
  EXPERIENCE: 'Worked with the organization for the period — for job applications.',
  EXCELLENCE: 'Outstanding performance; add a citation saying what for.',
  PARTICIPATION: 'Took part in the programme without completing it.',
}

export interface CertificateText {
  type: CertificateTypeValue
  recipientName: string
  programTitle: string | null
  departmentName: string | null
  organizationName: string
  courseTitle?: string | null
  periodStart: Date | null
  periodEnd: Date | null
  citation: string | null
}

/** "1 June 2026" for a calendar date (stored at UTC midnight). */
export function formatCertificateDate(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date)
}

function period(text: CertificateText) {
  if (text.periodStart && text.periodEnd) {
    return ` from ${formatCertificateDate(text.periodStart)} to ${formatCertificateDate(text.periodEnd)}`
  }
  if (text.periodEnd) return ` until ${formatCertificateDate(text.periodEnd)}`
  if (text.periodStart) return ` from ${formatCertificateDate(text.periodStart)}`
  return ''
}

function role(text: CertificateText) {
  const program = text.programTitle ? ` as ${withArticle(text.programTitle)}` : ''
  const team = text.departmentName ? ` in the ${text.departmentName} team` : ''
  return `${program}${team}`
}

/**
 * "a Web Development Intern" / "an Engineering Intern" / "a UI/UX Intern" /
 * "an SEO Intern". Goes by sound: acronyms by their first letter's name,
 * "u" words like "user" / "unity" take "a".
 */
export function withArticle(title: string) {
  const t = title.trim()
  const first = t.split(/[\s/-]/)[0] ?? ''
  let an: boolean
  if (first.length > 1 && first === first.toUpperCase() && /^[A-Z]/.test(first)) {
    an = 'AEFHILMNORSX'.includes(first[0]!)
  } else if (/^u[bcdfghjklmnpqrstvwxyz][aeiou]/i.test(t)) {
    an = false
  } else {
    an = /^[aeiou]/i.test(t)
  }
  return `${an ? 'an' : 'a'} ${t}`
}

/** Heading, lead-in and body of a certificate. */
export function certificateWording(text: CertificateText): { heading: string; lead: string; body: string } {
  const org = text.organizationName
  if (text.courseTitle) {
    return {
      heading: 'Certificate of Completion',
      lead: 'This is to certify that',
      body: `has successfully completed the course “${text.courseTitle}” at ${org}${text.periodEnd ? ` on ${formatCertificateDate(text.periodEnd)}` : ''}.`,
    }
  }
  switch (text.type) {
    case 'EXPERIENCE':
      return {
        heading: 'Experience Certificate',
        lead: 'This is to certify that',
        body: `worked with ${org}${role(text)}${period(text)}. We found them sincere, hardworking and a valued member of the team, and wish them every success.`,
      }
    case 'EXCELLENCE':
      return {
        heading: 'Certificate of Excellence',
        lead: 'This certificate is proudly presented to',
        body: `in recognition of outstanding performance${role(text)} at ${org}${period(text)}.`,
      }
    case 'PARTICIPATION':
      return {
        heading: 'Certificate of Participation',
        lead: 'This is to certify that',
        body: `participated in the internship programme at ${org}${role(text)}${period(text)}.`,
      }
    default:
      return {
        heading: 'Certificate of Completion',
        lead: 'This is to certify that',
        body: `has successfully completed an internship${role(text)} at ${org}${period(text)}.`,
      }
  }
}

/** Permanent numbers: AYV-CERT-2026-0007. */
export function certificateNumber(year: number, sequence: number): string {
  return `AYV-CERT-${year}-${String(sequence).padStart(4, '0')}`
}

/** Unambiguous alphabet (no 0/O, 1/I/L) for codes people may type. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/** XXXX-XXXX-XXXX from 12 random bytes (≈59 bits). */
export function formatVerificationCode(bytes: Uint8Array): string {
  const chars = Array.from(bytes.subarray(0, 12), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length])
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}`
}

/** Normalizes what someone typed (case, spaces, missing dashes) into stored form, or null. */
export function normalizeVerificationCode(input: string): string | null {
  const compact = input.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (compact.length !== 12 || [...compact].some((c) => !CODE_ALPHABET.includes(c))) return null
  return `${compact.slice(0, 4)}-${compact.slice(4, 8)}-${compact.slice(8, 12)}`
}

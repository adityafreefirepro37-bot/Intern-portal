/**
 * iCalendar (RFC 5545) export for meetings, so people can add them to Google
 * Calendar, Outlook or Apple Calendar. Times are written in UTC.
 */

export interface IcsEvent {
  uid: string
  /** Increments on every change so calendar apps replace the old copy. */
  sequence: number
  start: Date
  end: Date
  summary: string
  description?: string | null
  location?: string | null
  url?: string | null
  organizer?: { name: string; email: string } | null
  attendees?: { name: string; email: string; response?: 'PENDING' | 'ACCEPTED' | 'TENTATIVE' | 'DECLINED' }[]
  cancelled?: boolean
  updatedAt: Date
}

const PARTSTAT = { PENDING: 'NEEDS-ACTION', ACCEPTED: 'ACCEPTED', TENTATIVE: 'TENTATIVE', DECLINED: 'DECLINED' } as const

/** 20261114T093000Z */
export function icsDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/** Escapes TEXT values: backslash, semicolon, comma and newlines. */
export function icsText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

/** Parameter values (CN) can't contain quotes; wrap in quotes to allow : ; , */
function icsParam(value: string): string {
  return `"${value.replace(/"/g, "'")}"`
}

/** Folds lines longer than 75 octets (continuation lines start with a space). */
export function foldLine(line: string): string {
  const bytes = new TextEncoder().encode(line)
  if (bytes.length <= 75) return line
  const out: string[] = []
  let current = ''
  let size = 0
  for (const char of line) {
    const charSize = new TextEncoder().encode(char).length
    const limit = out.length === 0 ? 75 : 74
    if (size + charSize > limit) {
      out.push(current)
      current = ''
      size = 0
    }
    current += char
    size += charSize
  }
  out.push(current)
  return out.join('\r\n ')
}

export function buildIcs(events: IcsEvent[], options: { calendarName?: string; method?: 'PUBLISH' } = {}): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AYAVA//Intern OS//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${options.method ?? 'PUBLISH'}`,
    ...(options.calendarName ? [`X-WR-CALNAME:${icsText(options.calendarName)}`] : []),
  ]
  for (const event of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.uid}`,
      `SEQUENCE:${event.sequence}`,
      `DTSTAMP:${icsDate(event.updatedAt)}`,
      `LAST-MODIFIED:${icsDate(event.updatedAt)}`,
      `DTSTART:${icsDate(event.start)}`,
      `DTEND:${icsDate(event.end)}`,
      `SUMMARY:${icsText(event.summary)}`,
      `STATUS:${event.cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    )
    if (event.description) lines.push(`DESCRIPTION:${icsText(event.description)}`)
    if (event.location) lines.push(`LOCATION:${icsText(event.location)}`)
    if (event.url) lines.push(`URL:${event.url}`)
    if (event.organizer)
      lines.push(`ORGANIZER;CN=${icsParam(event.organizer.name)}:mailto:${event.organizer.email}`)
    for (const attendee of event.attendees ?? []) {
      lines.push(
        `ATTENDEE;CN=${icsParam(attendee.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=${PARTSTAT[attendee.response ?? 'PENDING']}:mailto:${attendee.email}`,
      )
    }
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.map(foldLine).join('\r\n') + '\r\n'
}

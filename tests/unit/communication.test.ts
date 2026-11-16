import {
  dayKeyIn,
  monthGrid,
  overlaps,
  parseDay,
  sortItems,
  startOfWeek,
  toDayKey,
  viewRange,
  type CalendarItem,
} from '@/lib/communication/calendar'
import { buildIcs, foldLine, icsDate, icsText } from '@/lib/communication/ics'
import { extractMentionIds, mentionToken, mentionsToText } from '@/lib/communication/mentions'
import { categoryOf, DEFAULT_PREFERENCE, NOTIFICATION_CATEGORIES } from '@/lib/notifications/categories'
import { NOTIFICATION_TYPES } from '@/server/services/notification.service'

jest.mock('@/lib/db/client', () => ({ prisma: {} }))

describe('calendar dates', () => {
  it('parses only real calendar days', () => {
    expect(toDayKey(parseDay('2026-11-16')!)).toBe('2026-11-16')
    expect(parseDay('2026-02-30')).toBeNull()
    expect(parseDay('16/11/2026')).toBeNull()
    expect(parseDay(undefined)).toBeNull()
  })

  it('starts weeks on Monday', () => {
    expect(toDayKey(startOfWeek(parseDay('2026-11-16')!))).toBe('2026-11-16') // Monday
    expect(toDayKey(startOfWeek(parseDay('2026-11-22')!))).toBe('2026-11-16') // Sunday
  })

  it('builds whole weeks covering the month', () => {
    const grid = monthGrid(parseDay('2026-11-10')!)
    expect(grid.every((week) => week.length === 7)).toBe(true)
    expect(toDayKey(grid[0][0])).toBe('2026-10-26')
    expect(toDayKey(grid[grid.length - 1][6])).toBe('2026-12-06')
  })

  it('computes view ranges and navigation targets', () => {
    const week = viewRange('week', parseDay('2026-11-19')!)
    expect(week.days.map(toDayKey)[0]).toBe('2026-11-16')
    expect(toDayKey(week.prev)).toBe('2026-11-09')
    expect(toDayKey(week.next)).toBe('2026-11-23')
    const agenda = viewRange('agenda', parseDay('2026-11-19')!)
    expect(agenda.days).toHaveLength(30)
    const month = viewRange('month', parseDay('2026-01-15')!)
    expect(toDayKey(month.prev)).toBe('2025-12-01')
    expect(toDayKey(month.next)).toBe('2026-02-01')
  })

  it('buckets instants into the organization timezone day', () => {
    // 20:00 UTC on the 16th is already the 17th in India.
    expect(dayKeyIn(new Date('2026-11-16T20:00:00Z'), 'Asia/Kolkata')).toBe('2026-11-17')
    expect(dayKeyIn(new Date('2026-11-16T20:00:00Z'), 'UTC')).toBe('2026-11-16')
  })

  it('detects overlapping ranges, end-exclusive', () => {
    const t = (h: number) => new Date(Date.UTC(2026, 10, 16, h))
    expect(overlaps(t(9), t(10), t(9), t(11))).toBe(true)
    expect(overlaps(t(9), t(10), t(10), t(11))).toBe(false)
  })

  it('sorts all-day items before timed ones', () => {
    const item = (key: string, start: Date | null): CalendarItem => ({
      key,
      kind: 'MEETING',
      title: key,
      day: '2026-11-16',
      start,
      end: null,
      href: null,
    })
    const sorted = sortItems([item('late', new Date('2026-11-16T10:00:00Z')), item('all-day', null), item('early', new Date('2026-11-16T05:00:00Z'))])
    expect(sorted.map((i) => i.key)).toEqual(['all-day', 'early', 'late'])
  })
})

describe('iCalendar export', () => {
  it('formats UTC timestamps and escapes text', () => {
    expect(icsDate(new Date('2026-11-16T04:30:00.000Z'))).toBe('20261116T043000Z')
    expect(icsText('a, b; c\\d\nnext')).toBe('a\\, b\\; c\\\\d\\nnext')
  })

  it('folds long lines at 75 octets', () => {
    const folded = foldLine(`SUMMARY:${'x'.repeat(200)}`)
    for (const line of folded.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    expect(folded.split('\r\n').slice(1).every((line) => line.startsWith(' '))).toBe(true)
  })

  it('builds a calendar with organizer, attendees and cancellation', () => {
    const ics = buildIcs([
      {
        uid: 'meeting-1@ayava',
        sequence: 2,
        start: new Date('2026-11-16T04:30:00Z'),
        end: new Date('2026-11-16T05:00:00Z'),
        summary: 'Weekly 1:1',
        description: 'Agenda',
        organizer: { name: 'Rohan Das', email: 'mentor@example.com' },
        attendees: [{ name: 'Aanya', email: 'intern@example.com', response: 'DECLINED' }],
        cancelled: true,
        updatedAt: new Date('2026-11-15T00:00:00Z'),
      },
    ])
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(ics).toContain('DTSTART:20261116T043000Z')
    expect(ics).toContain('STATUS:CANCELLED')
    expect(ics).toContain('ORGANIZER;CN="Rohan Das":mailto:mentor@example.com')
    expect(ics).toContain('PARTSTAT=DECLINED')
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
  })
})

describe('mentions', () => {
  const id = '11111111-1111-4111-8111-111111111111'
  it('round-trips the mention markup', () => {
    const body = `Hi ${mentionToken('Asha [Lead] Rao', id)}and ${mentionToken('Asha Rao', id)}`
    expect(extractMentionIds(body)).toEqual([id])
    expect(mentionsToText(body)).toBe('Hi @Asha Lead Rao and @Asha Rao ')
  })
})

describe('notification categories', () => {
  it('puts every notification type in a known category', () => {
    for (const type of Object.values(NOTIFICATION_TYPES)) {
      expect(NOTIFICATION_CATEGORIES).toContain(categoryOf(type))
    }
    expect(categoryOf('TASK_ASSIGNED')).toBe('tasks')
    expect(categoryOf('MEETING_INVITED')).toBe('meetings')
    expect(categoryOf('DIRECT_MESSAGE')).toBe('messages')
    expect(categoryOf('LEAVE_APPROVED')).toBe('hr')
    expect(categoryOf('HR_REVIEW_DUE')).toBe('performance')
    expect(categoryOf('QUIZ_PASSED')).toBe('learning')
  })

  it('defaults to in-app everywhere, email only for meetings', () => {
    expect(NOTIFICATION_CATEGORIES.every((c) => DEFAULT_PREFERENCE[c].inApp)).toBe(true)
    expect(NOTIFICATION_CATEGORIES.filter((c) => DEFAULT_PREFERENCE[c].email)).toEqual(['meetings'])
  })
})

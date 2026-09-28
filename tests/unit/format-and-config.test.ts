import { parseEnv } from '@/lib/config'
import { describeDue, fullName, greeting, humanizeEnum, initials, percent, pluralize } from '@/lib/utils/format'

describe('format helpers', () => {
  it('builds initials and names', () => {
    expect(initials('Aanya Sharma')).toBe('AS')
    expect(initials('meera')).toBe('M')
    expect(initials('  ')).toBe('?')
    expect(fullName({ first_name: 'Rohan', last_name: 'Das' })).toBe('Rohan Das')
    expect(fullName({ first_name: 'Rohan', last_name: 'Das', display_name: 'Ro' })).toBe('Ro')
  })

  it('greets by the organization’s local time', () => {
    const instant = new Date('2026-09-28T03:00:00Z') // 08:30 in Kolkata, 23:00 previous day in New York
    expect(greeting(instant, 'Asia/Kolkata')).toBe('Good morning')
    expect(greeting(instant, 'America/New_York')).toBe('Good evening')
    expect(greeting(new Date('2026-09-28T09:00:00Z'), 'Asia/Kolkata')).toBe('Good afternoon')
  })

  it('describes due dates', () => {
    const now = new Date('2026-09-28T10:00:00Z')
    expect(describeDue(new Date('2026-09-26T10:00:00Z'), now)).toEqual({ label: 'Overdue by 2 days', tone: 'overdue' })
    expect(describeDue(new Date('2026-09-28T18:00:00Z'), now).label).toBe('Due today')
    expect(describeDue(new Date('2026-09-29T10:00:00Z'), now).label).toBe('Due tomorrow')
    expect(describeDue(new Date('2026-10-08T10:00:00Z'), now)).toEqual({ label: 'Due in 10 days', tone: 'later' })
  })

  it('humanizes enums, pluralizes and computes percentages', () => {
    expect(humanizeEnum('CHANGES_REQUESTED')).toBe('Changes requested')
    expect(pluralize(1, 'task')).toBe('1 task')
    expect(pluralize(3, 'task')).toBe('3 tasks')
    expect(percent(1, 3)).toBe(33)
    expect(percent(5, 0)).toBe(0)
  })
})

describe('parseEnv', () => {
  it('applies safe defaults', () => {
    const env = parseEnv({})
    expect(env.NODE_ENV).toBe('development')
    expect(env.STORAGE_PROVIDER).toBe('local')
    expect(env.DEFAULT_ORGANIZATION_SLUG).toBe('ayava-creatives')
  })

  it('treats blank values as unset', () => {
    expect(parseEnv({ SUPABASE_URL: '  ' }).SUPABASE_URL).toBeUndefined()
  })

  it('rejects invalid configuration with a clear message', () => {
    expect(() => parseEnv({ STORAGE_PROVIDER: 'ftp' })).toThrow(/STORAGE_PROVIDER/)
    expect(() => parseEnv({ NEXT_PUBLIC_APP_URL: 'not a url' })).toThrow(/NEXT_PUBLIC_APP_URL/)
  })
})

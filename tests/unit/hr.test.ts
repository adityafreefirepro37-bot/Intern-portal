import { inAudience, isLive, canApply } from '@/lib/hr/announcements'
import {
  computeStatus,
  DEFAULT_ATTENDANCE_RULES,
  leaveDaySet,
  resolveDay,
  summarize,
  workedMinutes,
  breakTotal,
} from '@/lib/hr/attendance'
import {
  canDecide,
  decisionTarget,
  documentCompletion,
  effectiveDocumentStatus,
  isExpiringSoon,
} from '@/lib/hr/documents'
import { canCancelLeave, canReviewLeave, leaveBalance, rangesOverlap, workingDaysBetween } from '@/lib/hr/leave'
import { onboardingBucket, parseEndingWindow, safeCell, toCsv } from '@/lib/hr/operations'
import { isClosed, requesterCanCancel, staffTargets } from '@/lib/hr/requests'
import { clockIn, formatDuration, instantAt, minutesOfDay, monthRange, parseMonth } from '@/lib/hr/time'

const TZ = 'Asia/Kolkata'
const d = (value: string) => new Date(`${value}T00:00:00.000Z`)
const rules = { ...DEFAULT_ATTENDANCE_RULES, workStart: '10:00', graceMinutes: 15 }

describe('time helpers', () => {
  it('converts wall-clock times in the organization timezone', () => {
    const instant = instantAt(d('2026-09-28'), '10:00', TZ)
    expect(instant.toISOString()).toBe('2026-09-28T04:30:00.000Z')
    expect(minutesOfDay(instant, TZ)).toBe(600)
    expect(clockIn(instant, TZ)).toBe('10:00')
  })

  it('parses months and formats durations', () => {
    expect(parseMonth('2026-02')?.toISOString()).toBe('2026-02-01T00:00:00.000Z')
    expect(parseMonth('2026-13')).toBeNull()
    expect(parseMonth("2026-02' OR 1=1")).toBeNull()
    const [start, end] = monthRange(d('2028-02-10'))
    expect([start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)]).toEqual(['2028-02-01', '2028-02-29'])
    expect(formatDuration(445)).toBe('7h 25m')
    expect(formatDuration(null)).toBe('—')
  })
})

describe('attendance rules', () => {
  const day = d('2026-09-28') // Monday
  const at = (clock: string) => instantAt(day, clock, TZ)

  it('marks on-time full days PRESENT and late full days LATE', () => {
    const onTime = computeStatus({ checkIn: at('10:10'), checkOut: at('18:30'), breakMinutes: 45, rules, timeZone: TZ })
    expect(onTime).toMatchObject({ status: 'PRESENT', isLate: false, lateMinutes: null, totalMinutes: 455 })
    const late = computeStatus({ checkIn: at('10:40'), checkOut: at('18:30'), breakMinutes: 0, rules, timeZone: TZ })
    expect(late).toMatchObject({ status: 'LATE', isLate: true, lateMinutes: 40 })
  })

  it('uses worked minutes (breaks excluded) for half days and absences', () => {
    expect(
      computeStatus({ checkIn: at('10:00'), checkOut: at('14:00'), breakMinutes: 0, rules, timeZone: TZ }).status,
    ).toBe('HALF_DAY')
    expect(
      computeStatus({ checkIn: at('10:00'), checkOut: at('17:30'), breakMinutes: 60, rules, timeZone: TZ }).status,
    ).toBe('HALF_DAY')
    expect(
      computeStatus({ checkIn: at('10:00'), checkOut: at('11:00'), breakMinutes: 0, rules, timeZone: TZ }).status,
    ).toBe('ABSENT')
  })

  it('is provisional while checked in', () => {
    expect(computeStatus({ checkIn: at('10:20'), checkOut: null, breakMinutes: 0, rules, timeZone: TZ })).toMatchObject(
      {
        status: 'LATE',
        totalMinutes: null,
      },
    )
  })

  it('never produces negative worked time and counts open breaks up to now', () => {
    expect(workedMinutes(at('10:00'), at('10:30'), 90)).toBe(0)
    expect(breakTotal([{ started_at: at('13:00'), ended_at: null }], at('13:20'))).toBe(20)
  })

  it('derives absent and missing check-out only for days that have passed', () => {
    const base = { onLeave: false, holiday: false, rules }
    const today = d('2026-09-30')
    expect(resolveDay({ ...base, date: d('2026-09-29'), today, record: null })).toBe('ABSENT')
    expect(resolveDay({ ...base, date: today, today, record: null })).toBeNull()
    expect(resolveDay({ ...base, date: d('2026-10-01'), today, record: null })).toBeNull()
    const open = { status: 'PRESENT' as const, check_in_at: new Date(), check_out_at: null }
    expect(resolveDay({ ...base, date: d('2026-09-29'), today, record: open })).toBe('MISSING')
    expect(resolveDay({ ...base, date: today, today, record: open })).toBe('PRESENT')
  })

  it('prefers leave, holidays and weekends over absence, and ignores days outside the internship', () => {
    const today = d('2026-09-30')
    const base = { today, record: null, rules }
    expect(resolveDay({ ...base, date: d('2026-09-28'), onLeave: true, holiday: false })).toBe('ON_LEAVE')
    expect(resolveDay({ ...base, date: d('2026-09-28'), onLeave: false, holiday: true })).toBe('HOLIDAY')
    expect(resolveDay({ ...base, date: d('2026-09-27'), onLeave: false, holiday: false })).toBe('WEEKEND')
    expect(
      resolveDay({ ...base, date: d('2026-09-21'), onLeave: false, holiday: false, trackedFrom: d('2026-09-25') }),
    ).toBeNull()
  })

  it('summarizes a month with a rate over due working days only', () => {
    const summary = summarize([
      { date: d('2026-09-01'), status: 'PRESENT', totalMinutes: 420 },
      { date: d('2026-09-02'), status: 'LATE', totalMinutes: 400 },
      { date: d('2026-09-03'), status: 'HALF_DAY', totalMinutes: 220 },
      { date: d('2026-09-04'), status: 'ABSENT' },
      { date: d('2026-09-05'), status: 'WEEKEND' },
      { date: d('2026-09-07'), status: 'ON_LEAVE' },
      { date: d('2026-09-30'), status: null },
    ])
    expect(summary).toMatchObject({ present: 1, late: 1, halfDay: 1, absent: 1, onLeave: 1, workedMinutes: 1040 })
    expect(summary.attendanceRate).toBe(63) // (1 + 1 + 0.5) / 4
    expect(summarize([]).attendanceRate).toBeNull()
  })

  it('expands leave ranges to days', () => {
    expect([...leaveDaySet([{ start_date: d('2026-09-28'), end_date: d('2026-09-30') }])]).toEqual([
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
    ])
  })
})

describe('leave rules', () => {
  const options = { workingDays: [1, 2, 3, 4, 5], holidays: new Set(['2026-10-02']) }

  it('counts working days only (weekends and holidays excluded)', () => {
    expect(workingDaysBetween(d('2026-09-28'), d('2026-10-04'), options)).toBe(4) // Mon–Sun, Fri is a holiday
    expect(workingDaysBetween(d('2026-10-03'), d('2026-10-04'), options)).toBe(0)
    expect(workingDaysBetween(d('2026-10-05'), d('2026-10-01'), options)).toBe(0)
  })

  it('detects overlapping inclusive ranges', () => {
    expect(rangesOverlap(d('2026-10-01'), d('2026-10-03'), d('2026-10-03'), d('2026-10-05'))).toBe(true)
    expect(rangesOverlap(d('2026-10-01'), d('2026-10-02'), d('2026-10-03'), d('2026-10-05'))).toBe(false)
  })

  it('computes balances, with unlimited types tracked but uncapped', () => {
    expect(leaveBalance({ allocated: 6, used: 2, pending: 1 })).toEqual({
      allocated: 6,
      used: 2,
      pending: 1,
      remaining: 3,
      unlimited: false,
    })
    expect(leaveBalance({ allocated: 2, used: 3, pending: 0 }).remaining).toBe(0)
    expect(leaveBalance({ allocated: null, used: 4, pending: 0 })).toMatchObject({ remaining: null, unlimited: true })
  })

  it('lets requesters cancel pending or not-yet-started leave, and HR any active leave', () => {
    const today = d('2026-09-30')
    const base = { today, isRequester: true, canManage: false }
    expect(canCancelLeave({ ...base, status: 'PENDING', startDate: d('2026-09-01') })).toBe(true)
    expect(canCancelLeave({ ...base, status: 'APPROVED', startDate: d('2026-10-05') })).toBe(true)
    expect(canCancelLeave({ ...base, status: 'APPROVED', startDate: d('2026-09-30') })).toBe(false)
    expect(canCancelLeave({ ...base, status: 'REJECTED', startDate: d('2026-10-05') })).toBe(false)
    expect(
      canCancelLeave({ today, isRequester: false, canManage: true, status: 'APPROVED', startDate: d('2026-09-01') }),
    ).toBe(true)
    expect(
      canCancelLeave({ today, isRequester: false, canManage: false, status: 'PENDING', startDate: d('2026-10-05') }),
    ).toBe(false)
  })

  it('never lets anyone review their own request, and only pending ones', () => {
    expect(canReviewLeave({ status: 'PENDING', isRequester: true })).toBe(false)
    expect(canReviewLeave({ status: 'APPROVED', isRequester: false })).toBe(false)
    expect(canReviewLeave({ status: 'PENDING', isRequester: false })).toBe(true)
  })
})

describe('document rules', () => {
  it('allows only valid review decisions', () => {
    expect(canDecide('VERIFY', 'UPLOADED')).toBe(true)
    expect(canDecide('VERIFY', 'REJECTED')).toBe(false)
    expect(canDecide('START_REVIEW', 'UNDER_REVIEW')).toBe(false)
    expect(canDecide('REJECT', 'VERIFIED')).toBe(true)
    expect(canDecide('REQUEST_REPLACEMENT', 'EXPIRED')).toBe(true)
    expect(decisionTarget('REQUEST_REPLACEMENT')).toBe('REJECTED')
  })

  it('applies expiry and warns ahead of it', () => {
    const today = d('2026-09-30')
    expect(effectiveDocumentStatus('VERIFIED', d('2026-09-29'), today)).toBe('EXPIRED')
    expect(effectiveDocumentStatus('REJECTED', d('2026-09-29'), today)).toBe('REJECTED')
    expect(effectiveDocumentStatus('VERIFIED', d('2026-09-30'), today)).toBe('VERIFIED')
    expect(isExpiringSoon(d('2026-10-20'), today, 30)).toBe(true)
    expect(isExpiringSoon(d('2026-12-20'), today, 30)).toBe(false)
    expect(isExpiringSoon(d('2026-09-01'), today, 30)).toBe(false)
  })

  it('counts completion against required types, with only verified documents complete', () => {
    const current = new Map([
      ['offer', 'VERIFIED' as const],
      ['nda', 'UPLOADED' as const],
      ['id', 'REJECTED' as const],
    ])
    expect(documentCompletion(['offer', 'nda', 'id', 'noc'], current)).toEqual({
      required: 4,
      verified: 1,
      submitted: 1,
      missing: 1,
      rejected: 1,
      expired: 0,
      percent: 25,
      complete: false,
    })
    expect(documentCompletion([], new Map())).toMatchObject({ percent: 100, complete: true })
  })
})

describe('HR requests, announcements and operations', () => {
  it('limits request transitions', () => {
    expect(staffTargets('OPEN')).toContain('IN_REVIEW')
    expect(staffTargets('CANCELLED')).toEqual([])
    expect(requesterCanCancel('WAITING_FOR_USER')).toBe(true)
    expect(requesterCanCancel('RESOLVED')).toBe(false)
    expect(isClosed('REJECTED')).toBe(true)
  })

  it('targets announcements by relationship facts, not role names', () => {
    const viewer = {
      userId: 'u1',
      isIntern: true,
      managesInterns: false,
      mentorsInterns: false,
      departmentIds: ['dep-marketing'],
      teamIds: ['team-social'],
    }
    expect(inAudience({ audience: 'EVERYONE', audience_ids: [] }, viewer)).toBe(true)
    expect(inAudience({ audience: 'INTERNS', audience_ids: [] }, viewer)).toBe(true)
    expect(inAudience({ audience: 'MANAGERS', audience_ids: [] }, viewer)).toBe(false)
    expect(inAudience({ audience: 'DEPARTMENT', audience_ids: ['dep-marketing'] }, viewer)).toBe(true)
    expect(inAudience({ audience: 'DEPARTMENT', audience_ids: ['dep-design'] }, viewer)).toBe(false)
    expect(inAudience({ audience: 'TEAM', audience_ids: ['team-social'] }, viewer)).toBe(true)
    expect(inAudience({ audience: 'SPECIFIC', audience_ids: ['u2'] }, viewer)).toBe(false)
  })

  it('treats due scheduled announcements as live and respects expiry', () => {
    const now = new Date('2026-09-30T06:00:00Z')
    expect(isLive({ status: 'SCHEDULED', published_at: new Date('2026-09-30T05:00:00Z'), expires_at: null }, now)).toBe(
      true,
    )
    expect(isLive({ status: 'SCHEDULED', published_at: new Date('2026-10-01T05:00:00Z'), expires_at: null }, now)).toBe(
      false,
    )
    expect(isLive({ status: 'PUBLISHED', published_at: now, expires_at: new Date('2026-09-30T05:59:00Z') }, now)).toBe(
      false,
    )
    expect(isLive({ status: 'DRAFT', published_at: null, expires_at: null }, now)).toBe(false)
    expect(canApply('PUBLISH', 'ARCHIVED')).toBe(false)
    expect(canApply('UNARCHIVE', 'ARCHIVED')).toBe(true)
  })

  it('buckets onboarding progress', () => {
    const p = (requiredDone: number, requiredTotal: number, overdue = 0) => ({
      requiredDone,
      requiredTotal,
      overdue,
      percent: Math.round((requiredDone / requiredTotal) * 100),
    })
    expect(onboardingBucket(p(0, 5), false)).toBe('NOT_STARTED')
    expect(onboardingBucket(p(2, 5), false)).toBe('IN_PROGRESS')
    expect(onboardingBucket(p(4, 5), false)).toBe('NEARLY_COMPLETE')
    expect(onboardingBucket(p(4, 5, 1), false)).toBe('OVERDUE')
    expect(onboardingBucket(p(5, 5), false)).toBe('COMPLETE')
    expect(onboardingBucket(p(1, 5), true)).toBe('COMPLETE')
  })

  it('only accepts the supported ending-soon windows', () => {
    expect(parseEndingWindow('7')).toBe(7)
    expect(parseEndingWindow('13')).toBe(30)
    expect(parseEndingWindow(undefined, 14)).toBe(14)
  })

  it('neutralizes spreadsheet formulas and escapes CSV', () => {
    expect(safeCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`)
    expect(safeCell('+91 90000')).toBe("'+91 90000")
    expect(safeCell('-5')).toBe("'-5")
    expect(safeCell('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(safeCell('a,b')).toBe('"a,b"')
    expect(safeCell(null)).toBe('')
    expect(toCsv(['A', 'B'], [[1, 'x']])).toBe('﻿A,B\r\n1,x\r\n')
  })
})

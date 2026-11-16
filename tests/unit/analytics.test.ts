import { csvCell, fillMonths, monthKeys, monthLabel, parsePeriod, rate, toCsv } from '@/lib/analytics/series'

describe('analytics series helpers', () => {
  it('lists the last N months, oldest first, across a year boundary', () => {
    expect(monthKeys(new Date('2026-02-10T00:00:00Z'), 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
    expect(monthLabel('2026-02')).toBe('Feb')
    expect(monthLabel('2026-02', true)).toBe('Feb 2026')
  })

  it('fills missing months with zero and computes rates', () => {
    expect(fillMonths(['2026-01', '2026-02', '2026-03'], [{ month: '2026-02', n: 5 }], (r) => r.n)).toEqual([0, 5, 0])
    expect(rate(1, 3)).toBe(33)
    expect(rate(0, 0)).toBeNull()
    expect(parsePeriod('12')).toBe(12)
    expect(parsePeriod('7')).toBe(6)
    expect(parsePeriod(undefined)).toBe(6)
  })

  it('writes safe CSV', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell(-3)).toBe('-3')
    expect(csvCell(null)).toBe('')
    expect(toCsv([['Month', 'n'], ['2026-01', 2]])).toBe('Month,n\r\n2026-01,2\r\n')
  })
})

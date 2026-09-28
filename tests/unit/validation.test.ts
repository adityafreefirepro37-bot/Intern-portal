import { ValidationError } from '@/lib/errors'
import {
  dateRangeSchema,
  emailSchema,
  idSchema,
  nameSchema,
  paginationSchema,
  parseInput,
  searchQuerySchema,
  slugSchema,
} from '@/lib/validation'
import { readListParams } from '@/lib/validation/list-params'

describe('shared schemas', () => {
  it('normalizes and validates email', () => {
    expect(emailSchema.parse('  Admin@AyavaCreatives.com ')).toBe('admin@ayavacreatives.com')
    expect(emailSchema.safeParse('not-an-email').success).toBe(false)
  })

  it('validates names', () => {
    expect(nameSchema.safeParse('Aanya').success).toBe(true)
    expect(nameSchema.safeParse('A').success).toBe(false)
    expect(nameSchema.safeParse('x'.repeat(101)).success).toBe(false)
  })

  it('validates UUIDs and slugs', () => {
    expect(idSchema.safeParse('6f1d3b52-8a4e-4c1f-9b2d-3e7a5c9d0a11').success).toBe(true)
    expect(idSchema.safeParse('1; DROP TABLE users').success).toBe(false)
    expect(slugSchema.safeParse('web-squad').success).toBe(true)
    expect(slugSchema.safeParse('Web Squad').success).toBe(false)
    expect(slugSchema.safeParse('web--squad').success).toBe(false)
  })

  it('applies pagination defaults and limits', () => {
    expect(paginationSchema.parse({})).toEqual({ page: 1, pageSize: 20 })
    expect(paginationSchema.parse({ page: '3', pageSize: '10' })).toEqual({ page: 3, pageSize: 10 })
    expect(paginationSchema.safeParse({ pageSize: '1000' }).success).toBe(false)
    expect(paginationSchema.safeParse({ page: '0' }).success).toBe(false)
  })

  it('requires search terms of at least two characters', () => {
    expect(searchQuerySchema.safeParse({ q: 'a' }).success).toBe(false)
    expect(searchQuerySchema.parse({ q: '  web ' })).toEqual({ q: 'web', limit: 5 })
  })

  it('rejects inverted date ranges', () => {
    expect(dateRangeSchema.safeParse({ from: '2026-01-10', to: '2026-01-01' }).success).toBe(false)
    expect(dateRangeSchema.safeParse({ from: '2026-01-01', to: '2026-01-01' }).success).toBe(true)
  })
})

describe('parseInput', () => {
  it('returns parsed data', () => {
    expect(parseInput(nameSchema, ' Kavya ')).toBe('Kavya')
  })

  it('throws a ValidationError with field messages', () => {
    const schema = paginationSchema.extend({ email: emailSchema })
    try {
      parseInput(schema, { email: 'nope', page: '-1' })
      throw new Error('expected to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError)
      const fields = (error as ValidationError).fields ?? {}
      expect(Object.keys(fields).sort()).toEqual(['email', 'page'])
    }
  })
})

describe('readListParams', () => {
  const statuses = ['ACTIVE', 'COMPLETED'] as const

  it('falls back to defaults for invalid URL values', () => {
    const result = readListParams({ page: 'abc', status: 'HACKED', highlight: 'x' }, { statuses })
    expect(result.pagination).toEqual({ page: 1, pageSize: 20 })
    expect(result.status).toBeUndefined()
    expect(result.highlight).toBeUndefined()
  })

  it('accepts valid values and uses the first of repeated params', () => {
    const result = readListParams({ page: ['2', '9'], status: 'ACTIVE' }, { statuses, pageSize: 12 })
    expect(result.pagination).toEqual({ page: 2, pageSize: 12 })
    expect(result.status).toBe('ACTIVE')
    expect(result.raw).toEqual({ status: 'ACTIVE', page: '2' })
  })
})

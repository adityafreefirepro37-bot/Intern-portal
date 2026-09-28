import { z } from 'zod'
import { AppError, ForbiddenError, NotFoundError, ValidationError, toErrorBody } from '@/lib/errors'
import { failure, success } from '@/lib/http/response'

describe('toErrorBody', () => {
  it('maps application errors to their status and code', () => {
    expect(toErrorBody(new ForbiddenError())).toEqual({
      status: 403,
      body: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action' },
    })
    expect(toErrorBody(new NotFoundError('Project')).body.message).toBe('Project not found')
  })

  it('includes field errors for validation failures', () => {
    const { status, body } = toErrorBody(new ValidationError('Invalid input', { email: 'Required' }))
    expect(status).toBe(422)
    expect(body).toEqual({ code: 'VALIDATION_ERROR', message: 'Invalid input', fields: { email: 'Required' } })
  })

  it('converts ZodErrors into the validation envelope', () => {
    const result = z.object({ name: z.string().min(2) }).safeParse({ name: 'x' })
    expect(result.success).toBe(false)
    if (!result.success) {
      const { status, body } = toErrorBody(result.error)
      expect(status).toBe(422)
      expect(body.fields).toHaveProperty('name')
    }
  })

  it('never exposes unexpected error details', () => {
    const leaky = new Error('relation "users" does not exist at postgresql://admin:secret@db')
    const { status, body } = toErrorBody(leaky)
    expect(status).toBe(500)
    expect(body.code).toBe('INTERNAL_ERROR')
    expect(JSON.stringify(body)).not.toContain('secret')
    expect(JSON.stringify(body)).not.toContain('relation')
  })

  it('hides the message of INTERNAL_ERROR AppErrors', () => {
    const { body } = toErrorBody(new AppError('INTERNAL_ERROR', 'Supabase key invalid'))
    expect(body.message).not.toContain('Supabase')
  })
})

describe('API envelope', () => {
  const originalError = console.error
  beforeEach(() => {
    console.error = jest.fn()
  })
  afterEach(() => {
    console.error = originalError
  })

  it('wraps data in a success envelope', () => {
    expect(success({ id: 1 })).toEqual({ success: true, data: { id: 1 } })
    expect(success([], { total: 0 })).toEqual({ success: true, data: [], meta: { total: 0 } })
  })

  it('produces the documented failure shape', () => {
    const { status, result } = failure(new ValidationError('Invalid input', { q: 'Too short' }))
    expect(status).toBe(422)
    expect(result).toEqual({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid input', fields: { q: 'Too short' } },
    })
  })

  it('logs server errors without leaking them to the client', () => {
    const { status, result } = failure(new Error('boom'))
    expect(status).toBe(500)
    expect(result.error.message).not.toContain('boom')
    expect(console.error).toHaveBeenCalled()
  })
})

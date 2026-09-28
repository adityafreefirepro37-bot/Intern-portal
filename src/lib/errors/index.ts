import { ZodError } from 'zod'

/**
 * Application error model. Services throw AppError subclasses; route handlers
 * and server actions convert them into the standard error envelope. Anything
 * that is not an AppError is treated as INTERNAL_ERROR and its details are
 * never shown to users.
 */

export const ERROR_CODES = {
  VALIDATION_ERROR: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  NOT_IMPLEMENTED: 501,
  INTERNAL_ERROR: 500,
} as const

export type ErrorCode = keyof typeof ERROR_CODES

export type FieldErrors = Record<string, string>

export class AppError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly fields?: FieldErrors
  /** Only messages of expose=true errors are shown to users. */
  readonly expose: boolean

  constructor(code: ErrorCode, message: string, options: { fields?: FieldErrors; cause?: unknown } = {}) {
    super(message, { cause: options.cause })
    this.name = 'AppError'
    this.code = code
    this.status = ERROR_CODES[code]
    this.fields = options.fields
    this.expose = code !== 'INTERNAL_ERROR'
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Invalid input', fields: FieldErrors = {}) {
    super('VALIDATION_ERROR', message, { fields })
    this.name = 'ValidationError'
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'Authentication required') {
    super('UNAUTHENTICATED', message)
    this.name = 'UnauthenticatedError'
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action') {
    super('FORBIDDEN', message)
    this.name = 'ForbiddenError'
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super('NOT_FOUND', `${resource} not found`)
    this.name = 'NotFoundError'
  }
}

export class ConflictError extends AppError {
  constructor(message = 'The resource already exists') {
    super('CONFLICT', message)
    this.name = 'ConflictError'
  }
}

/** Flattens a ZodError into `{ "path.to.field": "message" }`. */
export function zodFieldErrors(error: ZodError): FieldErrors {
  const fields: FieldErrors = {}
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join('.') : '_root'
    fields[key] ??= issue.message
  }
  return fields
}

export interface ErrorBody {
  code: ErrorCode
  message: string
  fields?: FieldErrors
}

/** Converts any thrown value into a safe, user-facing error body. */
export function toErrorBody(error: unknown): { status: number; body: ErrorBody } {
  if (error instanceof ZodError) {
    return {
      status: ERROR_CODES.VALIDATION_ERROR,
      body: { code: 'VALIDATION_ERROR', message: 'Invalid input', fields: zodFieldErrors(error) },
    }
  }
  if (error instanceof AppError && error.expose) {
    return {
      status: error.status,
      body: { code: error.code, message: error.message, ...(error.fields ? { fields: error.fields } : {}) },
    }
  }
  return {
    status: ERROR_CODES.INTERNAL_ERROR,
    body: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred. Please try again.' },
  }
}

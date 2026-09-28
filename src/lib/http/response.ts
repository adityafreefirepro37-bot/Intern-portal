import { NextResponse } from 'next/server'
import { toErrorBody, type ErrorBody } from '@/lib/errors'
import { logger } from '@/lib/logging'

/**
 * Standard API envelope used by every route handler and server action:
 *
 *   { success: true,  data: T, meta?: {...} }
 *   { success: false, error: { code, message, fields? } }
 */
export type ApiSuccess<T> = { success: true; data: T; meta?: Record<string, unknown> }
export type ApiFailure = { success: false; error: ErrorBody }
export type ApiResult<T> = ApiSuccess<T> | ApiFailure

export function success<T>(data: T, meta?: Record<string, unknown>): ApiSuccess<T> {
  return meta ? { success: true, data, meta } : { success: true, data }
}

export function failure(error: unknown, context?: Record<string, unknown>): { status: number; result: ApiFailure } {
  const { status, body } = toErrorBody(error)
  if (status >= 500) {
    logger.error('Unhandled error', { ...context, error })
  }
  return { status, result: { success: false, error: body } }
}

export function jsonSuccess<T>(data: T, init?: { status?: number; meta?: Record<string, unknown> }) {
  return NextResponse.json(success(data, init?.meta), { status: init?.status ?? 200 })
}

export function jsonError(error: unknown, context?: Record<string, unknown>) {
  const { status, result } = failure(error, context)
  const response = NextResponse.json(result, { status })
  if (result.error.code === 'RATE_LIMITED') response.headers.set('Retry-After', '60')
  return response
}

/**
 * Wraps a route handler so any thrown error becomes a safe error envelope.
 */
export function withErrorHandling<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
  context?: Record<string, unknown>,
) {
  return async (...args: Args): Promise<Response> => {
    try {
      return await handler(...args)
    } catch (error) {
      return jsonError(error, context)
    }
  }
}

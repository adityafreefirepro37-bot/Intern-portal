import { z } from 'zod'
import { paginationSchema, type Pagination } from './index'

type RawParams = Record<string, string | string[] | undefined>

/** First value of a search param (Next passes arrays for repeated keys). */
export function firstParam(params: RawParams, key: string): string | undefined {
  const value = params[key]
  return Array.isArray(value) ? value[0] : value
}

/**
 * Parses list-page URL params. Invalid values fall back to defaults rather
 * than erroring, because they come from user-editable URLs.
 */
export function readListParams<const S extends readonly [string, ...string[]]>(
  params: RawParams,
  options: { statuses?: S; pageSize?: number } = {},
): { pagination: Pagination; status?: S[number]; highlight?: string; raw: Record<string, string | undefined> } {
  const parsed = paginationSchema.safeParse({
    page: firstParam(params, 'page'),
    pageSize: options.pageSize ?? firstParam(params, 'pageSize'),
  })
  const pagination = parsed.success ? parsed.data : { page: 1, pageSize: options.pageSize ?? 20 }

  let status: S[number] | undefined
  if (options.statuses) {
    const result = z.enum(options.statuses).safeParse(firstParam(params, 'status'))
    status = result.success ? result.data : undefined
  }

  const highlightResult = z.uuid().safeParse(firstParam(params, 'highlight'))

  return {
    pagination,
    status,
    highlight: highlightResult.success ? highlightResult.data : undefined,
    raw: { status: status ?? undefined, page: pagination.page > 1 ? String(pagination.page) : undefined },
  }
}

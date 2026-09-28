import { z } from 'zod'
import { ValidationError, zodFieldErrors } from '@/lib/errors'

/**
 * Shared Zod schemas. Every value that crosses a trust boundary (form data,
 * query strings, route params, JSON bodies, client-provided IDs) is parsed
 * with one of these — or a feature schema built from them — before use.
 */

export const idSchema = z.uuid({ message: 'Invalid ID format' })

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: 'Invalid email address' }).max(254))

export const nameSchema = z
  .string()
  .trim()
  .min(2, 'Name must be at least 2 characters')
  .max(100, 'Name must be at most 100 characters')

export const slugSchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and single hyphens')

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().max(10_000).default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
})

export type Pagination = z.infer<typeof paginationSchema>

export const searchQuerySchema = z.object({
  q: z.string().trim().min(2, 'Search at least 2 characters').max(100),
  limit: z.coerce.number().int().min(1).max(10).default(5),
})

export const isoDateSchema = z.iso.date({ message: 'Use the format YYYY-MM-DD' })

export const dateRangeSchema = z
  .object({ from: isoDateSchema, to: isoDateSchema })
  .refine((range) => range.to >= range.from, { message: 'End date must be on or after start date', path: ['to'] })

/**
 * Parses untrusted input, throwing a ValidationError (→ 422 envelope) with
 * per-field messages on failure.
 */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input)
  if (!result.success) {
    throw new ValidationError('Invalid input', zodFieldErrors(result.error))
  }
  return result.data
}

/** Reads URLSearchParams into a plain object suitable for parseInput. */
export function searchParamsToObject(params: URLSearchParams): Record<string, string> {
  const output: Record<string, string> = {}
  params.forEach((value, key) => {
    output[key] = value
  })
  return output
}

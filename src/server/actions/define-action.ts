import 'server-only'
import type { z } from 'zod'
import { failure, success, type ApiResult } from '@/lib/http/response'
import type { PermissionKey } from '@/lib/permissions'
import { parseInput } from '@/lib/validation'
import { requireApiContext, type RequestContext } from '../context'
import { authorizationService } from '../services/authorization.service'

/**
 * Standard pipeline for server actions:
 *
 *   input → validate (Zod) → resolve context (auth) → check permission →
 *   service call → { success, data } | { success: false, error }
 *
 * Usage (in a 'use server' module):
 *
 *   export const createProject = defineAction({
 *     schema: createProjectSchema,
 *     permission: 'project.create',
 *     handler: (ctx, input) => projectService.create(ctx, input),
 *   })
 *
 * Next.js already rejects cross-origin server action calls; this adds input
 * validation, authorization and a consistent, non-leaky error envelope.
 */
export function defineAction<S extends z.ZodType, R>(definition: {
  schema: S
  permission: PermissionKey
  handler: (ctx: RequestContext, input: z.infer<S>) => Promise<R>
}) {
  return async (rawInput: unknown): Promise<ApiResult<R>> => {
    try {
      const input = parseInput(
        definition.schema,
        rawInput instanceof FormData ? Object.fromEntries(rawInput) : rawInput,
      )
      const ctx = await requireApiContext()
      authorizationService.require(ctx, definition.permission)
      return success(await definition.handler(ctx, input))
    } catch (error) {
      return failure(error, { permission: definition.permission }).result
    }
  }
}

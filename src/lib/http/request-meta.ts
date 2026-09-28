import 'server-only'
import { headers } from 'next/headers'

export interface RequestMeta {
  ipAddress: string | null
  userAgent: string | null
}

/**
 * Client IP and user agent for audit logs, session records and rate limits.
 * The IP comes from the first X-Forwarded-For hop, which is only trustworthy
 * behind a proxy that sets it (Vercel, a load balancer). Values are length-
 * limited and validated so they cannot be used to inject log content.
 */
export async function getRequestMeta(): Promise<RequestMeta> {
  const list = await headers()
  const forwarded = list.get('x-forwarded-for')?.split(',')[0]?.trim()
  const candidate = forwarded || list.get('x-real-ip')?.trim() || null
  const ipAddress = candidate && /^[0-9a-fA-F:.]{2,45}$/.test(candidate) ? candidate : null
  const userAgent = list.get('user-agent')?.slice(0, 512) ?? null
  return { ipAddress, userAgent }
}

/** "Chrome on Windows"-style label from a user-agent string (best effort). */
export function describeUserAgent(userAgent: string | null | undefined): string {
  if (!userAgent) return 'Unknown device'
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /OPR\//.test(userAgent)
      ? 'Opera'
      : /Firefox\//.test(userAgent)
        ? 'Firefox'
        : /Chrome\//.test(userAgent)
          ? 'Chrome'
          : /Safari\//.test(userAgent)
            ? 'Safari'
            : 'Browser'
  const os = /Windows/.test(userAgent)
    ? 'Windows'
    : /Android/.test(userAgent)
      ? 'Android'
      : /iPhone|iPad|iPod/.test(userAgent)
        ? 'iOS'
        : /Mac OS X/.test(userAgent)
          ? 'macOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : 'unknown OS'
  return `${browser} on ${os}`
}

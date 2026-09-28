/**
 * Open-redirect protection: only same-site relative paths are allowed as
 * post-login destinations. Anything else falls back to the overview.
 */
export function safeNextPath(next: unknown, fallback = '/'): string {
  if (typeof next !== 'string' || next.length === 0 || next.length > 512) return fallback
  // Must be a path on this site: "/x" but not "//evil.com", "/\evil.com" or "https://…".
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback
  if (/[\u0000-\u001f\u007f]/.test(next)) return fallback
  try {
    const url = new URL(next, 'http://internal.invalid')
    if (url.origin !== 'http://internal.invalid') return fallback
    const path = url.pathname + url.search
    // Never bounce back into auth pages after signing in.
    if (/^\/(login|forgot-password|reset-password|auth\/)/.test(url.pathname)) return fallback
    return path
  } catch {
    return fallback
  }
}

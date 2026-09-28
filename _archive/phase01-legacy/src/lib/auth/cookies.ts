export const SESSION_COOKIE = 'ayava_session'
export const CSRF_COOKIE = 'ayava_csrf'

export function sessionCookieOptions(maxAgeSeconds: number) {
  const isProd = process.env.NODE_ENV === 'production'
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeSeconds,
  }
}

export function csrfCookieOptions() {
  const isProd = process.env.NODE_ENV === 'production'
  return {
    httpOnly: false,
    secure: isProd,
    sameSite: 'lax' as const,
    path: '/',
  }
}

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export function isMutatingMethod(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase())
}

export function originAllowed(requestOrigin: string | null, appUrl: string): boolean {
  if (!requestOrigin) return false
  try {
    const expected = new URL(appUrl).origin
    return requestOrigin === expected
  } catch {
    return false
  }
}

export function verifyCsrf(input: {
  method: string
  origin: string | null
  referer: string | null
  csrfHeader: string | null
  csrfCookie: string | null
  appUrl: string
}): { valid: boolean; reason?: string } {
  if (!isMutatingMethod(input.method)) {
    return { valid: true }
  }

  const origin = input.origin ?? (input.referer ? originFromReferer(input.referer) : null)
  if (!originAllowed(origin, input.appUrl)) {
    return { valid: false, reason: 'Invalid origin' }
  }

  if (!input.csrfCookie || !input.csrfHeader || input.csrfCookie !== input.csrfHeader) {
    return { valid: false, reason: 'Invalid CSRF token' }
  }

  return { valid: true }
}

function originFromReferer(referer: string): string | null {
  try {
    return new URL(referer).origin
  } catch {
    return null
  }
}

/**
 * Content Security Policy with a per-request nonce.
 *
 * Scripts: only this origin's scripts carrying the request's nonce (Next.js
 * applies it to its own scripts automatically); 'strict-dynamic' lets those
 * load their chunks. No 'unsafe-inline' for scripts, so injected markup cannot
 * run JavaScript. 'unsafe-eval' is development-only (React debugging).
 *
 * Styles keep 'unsafe-inline': React `style` attributes and UI primitives rely
 * on it, and style injection carries far less risk than script injection.
 */
export function buildContentSecurityPolicy(options: {
  nonce: string
  isDev: boolean
  supabaseOrigin?: string
}): string {
  const { nonce, isDev, supabaseOrigin } = options
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${supabaseOrigin ? ` ${supabaseOrigin}` : ''}${isDev ? ' ws: wss:' : ''}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    ...(isDev ? [] : ['upgrade-insecure-requests']),
  ].join('; ')
}

export function generateNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

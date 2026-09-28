import type { NextConfig } from 'next'
import path from 'node:path'

const isDev = process.env.NODE_ENV !== 'production'
/**
 * Static security headers. The Content-Security-Policy is set per request by
 * src/proxy.ts because it carries a fresh nonce for every response.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ...(isDev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]),
]

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The floating dev indicator covers shell controls in every corner (sidebar
  // collapse, mobile "More", account menu). Compile/runtime errors still show.
  devIndicators: false,
  // Pin the workspace root: a package-lock.json higher up the tree (e.g. in the
  // user's home folder) would otherwise be mistaken for the project root.
  turbopack: { root: path.join(__dirname) },
  reactStrictMode: true,
  // Prisma's engine must not be bundled into server chunks.
  serverExternalPackages: ['@prisma/client', 'prisma'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

export default nextConfig

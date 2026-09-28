#!/usr/bin/env node
/**
 * Mock Supabase Auth (GoTrue) server — END-TO-END TESTS ONLY.
 *
 * Implements the handful of Auth endpoints the application and the seed use,
 * so the signed-in Playwright suites can run on a machine without a Supabase
 * project (CI containers, sandboxes). The application code is unchanged: it
 * talks to this server exactly as it would to Supabase, through SUPABASE_URL.
 *
 *   node tests/e2e/mock-auth/server.mjs     (or: npm run test:e2e:local)
 *
 * Users persist to .local/mock-auth/users.json so the seed (which links
 * accounts) and the test run can use separate processes. Sessions live in
 * memory. Access tokens are HS256 JWTs: auth-js verifies those by calling
 * GET /auth/v1/user, which checks the session here.
 *
 * Never point a deployed application at this server.
 */
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'

if (process.env.NODE_ENV === 'production') {
  console.error('The mock auth server is a test tool and refuses to run with NODE_ENV=production.')
  process.exit(1)
}

const PORT = Number(process.env.MOCK_AUTH_PORT ?? 54329)
const SERVICE_KEY = process.env.MOCK_AUTH_SERVICE_KEY ?? 'mock-service-role-key'
const STATE_FILE = path.resolve('.local', 'mock-auth', 'users.json')
const SIGNING_SECRET = randomBytes(32)
const ACCESS_TTL_SECONDS = 3600

/** @type {Record<string, {id: string, email: string, password: string, confirmedAt: string | null, bannedUntil: string | null, createdAt: string}>} */
let users = {}
try {
  users = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
} catch {
  users = {}
}
function save() {
  mkdirSync(path.dirname(STATE_FILE), { recursive: true })
  writeFileSync(STATE_FILE, JSON.stringify(users, null, 2))
}

/** access token → session; refresh token → session id */
const sessions = new Map()
const refreshTokens = new Map()
/** hashed one-time link token → { email, type } */
const links = new Map()

const b64url = (value) => Buffer.from(value).toString('base64url')

function toUser(record) {
  const now = new Date().toISOString()
  return {
    id: record.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: record.email,
    phone: '',
    email_confirmed_at: record.confirmedAt,
    confirmed_at: record.confirmedAt,
    last_sign_in_at: now,
    banned_until: record.bannedUntil,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { email: record.email, email_verified: Boolean(record.confirmedAt) },
    identities: [
      {
        id: record.id,
        user_id: record.id,
        identity_id: record.id,
        provider: 'email',
        identity_data: { email: record.email, sub: record.id },
        created_at: record.createdAt,
        updated_at: now,
      },
    ],
    created_at: record.createdAt,
    updated_at: now,
  }
}

function issueSession(record, sessionId = randomUUID()) {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64url(
    JSON.stringify({
      sub: record.id,
      aud: 'authenticated',
      role: 'authenticated',
      email: record.email,
      session_id: sessionId,
      iat: now,
      exp: now + ACCESS_TTL_SECONDS,
      jti: randomUUID(),
      user_metadata: { email: record.email, email_verified: Boolean(record.confirmedAt) },
      app_metadata: { provider: 'email', providers: ['email'] },
    }),
  )
  const signature = createHmac('sha256', SIGNING_SECRET).update(`${header}.${payload}`).digest('base64url')
  const accessToken = `${header}.${payload}.${signature}`
  const refreshToken = randomBytes(24).toString('base64url')
  sessions.set(accessToken, { userId: record.id, sessionId, exp: now + ACCESS_TTL_SECONDS })
  refreshTokens.set(refreshToken, { userId: record.id, sessionId })
  return {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: ACCESS_TTL_SECONDS,
    expires_at: now + ACCESS_TTL_SECONDS,
    refresh_token: refreshToken,
    user: toUser(record),
  }
}

function endSessions(predicate) {
  for (const [token, session] of sessions) if (predicate(session)) sessions.delete(token)
  for (const [token, session] of refreshTokens) if (predicate(session)) refreshTokens.delete(token)
}

const findByEmail = (email) => users[String(email ?? '').toLowerCase()]
const findById = (id) => Object.values(users).find((user) => user.id === id)
const isBanned = (record) => Boolean(record.bannedUntil && new Date(record.bannedUntil) > new Date())

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(body === undefined ? '' : JSON.stringify(body))
}
const fail = (res, status, code, msg) => send(res, status, { code: status, error_code: code, msg })

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}

function bearer(req) {
  const header = req.headers.authorization ?? ''
  return header.startsWith('Bearer ') ? header.slice(7) : null
}

function currentSession(req) {
  const token = bearer(req)
  const session = token ? sessions.get(token) : null
  if (!session || session.exp < Date.now() / 1000) return null
  const record = findById(session.userId)
  return record && !isBanned(record) ? { token, session, record } : null
}

const isAdmin = (req) => bearer(req) === SERVICE_KEY || req.headers.apikey === SERVICE_KEY

function createUser({ email, password, confirmed }) {
  const key = String(email).toLowerCase()
  const record = {
    // Stable per email, so re-seeding after a restart links the same id.
    id: uuidFrom(key),
    email: key,
    password: String(password ?? ''),
    confirmedAt: confirmed ? new Date().toISOString() : null,
    bannedUntil: null,
    createdAt: new Date().toISOString(),
  }
  users[key] = record
  save()
  return record
}

function uuidFrom(value) {
  const hex = createHash('sha1').update(`mock-auth:${value}`).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function applyAdminUpdate(record, body) {
  if (typeof body.password === 'string') record.password = body.password
  if (body.email_confirm === true && !record.confirmedAt) record.confirmedAt = new Date().toISOString()
  if (typeof body.ban_duration === 'string') {
    if (body.ban_duration === 'none') record.bannedUntil = null
    else {
      const hours = Number.parseInt(body.ban_duration, 10) || 876000
      record.bannedUntil = new Date(Date.now() + hours * 3_600_000).toISOString()
      endSessions((session) => session.userId === record.id)
    }
  }
  save()
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
  const route = `${req.method} ${url.pathname}`
  const body = req.method === 'GET' ? {} : await readBody(req)

  try {
    if (route === 'GET /health') return send(res, 200, { ok: true })

    // ── Sign-in and token refresh ──
    if (route === 'POST /auth/v1/token') {
      const grant = url.searchParams.get('grant_type')
      if (grant === 'password') {
        const record = findByEmail(body.email)
        if (!record || record.password !== body.password) return fail(res, 400, 'invalid_credentials', 'Invalid login credentials')
        if (isBanned(record)) return fail(res, 400, 'user_banned', 'User is banned')
        if (!record.confirmedAt) return fail(res, 400, 'email_not_confirmed', 'Email not confirmed')
        return send(res, 200, issueSession(record))
      }
      if (grant === 'refresh_token') {
        const entry = refreshTokens.get(body.refresh_token)
        const record = entry && findById(entry.userId)
        if (!entry || !record || isBanned(record)) return fail(res, 400, 'refresh_token_not_found', 'Invalid Refresh Token')
        refreshTokens.delete(body.refresh_token)
        return send(res, 200, issueSession(record, entry.sessionId))
      }
      return fail(res, 400, 'unsupported_grant_type', 'Unsupported grant type')
    }

    if (route === 'GET /auth/v1/user') {
      const current = currentSession(req)
      if (!current) return fail(res, 403, 'session_not_found', 'Session from session_id claim in JWT does not exist')
      return send(res, 200, toUser(current.record))
    }

    if (route === 'PUT /auth/v1/user') {
      const current = currentSession(req)
      if (!current) return fail(res, 401, 'no_authorization', 'This endpoint requires a valid Bearer token')
      if (typeof body.password === 'string') {
        if (body.password === current.record.password) return fail(res, 422, 'same_password', 'New password should be different')
        current.record.password = body.password
        save()
      }
      return send(res, 200, toUser(current.record))
    }

    if (route === 'POST /auth/v1/logout') {
      const current = currentSession(req)
      if (current) {
        const scope = url.searchParams.get('scope') ?? 'global'
        const { userId, sessionId } = current.session
        if (scope === 'local') endSessions((s) => s.sessionId === sessionId)
        else if (scope === 'others') endSessions((s) => s.userId === userId && s.sessionId !== sessionId)
        else endSessions((s) => s.userId === userId)
      }
      return send(res, 204)
    }

    // ── Sign-up (invitation acceptance), recovery and verification ──
    if (route === 'POST /auth/v1/signup') {
      if (findByEmail(body.email)) return fail(res, 422, 'user_already_exists', 'User already registered')
      if (String(body.password ?? '').length < 6) return fail(res, 422, 'weak_password', 'Password is too weak')
      const record = createUser({ email: body.email, password: body.password, confirmed: true })
      return send(res, 200, issueSession(record))
    }

    if (route === 'POST /auth/v1/recover' || route === 'POST /auth/v1/resend') return send(res, 200, {})

    if (route === 'POST /auth/v1/verify') {
      const link = links.get(body.token_hash)
      const record = link && findByEmail(link.email)
      if (!link || !record) return fail(res, 403, 'otp_expired', 'Email link is invalid or has expired')
      links.delete(body.token_hash)
      if (!record.confirmedAt) {
        record.confirmedAt = new Date().toISOString()
        save()
      }
      return send(res, 200, issueSession(record))
    }

    // ── Admin API (service role) ──
    if (url.pathname.startsWith('/auth/v1/admin/')) {
      if (!isAdmin(req)) return fail(res, 401, 'not_admin', 'User not allowed')

      if (route === 'GET /auth/v1/admin/users') {
        const list = Object.values(users).map(toUser)
        res.setHeader('x-total-count', String(list.length))
        return send(res, 200, { users: list, aud: 'authenticated' })
      }
      if (route === 'POST /auth/v1/admin/users') {
        if (findByEmail(body.email)) return fail(res, 422, 'email_exists', 'A user with this email address has already been registered')
        return send(res, 200, toUser(createUser({ email: body.email, password: body.password, confirmed: body.email_confirm === true })))
      }
      const match = url.pathname.match(/^\/auth\/v1\/admin\/users\/([0-9a-f-]{36})$/)
      if (match && req.method === 'PUT') {
        const record = findById(match[1])
        if (!record) return fail(res, 404, 'user_not_found', 'User not found')
        applyAdminUpdate(record, body)
        return send(res, 200, toUser(record))
      }
      if (route === 'POST /auth/v1/admin/generate_link') {
        const record = findByEmail(body.email)
        if (!record) return fail(res, 404, 'user_not_found', 'User not found')
        const token = randomBytes(24).toString('hex')
        const hashed = createHash('sha256').update(token).digest('hex')
        links.set(hashed, { email: record.email, type: body.type })
        return send(res, 200, {
          ...toUser(record),
          action_link: `http://localhost/auth/v1/verify?token=${token}&type=${body.type}`,
          email_otp: '000000',
          hashed_token: hashed,
          redirect_to: '',
          verification_type: body.type,
        })
      }
    }

    return fail(res, 404, 'not_found', `Mock auth: ${route} is not implemented`)
  } catch (error) {
    console.error('mock-auth error', error)
    return fail(res, 500, 'unexpected_failure', 'Mock auth error')
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Mock Supabase Auth listening on http://127.0.0.1:${PORT} (${Object.keys(users).length} users)`)
})

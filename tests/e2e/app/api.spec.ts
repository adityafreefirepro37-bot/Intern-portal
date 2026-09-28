import { expect, test } from '@playwright/test'
import { AUTH_CONFIGURED, SKIP_REASON } from '../support'

test.skip(!AUTH_CONFIGURED, SKIP_REASON)

test.describe('API', () => {
  test.skip(({ isMobile }) => isMobile, 'API checks run once')

  test('reports health without leaking configuration', async ({ request }) => {
    const response = await request.get('/api/health')
    expect(response.status()).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ success: true, data: { status: 'ok', database: 'ok' } })
    expect(JSON.stringify(body)).not.toMatch(/postgres|password|localhost:5433/i)
  })

  test('validates search input with the standard error envelope', async ({ request }) => {
    const response = await request.get('/api/search?q=a')
    expect(response.status()).toBe(422)
    expect(await response.json()).toMatchObject({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid input', fields: { q: expect.any(String) } },
    })
  })

  test('returns grouped search results', async ({ request }) => {
    const response = await request.get('/api/search?q=website')
    expect(response.status()).toBe(200)
    const body = await response.json()
    expect(body.success).toBe(true)
    expect(body.data.some((group: { type: string }) => group.type === 'project')).toBe(true)
  })

  test('sends security headers', async ({ request }) => {
    const response = await request.get('/')
    const headers = response.headers()
    expect(headers['x-frame-options']).toBe('DENY')
    expect(headers['x-content-type-options']).toBe('nosniff')
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'")
    expect(headers['x-powered-by']).toBeUndefined()
  })
})

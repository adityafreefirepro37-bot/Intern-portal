/**
 * Next.js request APIs don't exist outside a request. Integration tests call
 * services, the request context and server actions directly, so provide a
 * controllable request (headers) and neutral cookie/connection APIs.
 */
const requestState = {
  headers: new Headers({ 'user-agent': 'jest-integration', 'x-forwarded-for': '203.0.113.10' }),
}

export function setTestRequest(options: { ip?: string; userAgent?: string }) {
  requestState.headers = new Headers({
    'user-agent': options.userAgent ?? 'jest-integration',
    'x-forwarded-for': options.ip ?? '203.0.113.10',
  })
}

jest.mock('next/headers', () => ({
  headers: async () => requestState.headers,
  cookies: async () => ({ getAll: () => [], get: () => undefined, set: () => undefined }),
}))

jest.mock('next/server', () => ({
  ...jest.requireActual('next/server'),
  connection: async () => undefined,
}))

jest.mock('next/cache', () => ({
  revalidatePath: () => undefined,
  revalidateTag: () => undefined,
}))

// Keep the global reachable for helpers without importing this file twice.
;(globalThis as unknown as { __setTestRequest: typeof setTestRequest }).__setTestRequest = setTestRequest

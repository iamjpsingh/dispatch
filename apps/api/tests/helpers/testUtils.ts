import { Hono } from 'hono'

/**
 * Create a minimal test Hono app with the given middleware/routes
 */
export function createTestApp() {
  return new Hono()
}

/**
 * Make a test request to a Hono app
 */
export async function testRequest(
  app: Hono,
  method: string,
  path: string,
  options?: {
    body?: any
    headers?: Record<string, string>
    query?: Record<string, string>
  }
) {
  const url = new URL(path, 'http://localhost')
  if (options?.query) {
    Object.entries(options.query).forEach(([k, v]) => url.searchParams.set(k, v))
  }

  const init: RequestInit = { method, headers: options?.headers || {} }
  if (options?.body) {
    ;(init.headers as Record<string, string>)['Content-Type'] = 'application/json'
    init.body = JSON.stringify(options.body)
  }

  const res = await app.fetch(new Request(url.toString(), init))
  const json = await res.json().catch(() => null)
  return { status: res.status, json, headers: res.headers }
}

/**
 * Mock database helper - creates an in-memory mock
 */
export function createMockDb() {
  const data = new Map<string, any[]>()
  return {
    prepare: (sql: string) => ({
      run: () => ({ changes: 1 }),
      get: () => null,
      all: () => [],
      bind: (...args: any[]) => ({
        run: () => ({ changes: 1 }),
        get: () => null,
        all: () => [],
      }),
    }),
    data,
  }
}

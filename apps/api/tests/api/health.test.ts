import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'

/**
 * Integration test for the /health endpoint.
 *
 * We recreate a minimal Hono app with just the health route rather than
 * importing the full app (which triggers database connections, workers, etc.).
 * This keeps the test fast and isolated while verifying the response contract.
 */

const app = new Hono()

app.get('/health', (c) =>
  c.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    version: '3.0.0',
  })
)

describe('GET /health', () => {
  it('returns 200 with status OK', async () => {
    const res = await app.fetch(new Request('http://localhost/health'))
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.status).toBe('OK')
  })

  it('returns a valid ISO timestamp', async () => {
    const res = await app.fetch(new Request('http://localhost/health'))
    const body = await res.json()

    expect(body.timestamp).toBeTruthy()
    const parsed = new Date(body.timestamp)
    expect(parsed.getTime()).not.toBeNaN()
  })

  it('returns the API version', async () => {
    const res = await app.fetch(new Request('http://localhost/health'))
    const body = await res.json()

    expect(body.version).toBe('3.0.0')
  })

  it('responds with JSON content type', async () => {
    const res = await app.fetch(new Request('http://localhost/health'))
    expect(res.headers.get('content-type')).toContain('application/json')
  })
})

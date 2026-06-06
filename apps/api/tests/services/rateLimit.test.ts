import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import { rateLimit } from '../../src/middleware/rateLimit'

/**
 * Create a minimal Hono app with rate limiting applied to a test route.
 * Each test uses a unique store name to avoid cross-test pollution.
 */
function createApp(storeName: string, maxRequests: number, windowMs: number) {
  const app = new Hono()
  app.use('/test', rateLimit(storeName, maxRequests, windowMs))
  app.get('/test', (c) => c.json({ ok: true }))
  return app
}

async function makeRequest(app: Hono, ip = '127.0.0.1') {
  const req = new Request('http://localhost/test', {
    headers: { 'x-forwarded-for': ip },
  })
  return app.fetch(req)
}

describe('rateLimit middleware', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('allows requests within the limit', async () => {
    const app = createApp('test-allow', 5, 60_000)

    for (let i = 0; i < 5; i++) {
      const res = await makeRequest(app)
      expect(res.status).toBe(200)
    }
  })

  it('returns 429 when limit is exceeded', async () => {
    const app = createApp('test-block', 3, 60_000)

    // Use up the 3 allowed requests
    for (let i = 0; i < 3; i++) {
      const res = await makeRequest(app)
      expect(res.status).toBe(200)
    }

    // 4th request should be blocked
    const blocked = await makeRequest(app)
    expect(blocked.status).toBe(429)

    const body = await blocked.json()
    expect(body.success).toBe(false)
    expect(body.message).toContain('Too many requests')
  })

  it('sets rate limit headers', async () => {
    const app = createApp('test-headers', 10, 60_000)

    const res = await makeRequest(app)
    expect(res.headers.get('X-RateLimit-Limit')).toBe('10')
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('9')
    expect(res.headers.get('X-RateLimit-Reset')).toBeTruthy()
  })

  it('sets Retry-After header on 429 response', async () => {
    const app = createApp('test-retry', 1, 60_000)

    await makeRequest(app) // use the 1 allowed request
    const blocked = await makeRequest(app)

    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('Retry-After')).toBeTruthy()
    const retryAfter = parseInt(blocked.headers.get('Retry-After')!)
    expect(retryAfter).toBeGreaterThan(0)
    expect(retryAfter).toBeLessThanOrEqual(60)
  })

  it('tracks different IPs separately', async () => {
    const app = createApp('test-ip-sep', 2, 60_000)

    // IP A uses 2 requests
    await makeRequest(app, '10.0.0.1')
    await makeRequest(app, '10.0.0.1')

    // IP A is now blocked
    const blockedA = await makeRequest(app, '10.0.0.1')
    expect(blockedA.status).toBe(429)

    // IP B should still be allowed
    const allowedB = await makeRequest(app, '10.0.0.2')
    expect(allowedB.status).toBe(200)
  })

  it('resets after the time window expires', async () => {
    // Use a very short window (1ms) and override Date.now to simulate time passing
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now)

    const app = createApp('test-reset', 1, 1000) // 1 second window

    // Use the one allowed request
    const first = await makeRequest(app)
    expect(first.status).toBe(200)

    // Blocked now
    const blocked = await makeRequest(app)
    expect(blocked.status).toBe(429)

    // Advance time past the window
    vi.spyOn(Date, 'now').mockReturnValue(now + 1500)

    // Should be allowed again (window reset)
    const afterReset = await makeRequest(app)
    expect(afterReset.status).toBe(200)
  })

  it('remaining count decreases with each request', async () => {
    const app = createApp('test-remaining', 5, 60_000)

    const res1 = await makeRequest(app)
    expect(res1.headers.get('X-RateLimit-Remaining')).toBe('4')

    const res2 = await makeRequest(app)
    expect(res2.headers.get('X-RateLimit-Remaining')).toBe('3')

    const res3 = await makeRequest(app)
    expect(res3.headers.get('X-RateLimit-Remaining')).toBe('2')
  })
})

import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { csrfTokenIssuer, csrfProtection } from '../../src/middleware/csrf'

function createApp() {
  const app = new Hono()
  app.use('*', csrfTokenIssuer)
  app.use('*', csrfProtection)
  app.get('/data', (c) => c.json({ ok: true }))
  app.post('/data', (c) => c.json({ ok: true }))
  app.put('/data', (c) => c.json({ ok: true }))
  app.delete('/data', (c) => c.json({ ok: true }))
  app.post('/api/track/pixel', (c) => c.json({ ok: true }))
  app.post('/api/webhooks/incoming', (c) => c.json({ ok: true }))
  return app
}

function getCsrfToken(res: Response): string | null {
  const cookies = res.headers.getSetCookie?.() || []
  for (const cookie of cookies) {
    const match = cookie.match(/csrf_token=([^;]+)/)
    if (match) return match[1]
  }
  return null
}

describe('CSRF middleware', () => {
  it('sets csrf_token cookie on GET', async () => {
    const app = createApp()
    const res = await app.fetch(new Request('http://localhost/data'))
    expect(res.status).toBe(200)

    const token = getCsrfToken(res)
    expect(token).toBeTruthy()
    expect(token!.length).toBe(64) // 32 bytes = 64 hex chars
  })

  it('allows GET requests without CSRF header', async () => {
    const app = createApp()
    const res = await app.fetch(new Request('http://localhost/data'))
    expect(res.status).toBe(200)
  })

  it('blocks POST without CSRF header', async () => {
    const app = createApp()
    const res = await app.fetch(new Request('http://localhost/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }))
    expect(res.status).toBe(403)

    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.message).toContain('CSRF')
  })

  it('blocks PUT without CSRF header', async () => {
    const app = createApp()
    const res = await app.fetch(new Request('http://localhost/data', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }))
    expect(res.status).toBe(403)
  })

  it('blocks DELETE without CSRF header', async () => {
    const app = createApp()
    const res = await app.fetch(new Request('http://localhost/data', {
      method: 'DELETE',
    }))
    expect(res.status).toBe(403)
  })

  it('allows POST with valid CSRF token', async () => {
    const app = createApp()

    // Step 1: GET to obtain the cookie
    const getRes = await app.fetch(new Request('http://localhost/data'))
    const token = getCsrfToken(getRes)
    expect(token).toBeTruthy()

    // Step 2: POST with matching header and cookie
    const postRes = await app.fetch(new Request('http://localhost/data', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `csrf_token=${token}`,
        'X-CSRF-Token': token!,
      },
      body: '{}',
    }))
    expect(postRes.status).toBe(200)
  })

  it('blocks POST with mismatched CSRF token', async () => {
    const app = createApp()

    const getRes = await app.fetch(new Request('http://localhost/data'))
    const token = getCsrfToken(getRes)

    const postRes = await app.fetch(new Request('http://localhost/data', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `csrf_token=${token}`,
        'X-CSRF-Token': 'wrong-token-value',
      },
      body: '{}',
    }))
    expect(postRes.status).toBe(403)
  })

  it('skips CSRF for Bearer token auth', async () => {
    const app = createApp()
    const res = await app.fetch(new Request('http://localhost/data', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer some-api-key',
      },
      body: '{}',
    }))
    expect(res.status).toBe(200)
  })

  it('skips CSRF for tracking endpoints', async () => {
    const app = createApp()
    const res = await app.fetch(new Request('http://localhost/api/track/pixel', {
      method: 'POST',
      body: '{}',
    }))
    expect(res.status).toBe(200)
  })

  it('skips CSRF for webhook endpoints', async () => {
    const app = createApp()
    const res = await app.fetch(new Request('http://localhost/api/webhooks/incoming', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }))
    expect(res.status).toBe(200)
  })
})

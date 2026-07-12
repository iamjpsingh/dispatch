import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { clientIp } from '../../src/middleware/rateLimit'

// TRUSTED_PROXY_HOPS defaults to 1 → the client IP is the RIGHTMOST XFF entry (proxy-observed).
async function ctx(xff?: string) {
  const app = new Hono()
  let captured = ''
  app.get('/', (c) => { captured = clientIp(c); return c.text('ok') })
  const headers: Record<string, string> = xff ? { 'x-forwarded-for': xff } : {}
  await app.fetch(new Request('http://localhost/', { headers }))
  return captured
}

describe('P9 M5 — clientIp keys on the proxy-observed IP', () => {
  it('takes the rightmost XFF entry (1 trusted proxy), ignoring a spoofed leftmost', async () => {
    expect(await ctx('5.6.7.8')).toBe('5.6.7.8')
    // attacker prepends a fake IP; the proxy appended the real one on the right
    expect(await ctx('9.9.9.9, 5.6.7.8')).toBe('5.6.7.8')
    expect(await ctx('1.1.1.1, 2.2.2.2, 5.6.7.8')).toBe('5.6.7.8')
  })
  it('falls back to a non-empty key when XFF is absent', async () => {
    expect(await ctx()).toBeTruthy()
  })
})

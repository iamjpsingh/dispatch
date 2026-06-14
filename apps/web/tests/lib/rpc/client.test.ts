import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { rpcFetch, rpcBase } from '../../../src/lib/rpc/client'

describe('rpc client factory', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })))
    document.cookie = 'csrf_token=tok123'
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('rpcBase targets /api/v1', () => {
    expect(rpcBase()).toMatch(/\/api\/v1$/)
  })

  it('sends credentials and attaches X-CSRF-Token on mutations', async () => {
    await rpcFetch('http://x/api/v1/auth/login', { method: 'POST' })
    const [, init] = (globalThis.fetch as any).mock.calls[0]
    expect(init.credentials).toBe('include')
    expect(new Headers(init.headers).get('X-CSRF-Token')).toBe('tok123')
  })

  it('does not attach CSRF on GET', async () => {
    await rpcFetch('http://x/api/v1/auth/me', { method: 'GET' })
    const [, init] = (globalThis.fetch as any).mock.calls[0]
    expect(new Headers(init.headers).get('X-CSRF-Token')).toBeNull()
  })
})

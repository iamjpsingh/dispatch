import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { authApi } from '../../src/lib/api/auth'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('authApi (typed RPC)', () => {
  beforeEach(() => { document.cookie = 'csrf_token=tok' })
  afterEach(() => vi.unstubAllGlobals())

  it('login posts to /api/v1/auth/login and returns data', async () => {
    const ctx = { user: { id: 'u1', email: 'a@b.c', name: 'A' }, orgId: 'o1', role: 'admin', orgs: [] }
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: ctx }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await authApi.login('a@b.c', 'pw')
    expect(out).toEqual(ctx)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/v1/auth/login')
    expect(init.method).toBe('POST')
    expect(new Headers(init.headers).get('X-CSRF-Token')).toBe('tok')
  })

  it('login throws on { success: false }', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ success: false, message: 'bad creds' }, 401)))
    await expect(authApi.login('a@b.c', 'x')).rejects.toThrow(/bad creds/)
  })
})

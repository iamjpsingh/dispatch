import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { configApi } from '../../src/lib/api/config'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('configApi (typed RPC)', () => {
  beforeEach(() => { document.cookie = 'csrf_token=tok' })
  afterEach(() => vi.unstubAllGlobals())

  it('list gets /api/v1/config/list and returns configs', async () => {
    const configs = [{ id: 'c1', name: 'Main', provider_type: 'smtp' }]
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: { configs } }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await configApi.list()
    expect(out).toEqual(configs)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/v1/config/list')
    expect((init?.method ?? 'GET').toUpperCase()).toBe('GET')
  })

  it('create posts to /api/v1/config/smtp and returns configId', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: { configId: 'new-id' } }))
    vi.stubGlobal('fetch', fetchMock)
    const id = await configApi.create({ host: 'smtp.test', user: 'u', pass: 'p', from_email: 'a@b.c' })
    expect(id).toBe('new-id')
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/v1/config/smtp')
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe('tok')
  })

  it('update puts to /api/v1/config/smtp/:id', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true }))
    vi.stubGlobal('fetch', fetchMock)
    await configApi.update('cfg-9', { host: 'x' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/v1/config/smtp/cfg-9')
    expect(init?.method).toBe('PUT')
  })

  it('delete deletes /api/v1/config/smtp/:id', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true }))
    vi.stubGlobal('fetch', fetchMock)
    await configApi.delete('cfg-7')
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/v1/config/smtp/cfg-7')
    expect(init?.method).toBe('DELETE')
  })

  it('testConnection posts to /api/v1/config/smtp/test and reports validity', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: { valid: true }, message: 'ok' }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await configApi.testConnection({ host: 'h', port: 587, secure: false, user: 'u', pass: 'p' })
    expect(out).toEqual({ success: true, message: 'ok' })
    const [url] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/v1/config/smtp/test')
  })

  it('create throws on { success: false }', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ success: false, message: 'nope' }, 400)))
    await expect(configApi.create({ host: 'h', user: 'u', pass: 'p', from_email: 'a@b.c' })).rejects.toThrow(/nope/)
  })
})

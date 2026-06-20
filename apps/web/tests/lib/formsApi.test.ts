import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { formsApi } from '../../src/lib/api/forms'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('formsApi (typed RPC)', () => {
  beforeEach(() => { document.cookie = 'csrf_token=tok' })
  afterEach(() => vi.unstubAllGlobals())

  it('list gets /api/v1/forms and unwraps { forms }', async () => {
    const forms = [{ id: 'f1', name: 'Signup' }]
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: { forms } }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await formsApi.list()
    expect(out).toEqual(forms)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/v1/forms')
    expect((init?.method ?? 'GET').toUpperCase()).toBe('GET')
  })

  it('create posts to /api/v1/forms and returns data', async () => {
    const form = { id: 'f2', name: 'Contact' }
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: form }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await formsApi.create({ name: 'Contact', list_id: 'l1' })
    expect(out).toEqual(form)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/v1/forms')
    expect(init.method).toBe('POST')
    expect(new Headers(init.headers).get('X-CSRF-Token')).toBe('tok')
  })

  it('toggle posts to /api/v1/forms/:id/toggle and returns status', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: { status: 'paused' } }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await formsApi.toggle('f3')
    expect(out).toBe('paused')
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/v1/forms/f3/toggle')
    expect(init.method).toBe('POST')
  })

  it('getSubmissions passes limit/offset query params', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: { submissions: [], total: 0 } }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await formsApi.getSubmissions('f4', 25, 10)
    expect(out).toEqual({ submissions: [], total: 0 })
    const [url] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/v1/forms/f4/submissions')
    expect(String(url)).toContain('limit=25')
    expect(String(url)).toContain('offset=10')
  })

  it('delete throws on { success: false }', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ success: false, message: 'Form not found' }, 404)))
    await expect(formsApi.delete('nope')).rejects.toThrow(/Form not found/)
  })

  it('get throws on { success: false }', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ success: false, message: 'Form not found' }, 404)))
    await expect(formsApi.get('nope')).rejects.toThrow(/Form not found/)
  })
})

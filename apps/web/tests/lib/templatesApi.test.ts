import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { templatesApi } from '../../src/lib/api/templates'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('templatesApi (typed RPC)', () => {
  beforeEach(() => { document.cookie = 'csrf_token=tok' })
  afterEach(() => vi.unstubAllGlobals())

  it('list gets /api/v1/templates and returns templates + pagination', async () => {
    const templates = [{ id: 't1', name: 'Welcome' }]
    const pagination = { page: 1, limit: 50, total: 1, totalPages: 1 }
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: templates, meta: { pagination } }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await templatesApi.list({ search: 'wel', page: 1 })
    expect(out.templates).toEqual(templates)
    expect(out.pagination).toEqual(pagination)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/v1/templates')
    expect((init?.method ?? 'GET').toUpperCase()).toBe('GET')
  })

  it('get fetches /api/v1/templates/:id and returns data', async () => {
    const tpl = { id: 't9', name: 'Promo' }
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: tpl }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await templatesApi.get('t9')
    expect(out).toEqual(tpl)
    const [url] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/v1/templates/t9')
  })

  it('create posts to /api/v1/templates with CSRF and returns data', async () => {
    const tpl = { id: 'new', name: 'N' }
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: tpl }, 201))
    vi.stubGlobal('fetch', fetchMock)
    const out = await templatesApi.create({ name: 'N', html_content: '<p>hi</p>' })
    expect(out).toEqual(tpl)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/v1/templates')
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe('tok')
  })

  it('delete deletes /api/v1/templates/:id', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true }))
    vi.stubGlobal('fetch', fetchMock)
    await templatesApi.delete('t7')
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/v1/templates/t7')
    expect(init?.method).toBe('DELETE')
  })

  it('useSection posts to /api/v1/templates/sections/:id/use and returns html', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: { html_content: '<div/>' } }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await templatesApi.useSection('s1')
    expect(out).toBe('<div/>')
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/v1/templates/sections/s1/use')
    expect(init?.method).toBe('POST')
  })

  it('create throws on { success: false }', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ success: false, message: 'nope' }, 400)))
    await expect(templatesApi.create({ name: 'x', html_content: 'y' })).rejects.toThrow(/nope/)
  })
})
